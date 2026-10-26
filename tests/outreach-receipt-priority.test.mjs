// Actual production receipt selectors over local synthetic data. No provider I/O.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const baseline=JSON.parse(read('tests/fixtures/outreach-receipt-priority-baseline.json'));
const migration=read('config/outreach-receipt-priority.sql');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),one=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,account=uid(1);
const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_voice_scheduler(id int primary key,last_dispatch_at timestamptz);insert into icash_voice_scheduler values(1,null);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,live_call_id uuid,signing_id uuid,created_at timestamptz default now(),token text default gen_random_uuid()::text);
 create table icash_live_conversations(id uuid primary key,account_id uuid,state text default 'waiting',next_poll_at timestamptz default now(),poll_attempts int default 0,conversation_id text);
 create table icash_signing_envelopes(id uuid primary key,account_id uuid,state text default 'awaiting_counterparty',provider_id text,next_poll_at timestamptz default now(),created_at timestamptz default now());
 create table icash_operation_spend(operation_key text,state text,charged_cents bigint);insert into icash_operation_spend values('original-unknown','dispatched',null),('original-settled','settled',43);
 create table icash_wallets(account_id uuid,balance_cents bigint);insert into icash_wallets values('${account}',10000);
 create function icash_issue_ready_voice_ticket() returns jsonb language sql as $$select '{"token":"new-voice"}'::jsonb$$;
 create function icash_next_before_unstarted_sms_recovery() returns jsonb language sql as $$select '{"token":"new-text"}'::jsonb$$;
 create function icash_next_acquisition() returns jsonb language sql as $$select '{"token":"research"}'::jsonb$$;
 `);
 for(const definition of Object.values(baseline))await pg.exec(definition);
 await pg.exec('revoke all on function icash_next_before_signing(),icash_next_before_voice_dispatch(),icash_next_outreach_channel() from public,anon,authenticated;grant execute on function icash_next_before_signing(),icash_next_before_voice_dispatch(),icash_next_outreach_channel() to service_role');
 const addCall=async(n,attempts=0)=>{await q("insert into icash_live_conversations(id,account_id,poll_attempts,conversation_id) values($1,$2,$3,$4)",[uid(n),account,attempts,'conv_fixture_'+n]);return uid(n);};
 const addSigning=async n=>{await q("insert into icash_signing_envelopes(id,account_id,provider_id) values($1,$2,$3)",[uid(n),account,'original-envelope-'+n]);return uid(n);};
 const picked=async(fn='icash_next_outreach_channel')=>{
  const result=await one(`select ${fn}()`);if(!result?.token)return null;
  return ['new-voice','new-text','research'].includes(result.token)?result.token:one('select kind from icash_automation_tickets where token=$1',[result.token]);
 };
 await isolated(async()=>{await addCall(100);assert.equal(await picked(),'new-voice');assert.equal(await one('select poll_attempts from icash_live_conversations'),0,'reproduces due call receipts starving behind new outreach');});
 const originalMoney=await one('select jsonb_agg(to_jsonb(s)) from icash_operation_spend s');
 await pg.exec(migration);
 for(const [oldName,newName,tail] of [['icash_next_before_signing','icash_issue_due_voice_result','return public.icash_next_acquisition();'],['icash_next_before_voice_dispatch','icash_issue_due_signing_result','return public.icash_next_before_signing();']]){
  assert.equal(await one(`select pg_get_functiondef('${newName}()'::regprocedure)`),baseline[oldName].replace('FUNCTION public.'+oldName+'()','FUNCTION public.'+newName+'()').replace(tail,'return null;'),'original receipt polling gates, intervals and attempt bounds are unchanged');
 }
 await isolated(async()=>{
  const call=await addCall(100);
  assert.equal(await picked(),'voice_result','due original result precedes new calls');
  assert.equal(await one('select live_call_id from icash_automation_tickets'),call);
  assert.equal(await one('select poll_attempts from icash_live_conversations'),1);
  assert.equal(await one("select next_poll_at=now()+interval '2 minutes' from icash_live_conversations"),true);
  assert.equal(await one('select conversation_id from icash_live_conversations'),'conv_fixture_100','original provider identity is immutable');
  assert.equal(await picked(),'new-voice','the same receipt cannot immediately take another turn');
 });
 await isolated(async()=>{
  await addCall(110);const signing=await addSigning(111);
  assert.equal(await picked(),'signing_result');assert.equal(await one('select signing_id from icash_automation_tickets'),signing);
  assert.equal(await one("select next_poll_at=now()+interval '10 minutes' from icash_signing_envelopes"),true);
  assert.equal(await picked(),'voice_result');assert.equal(await picked(),'new-voice','both due receipt types yield after one existing poll');
 });
 await isolated(async()=>{
  await addCall(120,60);assert.equal(await picked(),'new-voice');
  assert.equal(await one('select state from icash_live_conversations'),'review');
  assert.equal(await one('select poll_attempts from icash_live_conversations'),60,'attempt limit is never reset');
  assert.equal(await one('select count(*) from icash_automation_tickets'),0);
 });
 for(const condition of ['review','future'])await isolated(async()=>{
  await addCall(130);await pg.exec(condition==='review'?"update icash_live_conversations set state='review'":"update icash_live_conversations set next_poll_at=now()+interval '1 hour'");
  assert.equal(await picked(),'new-voice');assert.equal(await one('select poll_attempts from icash_live_conversations'),0);
 });
 for(const condition of ['missing','old','terminal'])await isolated(async()=>{
  await addSigning(140);await pg.exec({missing:'update icash_signing_envelopes set provider_id=null',old:"update icash_signing_envelopes set created_at=now()-interval '46 days'",terminal:"update icash_signing_envelopes set state='completed'"}[condition]);
  assert.equal(await picked(),'new-voice');assert.equal(await one('select count(*) from icash_automation_tickets'),0);
 });
 await isolated(async()=>{
  await pg.exec('update icash_voice_scheduler set last_dispatch_at=now()');
  await addCall(150);assert.equal(await picked(),'voice_result');assert.equal(await picked(),'new-text','existing text turn remains available after receipts');
 });
 assert.equal(await picked('icash_next_before_voice_dispatch'),'research','the original empty-queue fallthrough is retained');
 assert.deepEqual(await one('select jsonb_agg(to_jsonb(s)) from icash_operation_spend s'),originalMoney);
 assert.equal(await one('select balance_cents from icash_wallets'),10000);
 for(const role of ['anon','authenticated'])for(const fn of ['icash_issue_due_voice_result()','icash_issue_due_signing_result()','icash_next_outreach_channel()'])assert.equal(await one('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 assert.equal(migration,read('supabase/migrations/20261026174810_outreach_receipt_priority.sql'));
 console.log('Outreach receipts: original voice/signing results progress before sustained new outreach; poll intervals, attempt limits, provider identities, unknown holds, finances and private access remain intact. Local fixtures only.');
}finally{await pg.close();}
