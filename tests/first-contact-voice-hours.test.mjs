// SIMULATION ONLY. Exact saved production admission functions in local PostgreSQL.
// Shared clock/response helpers and ledger side effects are controlled dependencies
// here; their independent behavior is covered by the outreach-hours suite.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createOperationalContactFixture} from './helpers/operational-contact-fixture.mjs';
const require=createRequire(import.meta.url);
const f=await createOperationalContactFixture(require.resolve('@electric-sql/pglite'),{automaticChannels:true});
const {pg,q,rpc,one,isolated,account,other,screening,phone,owners,dnc,prepare}=f;
try{
 await pg.exec(`
 create view public.icash_timezone_names as select name from pg_timezone_names;
 create table voice_hours_fixture(open boolean not null,active_phone text,reservations integer default 0,cancellation_ok boolean default false);
 insert into voice_hours_fixture values(false,null,0);
 create function public.icash_outreach_timezone(p_timezone text,p_basis text default null) returns text language sql stable as $$
 select case when p_basis='conservative_nanp_window' then 'America/Chicago' when exists(select 1 from public.icash_timezone_names where name=p_timezone) then p_timezone end$$;
 create function public.icash_outreach_window_open(p_timezone text,p_basis text default null,p_clock timestamptz default now()) returns boolean language sql stable as $$select open from public.voice_hours_fixture$$;
 create function public.icash_outreach_active_conversation(p_account uuid,p_screening uuid,p_phone text,p_clock timestamptz default now()) returns boolean language sql stable as $$select active_phone=p_phone from public.voice_hours_fixture$$;
 create function public.icash_voice_credit_bound(uuid,text,uuid) returns jsonb language sql stable as $$select null::jsonb$$;
 create function public.icash_meta_voice_context(uuid,uuid) returns jsonb language sql stable as $$select '{"source":"SIMULATION form submission"}'::jsonb$$;
 create function public.icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql stable as $$select false$$;
 create function public.icash_cancellation_voice_current(p_account uuid,p_operation text) returns boolean language sql stable as $$select cancellation_ok from public.voice_hours_fixture$$;
 create or replace function public.icash_claim_inventory(p_account uuid,p_screening uuid,p_phone text default null) returns boolean language sql as $$select true$$;
 create or replace function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql as $$begin update public.voice_hours_fixture set reservations=reservations+1;return '{}';end$$;
 `);
 const opportunity=readFileSync(new URL('../config/opportunity-engine.sql',import.meta.url),'utf8');
 await pg.exec(opportunity.match(/create function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 await pg.exec('alter table icash_voice_jobs add column sms_source_message_id uuid,add column cancellation_notice_id uuid');
 for(const file of ['required-call-recording','direct-recorded-outbound','required-call-recording-final-clock'])await pg.exec(readFileSync(new URL('../config/'+file+'.sql',import.meta.url),'utf8'));
 const baseline=JSON.parse(readFileSync(new URL('./fixtures/first-contact-voice-baseline.json',import.meta.url),'utf8'));
 await pg.exec('set check_function_bodies=off');
 for(const definition of Object.values(baseline))await pg.exec(definition);
 const sql=readFileSync(new URL('../config/first-contact-voice-hours.sql',import.meta.url),'utf8');
 await pg.exec(sql);
 const originalContext=(await one("select pg_get_functiondef('public.icash_voice_outreach_context(uuid,uuid)'::regprocedure) definition")).definition;
 await pg.exec(readFileSync(new URL('../config/strict-outbound-call-hours.sql',import.meta.url),'utf8'));
 const strictHours=(await one("select pg_get_functiondef('public.icash_voice_outreach_hours_current(uuid,uuid)'::regprocedure) definition")).definition;
 const restore=readFileSync(new URL('../config/preserve-daytime-followup-context.sql',import.meta.url),'utf8');
 assert.equal(restore,readFileSync(new URL('../supabase/migrations/20261025022649_preserve_daytime_followup_context.sql',import.meta.url),'utf8'));
 await pg.exec(restore);
 assert.equal((await one("select pg_get_functiondef('public.icash_voice_outreach_context(uuid,uuid)'::regprocedure) definition")).definition,originalContext,'conversation context remains exactly the original receipt-backed evidence');
 assert.equal((await one("select pg_get_functiondef('public.icash_voice_outreach_hours_current(uuid,uuid)'::regprocedure) definition")).definition,strictHours,'restoring follow-up evidence leaves the strict final hours gate unchanged');
 await pg.exec('set check_function_bodies=on');
 const cancellationPatched=(await one("select pg_get_functiondef('public.icash_cancellation_voice_current(uuid,text)'::regprocedure) definition")).definition;
 assert.match(cancellationPatched,/icash_operational_contact_current\(p_account,j.operational_contact_id,'voice',false\)/);
 assert.doesNotMatch(cancellationPatched,/extract\(hour/);
 assert.match(cancellationPatched,/icash_cancellation_voice_context\(p_account,j.id\) is not null/);
 await pg.exec('create or replace function public.icash_cancellation_voice_current(p_account uuid,p_operation text) returns boolean language sql stable as $$select cancellation_ok from public.voice_hours_fixture$$;');
 await prepare();
 const original=await one("select * from icash_operational_contacts where account_id=$1 and channel='voice'",[account]);
 const job=(await one("insert into icash_voice_jobs(account_id,operational_contact_id,state) values($1,$2,'issued') returning id",[account,original.id])).id;
 const context=()=>rpc('icash_voice_outreach_context',{p_account:account,p_job:job});
 const allowed=()=>rpc('icash_voice_outreach_hours_current',{p_account:account,p_job:job});
 const reserve=()=>rpc('icash_reserve_paced_voice',{p_account:account,p_job:job,p_rate:owners,p_permission_until:new Date(Date.now()+3600000).toISOString(),p_financial_checked_at:null,p_financial_eligible:false});
 assert.equal(await allowed(),false,'a first call waits outside business hours');
 assert.equal(await rpc('icash_claim_voice_job',{p_job:job}),false,'normal final claim waits');
 assert.equal(await reserve(),false,'no new reservation outside hours');
 assert.equal(await rpc('icash_meta_claim_voice',{p_account:account,p_job:job}),false,'form submission is not an overnight exemption');
 assert.equal((await one('select reservations from voice_hours_fixture')).reservations,0);
 assert.equal((await one('select state from icash_voice_jobs where id=$1',[job])).state,'issued');
 assert.equal(await rpc('icash_voice_outreach_context',{p_account:other,p_job:job}),null,'context is tenant-bound');
 assert.deepEqual(await context(),{timezone:original.timezone,startHour:9,endHour:21,activeConversation:false,policyVersion:'outreach-hours-2026-10-19'});
 await isolated(async()=>{
  const legacy=(await one("insert into icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values($1,$2,'seller',$3,encode(sha256(convert_to($3,'UTF8')),'hex'),'Invalid/Zone','SIMULATION saved permission',now()+interval '1 day',now(),true) returning id",[account,screening,phone])).id;
  const invalidJob=(await one("insert into icash_voice_jobs(account_id,permission_id,state) values($1,$2,'issued') returning id",[account,legacy])).id;
  assert.equal(await rpc('icash_voice_outreach_context',{p_account:account,p_job:invalidJob}),null,'invalid stored recipient zone cannot become the fallback business clock');
  assert.equal(await rpc('icash_voice_outreach_hours_current',{p_account:account,p_job:invalidJob}),false);
 });
 await isolated(async()=>{
  await q('update icash_voice_jobs set cancellation_notice_id=gen_random_uuid() where id=$1',[job]);
  assert.equal(await allowed(),false,'a cancellation flag alone cannot bypass business hours');
  await q('update voice_hours_fixture set cancellation_ok=true');
  assert.equal((await context()).activeConversation,true,'verified cancellation evidence remains available to daytime spacing');
  assert.equal(await allowed(),false,'even a verified cancellation cannot start an overnight call');
  await q('update icash_voice_jobs set cancellation_notice_id=null where id=$1',[job]);
  assert.equal(await allowed(),false,'ordinary first calls do not inherit cancellation admission');
 });
 await isolated(async()=>{
  await q("update voice_hours_fixture set active_phone='+12145550999'");
  assert.equal(await allowed(),false,'another owner phone cannot exempt this contact');
 });
 await isolated(async()=>{
  await q('update voice_hours_fixture set active_phone=$1',[phone]);
  assert.equal((await context()).activeConversation,true,'real conversation evidence remains truthful for recipient follow-up spacing');
  assert.equal(await allowed(),false,'actual target conversation does not permit an overnight outbound call');
  assert.equal(await reserve(),false,'no new overnight call reservation after a response');
  assert.equal(await rpc('icash_claim_voice_job',{p_job:job}),false,'normal claim rejects a prior-conversation exception');
  assert.equal(await rpc('icash_meta_claim_voice',{p_account:account,p_job:job}),false,'Meta claim rejects a prior-conversation exception');
  await q('update voice_hours_fixture set open=true');
  assert.equal(await reserve(),true,'a reply still permits eligible calls inside the window');
  await q('update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]);
  assert.equal(await reserve(),false,'conversation exemption never bypasses DNC');
  assert.equal(await rpc('icash_claim_voice_job',{p_job:job}),false,'final claim still checks recipient evidence');
 });
 await isolated(async()=>{
  await q('update voice_hours_fixture set open=true');
  assert.equal(await reserve(),true,'business hours permit existing eligible reservation path');
  assert.equal((await one('select reservations from voice_hours_fixture')).reservations,1);
 });
 await isolated(async()=>{
  const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) select 'seller_call','SIMULATION final recording dial',977,costs_micros,evidence_ref,verified_at,expires_at,true,600 from icash_operation_rates where id=$1 returning id",[owners])).id;
  await q("insert into icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,max_duration_seconds,required_tool_ids) values($1,true,'agent_recordingfixture','SIMULATION number',repeat('a',64),now()+interval '1 day',$2,600,array['SIMULATION callback','SIMULATION stop'])",[account,rate]);
  const operation='voice:'+job;
  const credit=(await one("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status) values($1,$2,977,'reserved') returning id",[account,operation])).id;
  await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values($1,$2,$3,$4,977,1000,'dispatched',now()+interval '1 day')",[operation,account,rate,credit]);
  await q("update icash_voice_jobs set state='dispatching',operation_key=$2 where id=$1",[job,operation]);
  const recording=(await one("insert into icash_call_recordings(account_id,operation_key,voice_job_id,operational_contact_id,screening_id,party,provider_account_sid,to_phone,from_phone,contact_key,agent_id,branch_id,version_id,rate_id,charge_cap_cents,max_total_seconds,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,consent_deadline_at,entry_policy) values($1,$2,$3,$4,$5,'seller','AC'||repeat('a',32),$6,'+12145550888',$7,'agent_recordingfixture','agtbrch_fixture','agtvrsn_fixture',$8,977,600,repeat('a',64),repeat('b',64),'SIMULATION disclosure','{}',clock_timestamp()+interval '10 minutes','direct_recorded_v1') returning id",[account,operation,job,original.id,screening,phone,original.contact_key,rate])).id;
  const transition=(action,payload={})=>rpc('icash_transition_call_recording',{p_id:recording,p_account:account,p_operation:operation,p_expected_state:'consent_pending',p_action:action,p_payload:payload});
  assert.equal(await transition('claim_dial'),null,'actual provider dial cannot cross the closed window');
  assert.equal((await one('select dial_claimed_at from icash_call_recordings where id=$1',[recording])).dial_claimed_at,null);
  await q('update voice_hours_fixture set open=true');
  assert((await transition('claim_dial')).dial_claimed_at,'final dial works while open');
  await q('update voice_hours_fixture set open=false');
  assert(await transition('bind_call',{callSid:'CA'+'b'.repeat(32),providerAccountSid:'AC'+'a'.repeat(32),fromPhone:'+12145550888',toPhone:phone}));
  await q('savepoint retained_contact_guard');
  await q('update icash_dnc_verification_receipts set clear=false where id=$1',[dnc]);
  assert.equal(await transition('authorize_recording',{nonceHash:'a'.repeat(64),policy:'direct_recorded_v1'}),null,'ongoing recording still honors current contact evidence');
  await q('rollback to savepoint retained_contact_guard');
  assert((await transition('authorize_recording',{nonceHash:'a'.repeat(64),policy:'direct_recorded_v1'})).recording_authorized_at,'already dialed call can authorize recording after closing time');
  assert.equal((await transition('claim_start')).state,'starting','already dialed call can start recording after closing time');
 });
 await isolated(async()=>{
  const rate=(await one("insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) select 'seller_call','SIMULATION callback source',charge_cents,costs_micros,evidence_ref,verified_at,expires_at,true,600 from icash_operation_rates where id=$1 returning id",[owners])).id;
  const operation='SIMULATION callback source';
  const credit=(await one("insert into icash_credit_reservations(account_id,operation_key,amount_cents,status) values($1,$2,100,'reserved') returning id",[account,operation])).id;
  await q("insert into icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,state,permission_until) values($1,$2,$3,$4,100,1000,'dispatched',now()+interval '1 day')",[operation,account,rate,credit]);
  const due=new Date(Date.now()-60000).toISOString();
  const result={transcript:[{role:'user',message:'Please call me tomorrow evening.'}],callbackDueAt:due};
  const call=(await one("insert into icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,state,result,created_at,completed_at) values($1,$2,'seller','agent_callbackfixture','conv_callbackfixture',$3,$4,'flexible_timing','complete',$5,now()-interval '2 days',now()-interval '2 days') returning id",[account,screening,operation,original.contact_key,result])).id;
  const callback=(await one("insert into icash_live_callbacks(account_id,screening_id,conversation_id,due_at,timezone,evidence) values($1,$2,$3,$4,$5,'{\"source\":\"SIMULATION actual callback request\"}') returning id",[account,screening,call,due,original.timezone])).id;
  const callbackJob=(await one("insert into icash_voice_jobs(account_id,operational_contact_id,callback_id,due_at,state) values($1,$2,$3,$4,'issued') returning id",[account,original.id,callback,due])).id;
  const callbackHours=()=>rpc('icash_voice_outreach_hours_current',{p_account:account,p_job:callbackJob});
  assert.equal((await rpc('icash_voice_outreach_context',{p_account:account,p_job:callbackJob})).activeConversation,true,'receipt-bound due callbacks retain their follow-up context');
  assert.equal(await callbackHours(),false,'verified due callback must still be inside the outbound window');
  await q("update icash_live_conversations set result=jsonb_set(result,'{callbackDueAt}','\"not a timestamp\"') where id=$1",[call]);
  assert.equal(await callbackHours(),false,'malformed callback evidence fails closed');
  await q('update icash_live_conversations set result=$2 where id=$1',[call,result]);
  await q("update icash_live_callbacks set state='canceled' where id=$1",[callback]);
  assert.equal(await callbackHours(),false,'canceled callback never grants an exemption');
 });
 const wake=sql.slice(sql.indexOf('update public.icash_voice_jobs j set state='),sql.lastIndexOf('commit;'));
 for(const [name,change,shouldWake] of [
  ['unattempted old hours',null,true],
  ['manual Pause',"update icash_accounts set bot_paused=true",false],
  ['provider receipt',"update icash_voice_jobs set provider_call_sid='SIMULATION prior provider call'",false],
  ['conversation receipt',"update icash_voice_jobs set conversation_id='SIMULATION prior conversation'",false],
  ['operation binding',"update icash_voice_jobs set operation_key='SIMULATION prior operation'",false],
  ['SMS callback',"update icash_voice_jobs set sms_source_message_id=gen_random_uuid()",false],
  ['cancellation',"update icash_voice_jobs set cancellation_notice_id=gen_random_uuid()",false],
  ['different hold',"update icash_voice_jobs set state='held',outcome='provider_outcome_unknown_no_retry'",false],
  ['outside new hours',"update voice_hours_fixture set open=false",false],
 ])await isolated(async()=>{
  await q('update voice_hours_fixture set open=true');
  await q("update icash_voice_jobs set state='ready',due_at=now()+interval '1 hour',outcome='Waiting for calling hours' where id=$1",[job]);
  if(change)await q(change);
  const before=await one('select * from icash_voice_jobs where id=$1',[job]);
  await pg.exec(wake);
  const after=await one('select * from icash_voice_jobs where id=$1',[job]);
  if(shouldWake){assert(after.due_at<before.due_at,name);assert.equal(after.outcome,null);}
  else assert.deepEqual(after,before,name+' remains unchanged');
 });
 assert.deepEqual(await one('select * from icash_operational_contacts where id=$1',[original.id]),original,'historical source timezone/window evidence is unchanged');
 for(const name of ['icash_voice_outreach_context','icash_voice_outreach_hours_current'])for(const role of ['anon','authenticated']){
  assert.equal((await one(`select has_function_privilege($1,'public.${name}(uuid,uuid)','EXECUTE') exposed`,[role])).exposed,false);
 }
 const definitions=await q("select proname,pg_get_functiondef(oid) definition from pg_proc where proname in ('icash_claim_voice_job','icash_reserve_paced_voice','icash_meta_claim_voice','icash_transition_call_recording')");
 for(const row of definitions.rows)assert.match(row.definition,/icash_voice_outreach_hours_current/);
 const recordingDefinition=definitions.rows.find(row=>row.proname==='icash_transition_call_recording').definition;
 assert.match(recordingDefinition,/final_provider_started_at/,'prior recording clock reconciliation remains intact');
 console.log('Voice business hours: normal/Meta/final provider gates, no overnight calls or reservations after replies/callbacks, ongoing calls continue, retained DNC, immutable metadata and private helpers passed locally.');
}finally{await pg.close();}
