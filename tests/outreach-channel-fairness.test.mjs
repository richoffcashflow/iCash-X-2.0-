// LOCAL ONLY: actual production voice issuer and router over synthetic queues.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(sql,args=[])=>pg.query(sql,args);
const val=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=uid(1),b=uid(2),c=uid(3),migration=read('config/outreach-channel-fairness.sql');
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
 const baseline=JSON.parse(read('tests/fixtures/outreach-channel-fairness-baseline.json'));
 for(const definition of Object.values(baseline))await pg.exec(definition);
 await pg.exec(`
 create table fixture_lanes(id integer primary key,sms boolean default true,voice boolean default true,recovery boolean default false,phone_allowed boolean default true);
 insert into fixture_lanes(id) values(1);
 create or replace function icash_outgoing_voice_capacity_open() returns boolean language sql stable as $$select voice from public.fixture_lanes where id=1$$;
 create or replace function icash_seller_phone_call_current(uuid,uuid) returns boolean language sql stable as $$select phone_allowed from public.fixture_lanes where id=1$$;
 create function icash_recover_unstarted_seller_opener() returns jsonb language sql stable as $$select case when recovery then '{"token":"original-recovery"}'::jsonb end from public.fixture_lanes where id=1$$;
 create function icash_next_before_unstarted_sms_recovery() returns jsonb language plpgsql as $$declare ticket public.icash_automation_tickets;begin
  if (select sms from public.fixture_lanes where id=1) then
   insert into public.icash_automation_tickets(account_id,kind) values('${a}','seller_opener') returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
  return public.icash_next_before_fulfillment();
 end$$;
 create index icash_automation_kind_recent on icash_automation_tickets(kind,created_at desc);
 revoke all on function icash_next_before_fulfillment(),icash_next_before_owner_question() from public,anon,authenticated;
 grant execute on function icash_next_before_fulfillment(),icash_next_before_owner_question() to service_role;
 `);
 const add=async(n,{account=a,expires='future',state='ready'}={})=>{
  const id=uid(n);
  await q("insert into icash_operational_contacts(id,account_id,contact_key,permission_until) values($1,$2,$3,case when $4='expired' then now()-interval '1 second' else now()+interval '1 day' end)",[id,account,'fixture-'+n,expires]);
  await q('insert into icash_voice_jobs(id,account_id,operational_contact_id,state,due_at) values($1,$2,$1,$3,now()-interval \'1 hour\')',[id,account,state]);
  return id;
 };
 const picked=async(fn='icash_next_before_owner_question')=>{
  const result=await val(`select ${fn}()`);
  return result?.token==='original-recovery'?'recovery':result?.token?val('select kind from icash_automation_tickets where token=$1',[result.token]):null;
 };
 await scenario(async()=>{
  await add(100);
  for(let n=0;n<8;n++)assert.equal(await picked(),'seller_opener');
  assert.equal(await val("select count(*) from icash_voice_jobs where state='ready'"),1,'reproduces sustained SMS starving a ready call');
 });
 const finances=await val('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s');
 await pg.exec(migration);
 const helper=await val("select pg_get_functiondef('icash_issue_ready_voice_ticket()'::regprocedure)");
 assert.equal(helper,baseline.icash_next_before_fulfillment.replace('FUNCTION public.icash_next_before_fulfillment()','FUNCTION public.icash_issue_ready_voice_ticket()').replace('return public.icash_next_before_voice_dispatch();','return null;'),'all original account, recipient, capacity, fairness and interval checks are retained exactly');
 await scenario(async()=>{
  await add(100);await add(101,{account:b});await add(102,{account:c});
  assert.equal(await picked(),'voice_dispatch');
  await pg.exec("update icash_voice_scheduler set last_dispatch_at=now()-interval '4 seconds'");
  assert.equal(await picked(),'seller_opener','a call yields to the pending text lane');
  assert.equal(await picked(),'voice_dispatch','the text gives the next eligible call its turn');
  assert.equal(await picked(),'seller_opener','calls cannot monopolize the next turn');
  await pg.exec("update icash_voice_scheduler set last_dispatch_at=now()-interval '4 seconds'");
  assert.equal(await picked(),'voice_dispatch');
 });
 for(const blocker of ['capacity','recent','phone','expired','held','pause','wallet','disabled'])await scenario(async()=>{
  await add(200,{expires:blocker==='expired'?'expired':'future',state:blocker==='held'?'held':'ready'});
  const changes={capacity:'update fixture_lanes set voice=false',recent:'update icash_voice_scheduler set last_dispatch_at=now()',phone:'update fixture_lanes set phone_allowed=false',expired:'select 1',held:'select 1',pause:'update icash_accounts set bot_paused=true',wallet:'update icash_wallets set balance_cents=0',disabled:'update icash_operating_budget set enabled=false'};
  await pg.exec(changes[blocker]);
  assert.equal(await picked(),'seller_opener',blocker+' must leave unrelated text work moving');
  assert.equal(await val("select count(*) from icash_automation_tickets where kind='voice_dispatch'"),0);
 });
 await scenario(async()=>{
  await add(300);await pg.exec('update fixture_lanes set sms=false');
  await pg.exec("update icash_voice_scheduler set last_dispatch_at=now()-interval '1 minute'");
  assert.equal(await picked(),'voice_dispatch','an empty SMS lane immediately falls through to the original voice position');
 });
 await scenario(async()=>{
  await add(400);await pg.exec('update fixture_lanes set recovery=true');
  assert.equal(await picked(),'recovery','existing receipt-backed recovery remains ahead of new outreach');
  assert.equal(await val('select count(*) from icash_automation_tickets'),0);
 });
 await scenario(async()=>{
  await add(500,{expires:'expired'});const good=await add(501,{account:c});
  assert.equal(await picked(),'voice_dispatch');
  assert.equal(await val("select voice_job_id from icash_automation_tickets where kind='voice_dispatch'"),good);
 });
 assert.deepEqual(await val('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s'),finances,'no money or unknown receipts change');
 for(const role of ['anon','authenticated'])for(const fn of ['icash_issue_ready_voice_ticket()','icash_next_outreach_channel()','icash_next_before_fulfillment()','icash_next_before_owner_question()'])assert.equal(await val('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false);
 assert.equal(migration,read('supabase/migrations/20261026173920_outreach_channel_fairness.sql'));
 console.log('Outreach channel fairness: sustained SMS and eligible calls both progress; unavailable lanes yield; original voice gates, recovery, held work, wallets and private access preserved. Local fixtures only.');
}finally{await pg.close();}
