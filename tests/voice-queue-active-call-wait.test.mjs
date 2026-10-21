// LOCAL ONLY: real issuer SQL over synthetic records. No provider traffic.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args);
const val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=uid(1),b=uid(2),c=uid(3),migration=read('config/voice-queue-active-call-wait.sql');
const scenario=async(fn)=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role;
 create table icash_operating_budget(id int primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_wallets(account_id uuid primary key,balance_cents bigint default 10000,reserved_cents bigint default 0);
 create table icash_voice_configs(account_id uuid primary key,enabled boolean default true);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,state text default 'ready',due_at timestamptz default now(),created_at timestamptz default now(),updated_at timestamptz default now(),callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,meta_offer_lead_id uuid,meta_followup_lead_id uuid,outcome text);
 create table icash_voice_scheduler(id int primary key,last_dispatch_at timestamptz);insert into icash_voice_scheduler(id) values(1);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,voice_job_id uuid,token text unique default gen_random_uuid()::text,created_at timestamptz default now());
 create table icash_screening_jobs(id uuid primary key,account_id uuid,state text);
 create table icash_meta_leads(lead_id uuid primary key,account_id uuid,screening_id uuid,voice_job_id uuid);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text default 'seller',seller_intake_id uuid);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text default 'seller');
 create view icash_voice_contact_targets as select id,account_id,screening_id,contact_key,party,'operator_record'::text eligibility_source from icash_contact_permissions union all select id,account_id,screening_id,contact_key,party,'operational_checks_only' from icash_operational_contacts;
 create table icash_live_callbacks(id uuid primary key,account_id uuid,screening_id uuid,conversation_id uuid,state text,due_at timestamptz);
 create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text,state text,result jsonb,completed_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,state text,actual_micros bigint,charged_cents bigint);
 insert into icash_operation_spend values('unknown','dispatched',null,null),('settled','settled',123000,25);
 create function icash_queue_voice_jobs() returns void language sql as $$select$$;
 create function icash_next_before_voice_dispatch() returns jsonb language sql as $$select null::jsonb$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql as $$select true$$;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql as $$select true$$;
 create function icash_seller_phone_call_current(uuid,uuid) returns boolean language sql as $$select true$$;
 `);
 for(const account of [a,b,c]){await q('insert into icash_accounts values($1,false)',[account]);await q('insert into icash_wallets(account_id) values($1)',[account]);await q('insert into icash_voice_configs(account_id) values($1)',[account]);}
 await pg.exec(read('tests/fixtures/voice-issuer-before-active-call-wait.sql'));
 await pg.exec('revoke all on function icash_next_before_fulfillment() from public,anon,authenticated;grant execute on function icash_next_before_fulfillment() to service_role;');
 const before=await val("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)");
 const finances=await val("select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s");
 await pg.exec(migration);
 const after=await val("select pg_get_functiondef('icash_next_before_fulfillment()'::regprocedure)");
 assert.equal(after.replaceAll('\n and public.icash_voice_queue_slot_open(v.account_id,v.id)',''),before,'only candidate filtering changes');
 const add=async(n,account=a,key='contact-'+n,state='ready',outcome=null,urgent=false)=>{
  const id=uid(n);await q('insert into icash_operational_contacts(id,account_id,contact_key) values($1,$2,$3)',[id,account,key]);
  await q("insert into icash_voice_jobs(id,account_id,operational_contact_id,state,outcome,due_at,sms_source_message_id) values($1,$2,$1,$3,$4,now()-$5*interval '1 second',$6)",[id,account,state,outcome,10000-n,urgent?uid(n+10000):null]);return id;
 };
 const slot=(account,id)=>val('select icash_voice_queue_slot_open($1,$2)',[account,id]);
 const next=async()=>{const r=await val('select icash_next_before_fulfillment()');return r?.token?val('select voice_job_id from icash_automation_tickets where token=$1',[r.token]):null;};
 const release=()=>pg.exec("update icash_voice_scheduler set last_dispatch_at=now()-interval '31 seconds'");
 for(const state of ['issued','dispatching','unknown','review'])await scenario(async()=>{
  const waiting=await add(100,a,'waiting', 'ready',null,true),free=await add(200,b);
  if(state==='review')await q("insert into icash_live_conversations(id,account_id,contact_key,state) values($1,$2,'other','review')",[uid(900),a]);
  else await add(900,a,'other',state==='unknown'?'held':state,state==='unknown'?'provider_outcome_unknown_no_retry':null);
  assert.equal(await slot(a,waiting),false);assert.equal(await next(),free,'busy urgent job must not consume fair-account slot');
  assert.equal(await val('select state from icash_voice_jobs where id=$1',[waiting]),'ready');
 });
 await scenario(async()=>{
  const waiting=await add(100,a,'shared'),free=await add(200,b,'free');await add(900,c,'shared','dispatching');
  assert.equal(await next(),free,'same recipient on another account remains blocked');
  await pg.exec("update icash_voice_jobs set state='dispatched' where state='dispatching'");await release();
  assert.equal(await next(),waiting,'terminal evidence releases the queued job without resetting it');
 });
 for(const state of ['waiting','review'])await scenario(async()=>{
  const waiting=await add(100,a,'shared');await q('insert into icash_live_conversations(id,account_id,contact_key,state) values($1,$2,$3,$4)',[uid(900),b,'shared',state]);
  assert.equal(await slot(a,waiting),false);assert.equal(await next(),null);
  await pg.exec("update icash_live_conversations set state='complete'");assert.equal(await next(),waiting);
 });
 await scenario(async()=>{
  const first=await add(100),second=await add(101);assert.equal(await next(),first);await release();
  assert.equal(await next(),null,'a second ticket cannot race the first issued call');
  await q("update icash_voice_jobs set state='dispatched' where id=$1",[first]);assert.equal(await next(),second);
 });
 await scenario(async()=>{
  const id=await add(100);assert.equal(await slot(b,id),false);
  await q('update icash_operational_contacts set account_id=$1',[b]);assert.equal(await slot(a,id),false);
  await q('insert into icash_contact_permissions(id,account_id,contact_key) values($1,$2,$3)',[id,a,'collision']);assert.equal(await slot(a,id),false,'wrong source with matching UUID cannot supply target');
 });
 await scenario(async()=>{
  const id=await add(100);await add(900,a,'other','held','contact_operating_checks_required');assert.equal(await next(),id,'unattempted unrelated hold does not occupy calling slot');
 });
 for(const control of ['pause','wallet','config','global'])await scenario(async()=>{
  await add(100);
  await pg.exec({pause:'update icash_accounts set bot_paused=true',wallet:'update icash_wallets set balance_cents=0',config:'update icash_voice_configs set enabled=false',global:'update icash_voice_scheduler set last_dispatch_at=now()'}[control]);
  assert.equal(await next(),null);
 });
 for(const role of ['anon','authenticated'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,'icash_voice_queue_slot_open(uuid,uuid)']),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_voice_queue_slot_open(uuid,uuid)','execute')"),true);
 assert.equal(await val("select prosecdef from pg_proc where oid='icash_voice_queue_slot_open(uuid,uuid)'::regprocedure"),false);
 assert.deepEqual(await val("select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s"),finances);
 console.log('PASS queued calls wait behind active/uncertain account and recipient work; other accounts proceed, terminal calls release the slot, and controls/financial history remain unchanged.');
}finally{await pg.close();}
