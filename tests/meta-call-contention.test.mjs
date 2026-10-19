// LOCAL SIMULATION ONLY. Saved post-hours production claim/hold/scheduler functions;
// recipient/context and reserve/settle adapters are controlled local dependencies.
// No providers, credentials or production rows are used.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const q=(sql,args=[])=>pg.query(sql,args);
const one=async(sql,args=[])=>{const r=await q(sql,args);assert.equal(r.rows.length,1);return r.rows[0];};
const rpc=async(name,args)=>Object.values(await one(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args))[0];
const account=randomUUID(),other=randomUUID(),permission=randomUUID(),otherPermission=randomUUID(),job=randomUUID(),competing=randomUUID(),rate=randomUUID(),lead=randomUUID(),screen=randomUUID();
const baseline=JSON.parse(read('tests/fixtures/meta-contention-baseline.json'));
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint);
 create table icash_operating_budget(id int primary key,enabled boolean default true,require_company_reserve boolean default false,funded_micros bigint default 100000,spent_micros bigint default 0,protected_micros bigint default 0,reserved_micros bigint default 0);
 create table icash_operation_rates(id uuid primary key,operation text,enabled boolean default true,expires_at timestamptz default now()+interval '1 day',voice_max_duration_seconds int default 600);
 create table icash_spend_activations(account_id uuid primary key,enabled boolean default true);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text default 'seller',phone text,contact_key text,timezone text default 'America/Chicago',seller_intake_id uuid,revoked_at timestamptz,permission_until timestamptz default now()+interval '1 day');
 create view icash_voice_contact_targets as select * from icash_contact_permissions;
 create table icash_voice_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,meta_offer_lead_id uuid,meta_followup_lead_id uuid,meta_retry_of uuid,state text default 'ready',due_at timestamptz default now(),outcome text,operation_key text,provider_call_sid text,conversation_id text,created_at timestamptz default now(),updated_at timestamptz default now());
 create unique index fixture_initial_once on icash_voice_jobs(permission_id) where meta_retry_of is null and callback_id is null and meta_followup_lead_id is null;
 create table icash_voice_configs(account_id uuid primary key,enabled boolean default true,reviewed_until timestamptz default now()+interval '1 day',seller_rate_id uuid,buyer_rate_id uuid,max_duration_seconds int default 600);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,rate_id uuid,state text default 'reserved',permission_until timestamptz default now()+interval '1 day',financial_checked_at timestamptz,dispatched_at timestamptz,settled_at timestamptz,actual_micros bigint,charged_cents bigint,charge_cap_cents bigint default 100,settlement_evidence text);
 create table icash_call_recordings(voice_job_id uuid,operation_key text);
 create table icash_live_conversations(operation_key text,account_id uuid,contact_key text,state text);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,voice_job_id uuid,paused boolean default false,voice_paused boolean default false,declined_at timestamptz,next_attempt_at timestamptz default now());
 create table icash_seller_intakes(id uuid primary key,phone text);
 create table icash_deal_files(id uuid default gen_random_uuid(),account_id uuid,screening_id uuid,stage text default 'draft');
 create table icash_meta_lead_messages(message_id uuid,lead_id uuid,purpose text);
 create table icash_text_messages(id uuid,account_id uuid);
 create table fixture_admission(consent boolean default true,membership boolean default true,hours boolean default true,channel boolean default true);
 insert into fixture_admission default values;
 create function icash_meta_voice_context(uuid,uuid) returns jsonb language sql stable set search_path=public as $$select '{}'::jsonb from icash_voice_jobs j join icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id join icash_meta_leads m on m.account_id=j.account_id and m.lead_id=p.seller_intake_id where j.account_id=$1 and j.id=$2 and not m.paused and not m.voice_paused and p.revoked_at is null and p.permission_until>now() and (select consent from fixture_admission)$$;
 create function icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql stable set search_path=public as $$select hours from fixture_admission$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql stable set search_path=public as $$select channel from fixture_admission$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql stable set search_path=public as $$select membership from fixture_admission$$;
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql stable set search_path=public as $$select consent from fixture_admission$$;
 create function icash_prepare_seller_contacts(uuid,uuid,uuid,uuid) returns void language sql set search_path=public as $$select$$;
 create function icash_meta_followup_current(uuid,text) returns boolean language sql stable set search_path=public as $$select false$$;
 create function icash_general_reception_pause_exempt(uuid,text,bigint) returns boolean language sql stable set search_path=public as $$select false$$;
 create function icash_customer_text_operation(uuid,text) returns boolean language sql stable set search_path=public as $$select false$$;
 create function icash_limited_seller_voice(uuid,text) returns boolean language sql stable set search_path=public as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql stable set search_path=public as $$select false$$;
 create function icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql stable set search_path=public as $$select null::jsonb$$;
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql stable set search_path=public as $$select false$$;
 create function icash_claim_inventory(uuid,uuid,text) returns boolean language sql stable set search_path=public as $$select false$$;
 create function icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) returns void language sql set search_path=public as $$insert into icash_operation_spend(account_id,operation_key,rate_id,permission_until,financial_checked_at) values($1,$2,$3,$4,$5) on conflict do nothing$$;
 create function icash_settle_operation(text,bigint,bigint,text) returns void language sql set search_path=public as $$update icash_operation_spend set state='cancelled',actual_micros=$2,charged_cents=$3,settlement_evidence=$4,settled_at=now() where operation_key=$1 and state='reserved'$$;
 `);
 for(const fn of Object.values(baseline))await pg.exec(fn);
 await q('insert into icash_accounts(id) values($1),($2)',[account,other]);
 await q('insert into icash_wallets values($1,10000),($2,10000)',[account,other]);
 await q('insert into icash_operating_budget(id) values(1)');
 await q("insert into icash_operation_rates(id,operation) values($1,'seller_call')",[rate]);
 await q('insert into icash_spend_activations(account_id) values($1),($2)',[account,other]);
 await q('insert into icash_voice_configs(account_id,seller_rate_id) values($1,$3),($2,$3)',[account,other,rate]);
 await q("insert into icash_contact_permissions(id,account_id,screening_id,phone,contact_key,seller_intake_id) values($1,$3,$4,'+12145550001','first',$5),($2,$3,$4,'+12145550002','second',null)",[permission,otherPermission,account,screen,lead]);
 await q("insert into icash_voice_jobs(id,account_id,permission_id,state) values($1,$3,$4,'issued'),($2,$3,$5,'dispatching')",[job,competing,account,permission,otherPermission]);
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id) values($1,$2,$3)",['voice:'+job,account,rate]);
 await q('insert into icash_meta_leads(lead_id,account_id,screening_id,voice_job_id) values($1,$2,$3,$4)',[lead,account,screen,job]);
 await q("insert into icash_seller_intakes values($1,'+12145550001')",[lead]);
 await q('insert into icash_deal_files(account_id,screening_id) values($1,$2)',[account,screen]);
 const isolated=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
 const current=()=>one('select * from icash_voice_jobs where id=$1',[job]);
 const spend=()=>one('select * from icash_operation_spend where operation_key=$1',['voice:'+job]);
 await isolated(async()=>{
  assert.equal(await rpc('icash_meta_claim_voice',[account,job]),false);
  assert.equal(await rpc('icash_hold_voice_job',[account,job,'dispatch_permission_changed',false]),true);
  assert.equal((await current()).state,'held');assert.equal((await spend()).state,'cancelled','reproduce original permanent contention failure');
 });
 const sql=read('config/meta-call-contention.sql');assert.equal(sql,read('supabase/migrations/20261019173747_meta_call_contention.sql'));
 const originalDefinition=(await one("select pg_get_functiondef('icash_meta_claim_voice(uuid,uuid)'::regprocedure) d")).d;
 await pg.exec(sql);
 assert.equal((await one("select pg_get_functiondef('icash_meta_claim_voice(uuid,uuid)'::regprocedure) d")).d,originalDefinition,'existing boolean RPC unchanged');
 const claim=()=>rpc('icash_meta_claim_or_defer_voice',[account,job]);
 assert.equal(await rpc('icash_meta_claim_or_defer_voice',[other,job]),'unavailable','foreign-account call has no hold or claim authority');
 assert.deepEqual(await one("select has_function_privilege('anon','icash_meta_claim_or_defer_voice(uuid,uuid)','execute') anon,has_function_privilege('authenticated','icash_meta_claim_or_defer_voice(uuid,uuid)','execute') customer,has_function_privilege('service_role','icash_meta_claim_or_defer_voice(uuid,uuid)','execute') service"),{anon:false,customer:false,service:true});
 await isolated(async()=>{
  const before=await spend(),busyBefore=await one('select * from icash_voice_jobs where id=$1',[competing]);
  assert.equal(await claim(),'deferred');assert.equal((await current()).state,'ready');assert((await current()).due_at>new Date());
  assert.deepEqual(await spend(),before,'successful final ledger probe fully rolls back');
  assert.deepEqual(await one('select * from icash_voice_jobs where id=$1',[competing]),busyBefore,'existing provider job stays immutable');
  assert.equal(await claim(),'unavailable','duplicate stale claimant has no authority to hold ready work');
  assert.equal(await rpc('icash_meta_prepare_voice',[lead]),null,'ordinary queue respects deferral time');
  await q("update icash_voice_jobs set state='dispatched' where id=$1",[competing]);
  await q("update icash_voice_jobs set due_at=now()-interval '1 second' where id=$1",[job]);
  assert.equal((await rpc('icash_meta_prepare_voice',[lead])).voiceJobId,job,'ordinary scheduler reuses the same job');
  assert.equal(await rpc('icash_reserve_paced_voice',[account,job,rate,new Date(Date.now()+3600000).toISOString(),null,false]),true);
  assert.deepEqual(await spend(),before,'reissue keeps original authorization without a replacement');
  assert.equal(await claim(),'claimed');assert.equal((await current()).state,'dispatching');assert.equal((await spend()).state,'dispatched');
  assert.equal(await claim(),'unavailable','one dispatch claim only');
  assert.equal((await one('select count(*) n from icash_voice_jobs where permission_id=$1',[permission])).n,1);
 });
 for(const [name,mutation,args=[]] of [
  ['consent','update fixture_admission set consent=false'],['hours','update fixture_admission set hours=false'],
  ['membership','update fixture_admission set membership=false'],['channel','update fixture_admission set channel=false'],
  ['Pause','update icash_accounts set bot_paused=true where id=$1',[account]],
  ['zero wallet','update icash_wallets set balance_cents=0 where account_id=$1',[account]],
  ['rate mismatch','update icash_voice_configs set max_duration_seconds=601 where account_id=$1',[account]],
  ['rate disabled','update icash_operation_rates set enabled=false'],['company disabled','update icash_operating_budget set enabled=false'],
  ['activation disabled','update icash_spend_activations set enabled=false'],
  ['expired reservation',"update icash_operation_spend set permission_until=now()-interval '1 second'"]
 ])await isolated(async()=>{await q(mutation,args);assert.equal(await claim(),'held',name+' must not become a contention deferral');assert.equal((await current()).state,'held');assert.equal((await spend()).state,'cancelled');});
 for(const field of ['callback_id','sms_source_message_id','cancellation_notice_id','meta_offer_lead_id','meta_followup_lead_id'])await isolated(async()=>{
  await q(`update icash_voice_jobs set ${field}=gen_random_uuid() where id=$1`,[job]);
  assert.equal(await claim(),'held',field+' does not inherit initial-call deferral');
  assert.equal((await current()).state,'held');
 });
 await isolated(async()=>{
  await q("update icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=$1",['voice:'+job]);
  const before=await spend();assert.equal(await claim(),'held');assert.deepEqual(await spend(),before,'own uncertain operation is never cancelled or reset');assert.equal((await current()).state,'issued');
 });
 await isolated(async()=>{
  await q("update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry' where id=$1",[job]);
  const before=await current();assert.equal(await claim(),'unavailable');assert.deepEqual(await current(),before);
 });
 await isolated(async()=>{
  await q("update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry' where id=$1",[competing]);
  const before=await one('select * from icash_voice_jobs where id=$1',[competing]);assert.equal(await claim(),'deferred');
  assert.deepEqual(await one('select * from icash_voice_jobs where id=$1',[competing]),before,'another unknown call remains held, never retried');
 });
 await isolated(async()=>{
  await q('update icash_contact_permissions set account_id=$2,contact_key=$3 where id=$1',[otherPermission,other,'first']);
  await q('update icash_voice_jobs set account_id=$2 where id=$1',[competing,other]);assert.equal(await claim(),'deferred','same contact across accounts still serializes');
 });
 await isolated(async()=>{
  await q('update icash_contact_permissions set account_id=$2 where id=$1',[otherPermission,other]);
  await q('update icash_voice_jobs set account_id=$2 where id=$1',[competing,other]);assert.equal(await claim(),'claimed','unrelated account/contact cannot fabricate busy evidence');
 });
 await isolated(async()=>{
  await q("update icash_voice_jobs set state='dispatched' where id=$1",[competing]);
  await q("insert into icash_live_conversations(account_id,contact_key,state) values($1,'other-contact','waiting')",[account]);assert.equal(await claim(),'deferred','live same-account conversation remains serialized');
 });
 await isolated(async()=>{
  await pg.exec("create or replace function icash_claim_operation(p_operation text) returns boolean language plpgsql as $$begin raise exception using errcode='P0M01',message='SIMULATION unrelated claim failure';end$$;");
  await assert.rejects(claim(),/SIMULATION unrelated claim failure/,'matching SQLSTATE from the underlying claim must not fake successful admission');
 });
 console.log('PASS Meta contention: real failure reproduced; exact claim rolled back; same job/reservation reissued; atomic holds; duplicate ownership, ACLs, hours/Pause/consent/rates/credits and unknown attempts preserved. No provider traffic.');
}finally{await pg.close();}
