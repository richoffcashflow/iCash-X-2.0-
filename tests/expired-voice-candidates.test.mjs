// LOCAL ONLY: real issuer SQL over synthetic records. No provider traffic.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args);
const val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=uid(1),b=uid(2),c=uid(3),migration=read('config/expired-voice-candidates.sql');
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

 await pg.exec(`alter table icash_voice_jobs add column operation_key text,add column provider_call_sid text,add column conversation_id text;
 alter table icash_automation_tickets add column state text default 'issued',add column outcome text,add column expires_at timestamptz default now()+interval '2 minutes',add column completed_at timestamptz,add column screening_id uuid,add column opener_message_id uuid,add column prospecting_quote_cents bigint;
 alter table icash_live_conversations add column operation_key text;
 alter table icash_operational_contacts add column revoked_at timestamptz,add column permission_until timestamptz default now()+interval '1 day';
 alter table icash_contact_permissions add column revoked_at timestamptz,add column permission_until timestamptz default now()+interval '1 day';
 create or replace view icash_voice_contact_targets as
 select id,account_id,screening_id,contact_key,party,'operator_record'::text eligibility_source,revoked_at,permission_until from icash_contact_permissions
 union all select id,account_id,screening_id,contact_key,party,'operational_checks_only',revoked_at,permission_until from icash_operational_contacts;
 create function icash_outgoing_voice_capacity_open() returns boolean language sql as $$select true$$;
 create function icash_voice_queue_slot_open(uuid,uuid) returns boolean language sql as $$select true$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
 create function icash_prospecting_available(uuid) returns bigint language sql as $$select 10000::bigint$$;
 create function icash_research_waiting_on_outreach(uuid) returns boolean language sql as $$select false$$;
 create function icash_dealmachine_capacity_available() returns boolean language sql as $$select true$$;
 create function icash_wake_funded_outreach(uuid) returns void language sql as $$select$$;
 create table icash_text_messages(id uuid,account_id uuid,state text,provider_id text,last_delivery_at timestamptz);
 `);
 for(const account of [a,b,c]){await q('insert into icash_accounts values($1,false)',[account]);await q('insert into icash_wallets(account_id) values($1)',[account]);await q('insert into icash_voice_configs(account_id) values($1)',[account]);}
 const baseline=JSON.parse(read('tests/fixtures/expired-voice-candidates-baseline.json'));
 for(const definition of Object.values(baseline))await pg.exec(definition);
 await pg.exec('revoke all on function icash_next_before_fulfillment(),icash_resume_prospecting_ticket() from public,anon,authenticated;grant execute on function icash_next_before_fulfillment(),icash_resume_prospecting_ticket() to service_role');
 const finances=await val('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s');
 await pg.exec(migration);
 const add=async(n,{account=a,expires='future',state='ready',legacy=false,urgent=false,wrongAccount=false}={})=>{
  const id=uid(n),table=legacy?'icash_contact_permissions':'icash_operational_contacts';
  await q(`insert into ${table}(id,account_id,contact_key,permission_until,revoked_at) values($1,$2,$3,case when $4='expired' then now()-interval '1 second' when $4='null' then null else now()+interval '1 day' end,case when $4='revoked' then now() else null end)`,[id,wrongAccount?b:account,'fixture-'+n,expires]);
  await q(`insert into icash_voice_jobs(id,account_id,${legacy?'permission_id':'operational_contact_id'},state,outcome,due_at,sms_source_message_id) values($1,$2,$1,$3,$4,now()-interval '1 hour',$5)`,[id,account,state,state==='held'?'prospecting_budget_held':null,urgent?uid(90000+n):null]);
  if(state==='held')await q("insert into icash_automation_tickets(account_id,kind,voice_job_id,state,outcome,expires_at,created_at,prospecting_quote_cents) values($1,'voice_dispatch',$2,'held','prospecting_budget_held',now()-interval '1 minute',now()-interval '2 hours'+$3*interval '1 second',500)",[account,id,n]);
  return id;
 };
 const picked=async(fn)=>{const result=await val(`select ${fn}()`);return result?.token?val('select voice_job_id from icash_automation_tickets where token=$1',[result.token]):null;};
 for(const legacy of [false,true])for(const urgent of [false,true])await scenario(async()=>{
  for(let n=100;n<140;n++)await add(n,{legacy,urgent,expires:'expired'});
  await add(141,{legacy,urgent,expires:'revoked'});await add(142,{legacy,urgent,expires:'null'});await add(143,{legacy,urgent,wrongAccount:true});
  const good=await add(200,{legacy,urgent,account:c});
  assert.equal(await picked('icash_next_before_fulfillment'),good,'fresh job survives older expired/revoked/wrong-account targets');
  assert.equal(Number(await val("select count(*) from icash_voice_jobs where state='ready'")),43,'skipped history is unchanged');
 });
 for(const legacy of [false,true])await scenario(async()=>{
  for(let n=300;n<340;n++)await add(n,{legacy,expires:'expired',state:'held'});
  await add(341,{legacy,expires:'revoked',state:'held'});await add(342,{legacy,expires:'null',state:'held'});
  const good=await add(500,{legacy,state:'held',account:c});
  const old=await val("select jsonb_agg(to_jsonb(t) order by id) from icash_automation_tickets t where account_id=$1",[a]);
  assert.equal(await picked('icash_resume_prospecting_ticket'),good,'expired entries are excluded before the 20-ticket batch');
  assert.deepEqual(await val("select jsonb_agg(to_jsonb(t) order by id) from icash_automation_tickets t where account_id=$1",[a]),old,'expired held tickets never reset or reissue');
 });
 await scenario(async()=>{
  const unknown=await add(600,{state:'held'}),good=await add(601,{state:'held',account:c});
  await q("insert into icash_operation_spend(operation_key,state) values($1,'dispatched')",['voice:'+unknown]);
  assert.equal(await picked('icash_resume_prospecting_ticket'),good,'original unknown operation is never retried');
  assert.equal(await val('select state from icash_voice_jobs where id=$1',[unknown]),'held');
 });
 for(const control of ['pause','wallet','global'])await scenario(async()=>{
  await add(700);await pg.exec({pause:'update icash_accounts set bot_paused=true',wallet:'update icash_wallets set balance_cents=0',global:'update icash_operating_budget set enabled=false'}[control]);
  assert.equal(await picked('icash_next_before_fulfillment'),null);
 });
 assert.deepEqual(await val('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s'),finances);
 for(const role of ['anon','authenticated'])for(const fn of Object.keys(baseline))assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 assert.equal(migration,read('supabase/migrations/20261026162037_expired_voice_candidates.sql'));
 console.log('Expired voice candidates: current legacy/operational and urgent/ordinary jobs survive expired queues; resume filters before batch, keeps original holds, Pause, wallet and private access. Local fixtures only.');
}finally{await pg.close();}
