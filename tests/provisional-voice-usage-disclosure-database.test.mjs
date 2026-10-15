import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const db=await PGlite.create();
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=id(1),b=id(2),ownerA=id(11),ownerB=id(12),ledger=id(21);
const one=async(sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
const sql=readFileSync(new URL('../config/live-voice-metering-disclosure.sql',import.meta.url),'utf8');
const has=account=>one('select public.icash_has_provisional_voice_usage($1)',[account]);
const snapshot=(user,mode='live')=>one('select public.icash_load_workspace_account($1,$2)',[user,mode]);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema icash_voice_meter_private;
 create table icash_voice_meter_private.meters(operation_key text primary key,account_id uuid,state text,provisional_cents bigint);
 create table icash_voice_meter_private.entries(operation_key text,elapsed_seconds integer,cumulative_cents bigint,delta_cents bigint,ledger_id uuid);
 create table public.icash_credit_ledger(id uuid primary key,account_id uuid,event_key text,kind text,delta_cents bigint);
 create table public.fixture_accounts(id uuid primary key,owner_user_id uuid,body jsonb);
 create function public.icash_load_workspace_account(p_user uuid,p_mode text) returns jsonb language plpgsql security invoker set search_path='' as $$
 declare result jsonb;
 begin
  select body into strict result from public.fixture_accounts where owner_user_id=p_user;
  return result;
 end $$;
 revoke all on function public.icash_load_workspace_account(uuid,text) from public,anon,authenticated;
 grant execute on function public.icash_load_workspace_account(uuid,text) to service_role;
 grant select on public.fixture_accounts to service_role;`);
 const original={accountId:a,account:{balanceCents:700,reservedCents:0,membership:{state:'active'},identity:{principal:'Fixture'},unknownFutureField:['preserve',3]},otherTopLevelField:'preserve'};
 const originalB={accountId:b,account:{balanceCents:999}};
 await db.query('insert into public.fixture_accounts values($1,$2,$3),($4,$5,$6)',[a,ownerA,original,b,ownerB,originalB]);
 await db.exec(sql);
 assert.equal(await has(a),false);
 assert.deepEqual(await snapshot(ownerA),original,'Unmetered response is byte-shape compatible');
 await db.query("insert into public.icash_credit_ledger values($1,$2,'usage-meter:voice:fixture:20','usage',-30)",[ledger,a]);
 assert.equal(await has(a),false,'A plausible prefix without a real meter/entry is not proof');
 await db.query("insert into icash_voice_meter_private.meters values('voice:fixture',$1,'active',30)",[a]);
 assert.equal(await has(a),false,'A meter alone is not proof of a posted debit');
 await db.query("insert into icash_voice_meter_private.entries values('voice:fixture',20,30,30,$1)",[ledger]);
 for(const state of ['active','stopping','terminal']){
  await db.query("update icash_voice_meter_private.meters set state=$1 where operation_key='voice:fixture'",[state]);
  assert.equal(await has(a),true,`${state} remains provisional until final reconciliation`);
 }
 assert.equal(await has(b),false,'Tenant isolation');
 assert.equal(await has(null),false);
 const before=await one("select jsonb_build_object('meters',(select jsonb_agg(m) from icash_voice_meter_private.meters m),'entries',(select jsonb_agg(e) from icash_voice_meter_private.entries e),'ledger',(select jsonb_agg(l) from public.icash_credit_ledger l))");
 assert.deepEqual(await snapshot(ownerA),{...original,account:{...original.account,provisionalVoiceUsage:true}});
 assert.deepEqual(await snapshot(ownerB),originalB);
 assert.deepEqual(await snapshot(ownerA,'test'),original,'Payment test mode remains unchanged');
 const after=await one("select jsonb_build_object('meters',(select jsonb_agg(m) from icash_voice_meter_private.meters m),'entries',(select jsonb_agg(e) from icash_voice_meter_private.entries e),'ledger',(select jsonb_agg(l) from public.icash_credit_ledger l))");
 assert.deepEqual(after,before,'Display reads cannot mutate meters, entries, or ledger');
 await assert.rejects(()=>snapshot(id(999)),/query returned no rows/,'Original account authorization remains authoritative');
 for(const [change,undo,label] of [
  ["state='settled'","state='terminal'",'Settled meter history is not pending'],
  ["state='cancelled'","state='terminal'",'Proven-unstarted cancellation is not pending usage'],
  ['provisional_cents=0','provisional_cents=30','No provisional amount'],
  ['provisional_cents=29','provisional_cents=30','Entry exceeds recorded cumulative debit'],
 ]){
  await db.exec('update icash_voice_meter_private.meters set '+change);
  assert.equal(await has(a),false,label);assert.deepEqual(await snapshot(ownerA),original);
  await db.exec('update icash_voice_meter_private.meters set '+undo);
 }
 for(const [change,undo,label] of [
  ["kind='grant'","kind='usage'",'Final credit adjustment is not a provisional debit'],
  ["event_key='usage:voice:fixture'","event_key='usage-meter:voice:fixture:20'",'Final further debit is not a provisional entry'],
  ["event_key='usage-meter:voice:other:20'","event_key='usage-meter:voice:fixture:20'",'Operation binding'],
  ["event_key='usage-meter:voice:fixture:21'","event_key='usage-meter:voice:fixture:20'",'Elapsed binding'],
  ['delta_cents=-29','delta_cents=-30','Exact debit amount binding'],
  [`account_id='${b}'`,`account_id='${a}'`,'Exact debit account binding'],
 ]){
  await db.exec('update public.icash_credit_ledger set '+change);
  assert.equal(await has(a),false,label);
  await db.exec('update public.icash_credit_ledger set '+undo);
 }
 for(const name of ['icash_has_provisional_voice_usage(uuid)','icash_load_workspace_account(uuid,text)','icash_load_workspace_account_before_voice_disclosure(uuid,text)']){
  for(const role of ['anon','authenticated'])assert.equal(await one('select has_function_privilege($1,$2,\'EXECUTE\')',[role,'public.'+name]),false,role+' cannot call '+name);
  assert.equal(await one('select has_function_privilege(\'service_role\',$1,\'EXECUTE\')',['public.'+name]),true);
 }
 assert.equal(await one("select has_table_privilege('service_role','icash_voice_meter_private.meters','SELECT')"),false,'Private meter table remains inaccessible');
 await db.exec('set role service_role');
 assert.equal((await snapshot(ownerA)).account.provisionalVoiceUsage,true,'Authorized server wrapper can read through the narrow definer helper');
 await db.exec('reset role');
 assert(!/\b(update|insert into|delete from)\b/i.test(sql),'Disclosure candidate contains no billing data mutation');
 assert(!/ICASH_VOICE_METERING_READY|set enabled|charge_cap|cost_multiplier/.test(sql));
 assert.match(readFileSync(new URL('../config/live-voice-metering.sql',import.meta.url),'utf8'),/'usage-meter:'\|\|m\.operation_key\|\|':'\|\|seconds,'usage',-delta/,'Match actual candidate ledger contract');
 console.log('PASS provisional disclosure database: real unsettled debit proof, tenant/account binding, original snapshot preservation, test/settled exclusion, no writes, service-only permissions.');
}finally{await db.close();}
