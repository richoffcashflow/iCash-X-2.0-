// Isolated Postgres fixture. Never dials, charges or connects to production.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/unstarted-voice-configuration-recovery.sql');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0'),account=uid(1),hash='a'.repeat(64);
try{
 await pg.exec(`
 create role anon;create role authenticated;create role service_role bypassrls;create schema icash_recording_private;
 grant usage on schema icash_recording_private to service_role;
 create function icash_recording_private.audit_immutable() returns trigger language plpgsql as $$begin raise exception 'Append only';end$$;
 create table icash_operating_budget(id int primary key,enabled boolean);insert into icash_operating_budget values(1,true);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_wallets(account_id uuid,balance_cents bigint default 10000,reserved_cents bigint default 0);
 create table icash_voice_configs(account_id uuid,enabled boolean default true,agent_id text default 'agent_fixture',agent_config_hash text,reviewed_until timestamptz default now()+interval '1 day');
 create table icash_voice_production_template(id int,enabled boolean default true,agent_id text default 'agent_fixture',agent_config_hash text,reviewed_until timestamptz default now()+interval '1 day');
 create table icash_screening_jobs(id uuid,account_id uuid,state text default 'complete',result jsonb default '{"financialCheck":{"status":"eligible"}}',snapshot jsonb default jsonb_build_object('fetchedAt',now()));
 create table icash_voice_contact_targets(id uuid,account_id uuid,screening_id uuid,contact_key text,party text default 'seller',revoked_at timestamptz,permission_until timestamptz default now()+interval '1 day',eligibility_source text default 'operational_checks_only');
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,sms_source_message_id uuid,cancellation_notice_id uuid,meta_offer_lead_id uuid,meta_retry_of uuid,meta_followup_lead_id uuid,
  state text default 'held',outcome text default 'production_agent_review_required',operation_key text,provider_call_sid text,conversation_id text,due_at timestamptz default now()-interval '1 day',created_at timestamptz default now()-interval '1 day',updated_at timestamptz default now()-interval '1 hour');
 create table icash_automation_tickets(id uuid primary key,voice_job_id uuid,account_id uuid,kind text default 'voice_dispatch',state text default 'held',outcome text default 'production_agent_review_required',created_at timestamptz default now()-interval '1 hour',completed_at timestamptz default now()-interval '59 minutes',expires_at timestamptz default now()-interval '58 minutes');
 create table icash_operation_spend(operation_key text,state text);create table icash_call_recordings(voice_job_id uuid,operation_key text);create table icash_live_conversations(operation_key text);
 create table fixture_policy(kind text primary key,allowed boolean);insert into fixture_policy values('membership',true),('channel',true),('operational',true),('permission',true),('hours',true),('spacing',true),('capacity',true),('slot',true);
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='membership'$$;
 create function icash_outreach_voice_current(uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='channel'$$;
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select allowed from public.fixture_policy where kind='operational'$$;
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='permission'$$;
 create function icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='hours'$$;
 create function icash_seller_phone_call_current(uuid,uuid) returns boolean language sql as $$select allowed from public.fixture_policy where kind='spacing'$$;
 create function icash_voice_capacity_available(uuid,text,text,text,boolean) returns boolean language sql as $$select allowed from public.fixture_policy where kind='capacity'$$;
 create function icash_outgoing_voice_capacity_open() returns boolean language sql as $$select allowed from public.fixture_policy where kind='capacity'$$;
 create function icash_voice_queue_slot_open(a uuid,j uuid) returns boolean language sql as $$select exists(select 1 from public.icash_voice_jobs where id=j and account_id=a and state='ready') and (select allowed from public.fixture_policy where kind='slot')$$;
 `);
 await q('insert into icash_accounts(id) values($1)',[account]);await q('insert into icash_wallets(account_id) values($1)',[account]);
 await q('insert into icash_voice_configs(account_id,agent_config_hash) values($1,$2)',[account,hash]);await q('insert into icash_voice_production_template(id,agent_config_hash) values(1,$1)',[hash]);
 await pg.exec(sql);
 const add=async(n,{contact='contact-'+n,legacy=false}={})=>{
  const id=uid(n);
  await q('insert into icash_screening_jobs(id,account_id) values($1,$2)',[id,account]);
  await q('insert into icash_voice_contact_targets(id,account_id,screening_id,contact_key,eligibility_source) values($1,$2,$1,$3,$4)',[id,account,contact,legacy?'operator_record':'operational_checks_only']);
  await q(`insert into icash_voice_jobs(id,account_id,${legacy?'permission_id':'operational_contact_id'}) values($1,$2,$1)`,[id,account]);
  await q('insert into icash_automation_tickets(id,account_id,voice_job_id) values($1,$2,$1)',[id,account]);return id;
 };
 const recover=()=>val("select icash_recover_voice_configuration('agent_fixture',$1,$1,$2,clock_timestamp())",[hash,'b'.repeat(40)]);
 const isolated=async fn=>{await q('begin');try{await fn();}finally{await q('rollback');}};
 for(const legacy of [false,true])await isolated(async()=>{
  const id=await add(100,{legacy}),tickets=await val('select jsonb_agg(t) from icash_automation_tickets t');
  assert.equal(await recover(),1);assert.equal(await val('select state from icash_voice_jobs where id=$1',[id]),'ready');
  assert.deepEqual(await val('select jsonb_agg(t) from icash_automation_tickets t'),tickets,'the original consumed ticket remains closed');
  assert.equal(await val('select previous_outcome from icash_recording_private.configuration_recoveries'),'production_agent_review_required');
  assert.equal(await val('select count(*)::int from icash_operation_spend'),0);assert.equal(await val('select balance_cents::int from icash_wallets'),10000);
  assert.equal(await recover(),0,'repeat maintenance cannot rearm the job');
  await q("update icash_voice_jobs set state='held',outcome='production_agent_review_required' where id=$1",[id]);
  assert.equal(await recover(),0,'even a second configuration failure cannot loop');
 });
 for(const mutate of [
  "update icash_voice_jobs set state='dispatching'","update icash_voice_jobs set outcome='provider_outcome_unknown_no_retry'","update icash_voice_jobs set operation_key='previous'","update icash_voice_jobs set provider_call_sid='saved-call'","update icash_voice_jobs set conversation_id='saved-conversation'",
  "insert into icash_operation_spend select 'voice:'||id,'settled' from icash_voice_jobs","insert into icash_call_recordings select id,'voice:'||id from icash_voice_jobs","insert into icash_live_conversations select 'voice:'||id from icash_voice_jobs",
  "update icash_accounts set bot_paused=true","update icash_wallets set balance_cents=0","update icash_voice_configs set enabled=false","update icash_voice_configs set agent_config_hash=repeat('c',64)","update icash_voice_production_template set enabled=false","update icash_operating_budget set enabled=false",
  "update icash_voice_contact_targets set revoked_at=now()","update icash_voice_contact_targets set permission_until=now()-interval '1 second'","update icash_voice_contact_targets set account_id='00000000-0000-4000-8000-000000000002'","update icash_voice_contact_targets set party='buyer'","update icash_voice_contact_targets set eligibility_source='operator_record'",
  "update icash_screening_jobs set result='{\"financialCheck\":{\"status\":\"hold\"}}'","update icash_automation_tickets set completed_at=null","update icash_automation_tickets set state='consumed'","update icash_automation_tickets set expires_at=now()+interval '1 minute'",
  "update icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now()-interval '25 hours')","update icash_screening_jobs set snapshot='{\"fetchedAt\":\"invalid\"}'","update icash_screening_jobs set snapshot=jsonb_build_object('fetchedAt',now()+interval '1 minute')",
  ...['callback_id','sms_source_message_id','cancellation_notice_id','meta_offer_lead_id','meta_retry_of','meta_followup_lead_id'].map(c=>`update icash_voice_jobs set ${c}=id`),
  ...['membership','channel','operational','hours','spacing','capacity','slot'].map(k=>`update fixture_policy set allowed=false where kind='${k}'`),
 ])await isolated(async()=>{await add(100);await pg.exec(mutate);const before=await val('select jsonb_agg(j) from icash_voice_jobs j');assert.equal(await recover(),0,mutate);assert.deepEqual(await val('select jsonb_agg(j) from icash_voice_jobs j'),before,mutate);});
 await isolated(async()=>{
  await add(100);await q('insert into icash_automation_tickets(id,account_id,voice_job_id) values($1,$2,$3)',[uid(999),account,uid(100)]);
  assert.equal(await recover(),0,'ambiguous/multiple handler history is not retried');
 });
 await isolated(async()=>{
  await add(100,{contact:'same-person'});await add(101,{contact:'same-person'});
  assert.equal(await recover(),1);assert.equal(await recover(),0,'another property/contact route cannot duplicate the queued recipient');
 });
 await isolated(async()=>{
  for(let n=100;n<145;n++){await add(n);if(n<120)await q("update icash_voice_contact_targets set permission_until=now()-interval '1 day' where id=$1",[uid(n)]);}
  assert.equal(await recover(),20,'ineligible older candidates do not consume the batch');assert.equal(await recover(),5);assert.equal(await recover(),0);
 });
 await isolated(async()=>{
  await add(100);
  for(const timestamp of ["now()-interval '3 minutes'","now()+interval '1 minute'","null"]){assert.equal(await val(`select icash_recover_voice_configuration('agent_fixture',$1,$1,$2,${timestamp})`,[hash,'b'.repeat(40)]),0);}
 });
 for(const role of ['anon','authenticated']){
  assert.equal(await val("select has_function_privilege($1,'icash_recover_voice_configuration(text,text,text,text,timestamptz)','execute')",[role]),false);
  assert.equal(await val("select has_table_privilege($1,'icash_recording_private.configuration_recoveries','select')",[role]),false);
 }
 assert.equal(await val("select prosecdef from pg_proc where proname='icash_recover_voice_configuration'"),false);
 assert.equal(sql,read('supabase/migrations/20261030183441_unstarted_voice_configuration_recovery.sql'));
 console.log('Unstarted voice recovery: provider rejection only; original tickets, unknown operations, wallet, recipient controls, duplicate protection and private audit verified. Offline only.');
}finally{await pg.close();}
