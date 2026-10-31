// Offline PostgreSQL: exact production function/schema fixtures, no provider traffic.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const schema=JSON.parse(read('tests/fixtures/seller-phone-spacing-schema.json'));
const baseline=JSON.parse(read('tests/fixtures/seller-phone-spacing-baseline.json'));
const sql=read('config/seller-phone-call-spacing.sql');
const demoSql=read('config/owner-demo-call-spacing.sql');
assert.equal(demoSql,read('supabase/migrations/20261031012000_owner_demo_call_spacing.sql'));
const callbackSql=read('config/owner-demo-requested-callbacks.sql');
assert.equal(callbackSql,read('supabase/migrations/20261031012100_owner_demo_requested_callbacks.sql'));
assert.equal(sql,read('supabase/migrations/20261020000300_seller_phone_call_spacing.sql'));
const pg=await PGlite.create(),q=(s,p=[])=>pg.query(s,p);
const one=async(s,p=[])=>(await q(s,p)).rows[0];
const val=async(s,p=[])=>Object.values(await one(s,p))[0];
const a=randomUUID(),b=randomUUID(),phone='+12145550123';let scenarios=0;
const owner=ownerInboundTarget.accountId,ownerPhone=ownerInboundTarget.ownerPhone;
const scenario=async(name,fn)=>{await pg.exec('begin');try{await fn();scenarios++;}catch(e){throw new Error(name+': '+e.message,{cause:e});}finally{await pg.exec('rollback');}};
const allow=(job,account=a)=>val('select icash_seller_phone_call_current($1,$2)',[account,job]);
async function job(account=a,recipient=phone){
 const id=randomUUID(),contact=randomUUID(),screen=randomUUID();
 await q("insert into icash_contact_permissions(id,account_id,screening_id,phone,contact_key,party,permission_until,dnc_clear,timezone) values($1,$2,$3,$4,$4,'seller',now()+interval '1 day',true,'America/Chicago')",[contact,account,screen,recipient]);
 await q("insert into icash_voice_jobs(id,account_id,permission_id,state,due_at,created_at,updated_at) values($1,$2,$3,'ready',now()-interval '1 minute',now(),now())",[id,account,contact]);
 return id;
}
async function attempted(id,minutes=5,{unknown=false,recipient=phone}={}){
 const j=await one('select * from icash_voice_jobs where id=$1',[id]);const record=randomUUID();
 await q("insert into icash_call_recordings(id,voice_job_id,account_id,screening_id,party,to_phone,dial_claimed_at,call_sid,call_ended_at,state,operation_key) select $1,$2,$3,p.screening_id,'seller',$4,now()-$5*interval '1 minute',$6,case when $7 then null else now() end,'failed','voice:'||($2::uuid)::text from icash_contact_permissions p where p.id=$8",[record,id,j.account_id,recipient,minutes,unknown?null:'CA'+'a'.repeat(32),unknown,j.permission_id]);
 await q("update icash_voice_jobs set state='held' where id=$1",[id]);
 return record;
}
async function dialRow(id,recipient=phone){
 const j=await one('select j.*,p.screening_id from icash_voice_jobs j join icash_contact_permissions p on p.id=j.permission_id where j.id=$1',[id]),record=randomUUID();
 await q("insert into icash_operation_spend(operation_key,account_id,state,permission_until) values($1,$2,'dispatched',now()+interval '1 day')",['voice:'+id,j.account_id]);
 await q("insert into icash_call_recordings(id,account_id,voice_job_id,permission_id,party,to_phone,operation_key,state,row_version,consent_deadline_at,screening_id) values($1,$2,$3,$4,'seller',$5,$6,'consent_pending',1,now()+interval '2 minutes',$7)",[record,j.account_id,id,j.permission_id,recipient,'voice:'+id,j.screening_id]);
 return record;
}
const claim=(record,id,account=a)=>val("select icash_transition_call_recording($1,$2,$3,'consent_pending','claim_dial','{}')",[record,account,'voice:'+id]);
async function ownerDemo(){
 const id=await job(owner,ownerPhone),lead=randomUUID(),request=randomUUID();
 const p=await one('select p.* from icash_voice_jobs j join icash_contact_permissions p on p.id=j.permission_id where j.id=$1',[id]);
 await q("update icash_contact_permissions set seller_intake_id=$2,contact_key=encode(sha256(convert_to(phone,'UTF8')),'hex') where id=$1",[p.id,lead]);
 await q("insert into icash_seller_intakes(id,request_id,phone,state,ai_consented,contact_consent_scope,attribution,created_at) values($1,$2,$3,'assigned',true,'icash_x_demo',$4,now()-interval '2 minutes')",[lead,request,ownerPhone,{demoAccountId:owner}]);
 await q("insert into icash_screening_jobs(id,account_id,state) values($1,$2,'complete')",[p.screening_id,owner]);
 await q('insert into icash_seller_matches values($1,$2,$3)',[lead,owner,p.screening_id]);
 await q("insert into icash_optin_call_requests values($1,$2,$3,$4,$5,'demo_form','icash-optin-call-now-2026-10-16.1','icash-optin-call-now-2026-10-16.1',now()-interval '1 minute',now()+interval '4 minutes')",[lead,request,ownerPhone,owner,ownerInboundTarget.ownerUserId]);
 await q('insert into fixture_demo_permission values($1,$2)',[owner,p.id]);
 return {id,lead,permission:p.id,screen:p.screening_id};
}
try{
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema icash_recording_private;');
 for(const table of schema)await pg.exec(`create table public.${table.name} (${table.columns.map(c=>`"${c.name}" ${c.type}`).join(',')});`);
 await pg.exec(`
 create view public.icash_voice_contact_targets as
 select id,account_id,screening_id,phone,contact_key,party,permission_until,revoked_at,dnc_clear,dnc_checked_at,timezone,local_start_hour,local_end_hour,'operator_record'::text eligibility_source from icash_contact_permissions
 union all select id,account_id,screening_id,phone,contact_key,'seller',eligibility_until,revoked_at,true,created_at,timezone,9,21,'operational_checks_only' from icash_operational_contacts;
 create table fixture_active(account_id uuid,job_id uuid);create table fixture_requested(account_id uuid,job_id uuid);
 create table fixture_demo_permission(account_id uuid,permission_id uuid);
 create table icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid);
 create table icash_optin_call_requests(lead_id uuid,request_id uuid,phone text,account_id uuid,requested_by uuid,source text,request_version text,request_reference text,requested_at timestamptz,expires_at timestamptz);
 create table icash_text_suppressions(phone text);create table icash_contact_suppressions(contact_key text);
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid,receipt jsonb,created_at timestamptz);
 create function icash_voice_outreach_context(uuid,uuid) returns jsonb language sql stable as $$select jsonb_build_object('activeConversation',exists(select 1 from public.fixture_active where account_id=$1 and job_id=$2))$$;
 create function icash_requested_seller_call_current(uuid,uuid) returns boolean language sql stable as $$select exists(select 1 from public.fixture_requested where account_id=$1 and job_id=$2)$$;
 create function icash_membership_work_allowed(uuid) returns boolean language sql stable as $$select true$$;
 create function icash_voice_attempt_recorded(uuid) returns boolean language sql stable as $$select exists(select 1 from public.icash_call_recordings where voice_job_id=$1 and call_sid is not null)$$;
 create function icash_meta_call_outcome(jsonb) returns text language sql immutable as $$select 'no_response'::text$$;
 create function icash_voice_outreach_hours_current(uuid,uuid) returns boolean language sql stable as $$select true$$;
 create function icash_seller_response_operation_allowed(uuid,text) returns boolean language sql stable as $$select true$$;
 create function icash_call_has_seller_response(jsonb) returns boolean language sql immutable as $$select false$$;
 create function icash_cancellation_voice_current(uuid,text) returns boolean language sql stable as $$select false$$;
 create function icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select true$$;
 create function icash_recording_private.clock_now() returns timestamptz language sql volatile as $$select clock_timestamp()$$;
 create function icash_recording_private.keys(jsonb,text[],text[] default '{}') returns boolean language sql immutable as $$select $1='{}'::jsonb and cardinality($2)=0$$;
 set check_function_bodies=off;
 `);
 for(const definition of Object.values(baseline))await pg.exec(definition);
 await pg.exec(`
 create or replace function icash_queue_voice_jobs() returns void language sql as $$select$$;
 create function icash_next_before_voice_dispatch() returns jsonb language sql as $$select null::jsonb$$;
 create or replace function icash_seller_voice_permission_current(p_account uuid,p_permission uuid) returns boolean language sql as $$select exists(select 1 from public.fixture_demo_permission where account_id=p_account and permission_id=p_permission)$$;
 set check_function_bodies=on;
 `);
 for(const account of [a,b,owner]){
  await q('insert into icash_accounts(id,bot_paused) values($1,false)',[account]);
  await q("insert into icash_voice_configs(account_id,enabled,reviewed_until) values($1,true,now()+interval '1 day')",[account]);
  await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,10000,0)',[account]);
 }
 await q('update icash_accounts set owner_user_id=$2 where id=$1',[owner,ownerInboundTarget.ownerUserId]);
 await pg.exec('insert into icash_operating_budget(id,enabled) values(1,true);insert into icash_voice_scheduler(id) values(1);');
 const before={};for(const name of Object.keys(baseline))before[name]=await val('select pg_get_functiondef(oid) from pg_proc where proname=$1',[name]);
 await pg.exec(sql);
 await pg.exec(demoSql);await pg.exec(demoSql);
 await pg.exec(callbackSql);await pg.exec(callbackSql);
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'icash_owner_demo_call_current(uuid,uuid)','execute')",[role]),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_owner_demo_call_current(uuid,uuid)','execute')"),true);
 assert.equal(await val("select has_function_privilege('anon','icash_seller_phone_call_current(uuid,uuid)','execute')"),false);
 assert.equal(await val("select has_function_privilege('authenticated','icash_seller_phone_call_current(uuid,uuid)','execute')"),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_seller_phone_call_current(uuid,uuid)','execute')"),true);
 for(const role of ['anon','authenticated'])assert.equal(await val("select has_function_privilege($1,'icash_meta_followup_call_current(uuid,uuid)','execute')",[role]),false);
 assert.equal(await val("select has_function_privilege('service_role','icash_meta_followup_call_current(uuid,uuid)','execute')"),true);
 const after={};for(const name of Object.keys(baseline))after[name]=await val('select pg_get_functiondef(oid) from pg_proc where proname=$1',[name]);
 const transitionInserted=sql.split("needle||$guard$\n  perform")[1].split('$guard$')[0];
 assert.equal(after.icash_transition_call_recording.replace('\n  perform'+transitionInserted,''),before.icash_transition_call_recording,'all other final call transitions and controls remain exact');
 assert.equal(after.icash_next_before_fulfillment.replaceAll('\n and public.icash_seller_phone_call_current(v.account_id,v.id)',''),before.icash_next_before_fulfillment,'only pre-LIMIT filtering changes, with fairness/30-second/locking intact');
 for(const name of ['icash_claim_before_activation','icash_queue_voice_jobs','icash_seller_voice_permission_current'])assert.equal(after[name],before[name]);
 await scenario('initial phone deduplicates properties and accounts, with a rolling-day boundary',async()=>{
  const first=await job(),same=await job(),cross=await job(b),fresh=await job(a,'+12145550124');
  assert.equal(await allow(first),true);assert.equal(await allow(same),true);
  await attempted(first);assert.equal(await allow(same),false);assert.equal(await allow(cross,b),false);assert.equal(await allow(fresh),true);
  await pg.exec("update icash_call_recordings set dial_claimed_at=now()-interval '24 hours'");assert.equal(await allow(same),true);
 });
 await scenario('manual calls and unresolved attempts count, pending jobs without attempts do not',async()=>{
  const first=await job(),next=await job();assert.equal(await allow(next),true);
  await q("insert into icash_customer_phone_calls(recipient_phone,child_sid,created_at) values($1,'CA-fixture',now())",[phone]);assert.equal(await allow(next),false);
  await pg.exec('delete from icash_customer_phone_calls');await attempted(first,1500,{unknown:true});assert.equal(await allow(next),false);
  await q('insert into fixture_requested values($1,$2)',[a,next]);assert.equal(await allow(next),false,'a request does not erase an unresolved provider attempt');
 });
 await scenario('tenant and target bindings remain mandatory; flags alone do not create an exception',async()=>{
  const first=await job(),next=await job();await attempted(first);
  assert.equal(await allow(next,b),false);
  await q('update icash_voice_jobs set callback_id=$2,sms_source_message_id=$3,cancellation_notice_id=$4 where id=$1',[next,randomUUID(),randomUUID(),randomUUID()]);assert.equal(await allow(next),false);
  await q('insert into fixture_requested values($1,$2)',[b,next]);assert.equal(await allow(next),false);
  await q('insert into fixture_requested values($1,$2)',[a,next]);assert.equal(await allow(next),true);
  await pg.exec('delete from fixture_requested');await q('insert into fixture_active values($1,$2)',[a,next]);assert.equal(await allow(next),true);
  await q("update icash_contact_permissions set party='buyer' where id=(select permission_id from icash_voice_jobs where id=$1)",[next]);assert.equal(await allow(next),false);
 });
 await scenario('invalid, mixed-source and changed phone bindings fail closed',async()=>{
  const j=await job();
  await q('update icash_contact_permissions set phone=null where id=(select permission_id from icash_voice_jobs where id=$1)',[j]);assert.equal(await allow(j),false);
  await q('update icash_contact_permissions set phone=$2 where id=(select permission_id from icash_voice_jobs where id=$1)',[j,phone]);
  await q('update icash_voice_jobs set operational_contact_id=$2 where id=$1',[j,randomUUID()]);assert.equal(await allow(j),false);
  await q('update icash_voice_jobs set operational_contact_id=null where id=$1',[j]);
  await dialRow(j);await q('update icash_call_recordings set to_phone=$2 where voice_job_id=$1',[j,'+12145550199']);assert.equal(await allow(j),false);
 });
 await scenario('blocked properties do not consume the fair issuer slot ahead of a fresh recipient',async()=>{
  const first=await job();await attempted(first);
  for(let i=0;i<105;i++)await job();
  const fresh=await job(b,'+12145550125');
  await q("update icash_voice_jobs set due_at=now()-interval '1 second' where id=$1",[fresh]);
  const issued=await val('select icash_next_before_fulfillment()');assert(issued);
  assert.equal(await val("select voice_job_id from icash_automation_tickets where kind='voice_dispatch'"),fresh);
  assert.equal(await val("select count(*)::integer from icash_voice_jobs where state='issued'"),1);
  assert.equal(await val('select icash_next_before_fulfillment()'),null,'the thirty-second global dispatch limit remains');
 });
 await scenario('two preflight-eligible jobs cannot both make a final dial claim',async()=>{
  const first=await job(),next=await job(b),r1=await dialRow(first),r2=await dialRow(next);
  assert.equal(await allow(first),true);assert.equal(await allow(next,b),true);
  assert((await claim(r1,first)).dial_claimed_at);
  assert.equal(await claim(r2,next,b),null);assert.equal(await val('select dial_claimed_at from icash_call_recordings where id=$1',[r2]),null);
  assert.equal(await claim(r1,first),null,'the same job cannot dial twice');
 });
 await scenario('ordinary Pause and contact revocation remain before final admission',async()=>{
  const j=await job(),r=await dialRow(j);await q('update icash_accounts set bot_paused=true where id=$1',[a]);assert.equal(await claim(r,j),null);
  await q('update icash_accounts set bot_paused=false where id=$1',[a]);await q('update icash_contact_permissions set revoked_at=now() where id=(select permission_id from icash_voice_jobs where id=$1)',[j]);assert.equal(await claim(r,j),null);
 });
 await scenario('Meta follow-up waits from the actual call even when its SMS is old',async()=>{
  const lead=randomUUID(),first=await job(),next=await job(),initial=await one('select p.screening_id from icash_voice_jobs j join icash_contact_permissions p on p.id=j.permission_id where j.id=$1',[first]);
  await q("insert into icash_seller_intakes(id,state,phone) values($1,'awaiting_address',$2)",[lead,phone]);
  await q("insert into icash_meta_leads(lead_id,account_id,screening_id,voice_job_id,paused,voice_paused,first_outreach_at,contact_until) values($1,$2,$3,$4,false,false,now()-interval '4 hours',now()+interval '1 day')",[lead,a,initial.screening_id,first]);
  const message=randomUUID();await q("insert into icash_text_messages(id,account_id,state,provider_id) values($1,$2,'delivered','SM-fixture')",[message,a]);await q("insert into icash_meta_lead_messages(lead_id,message_id,purpose) values($1,$2,'initial')",[lead,message]);
  await q('update icash_contact_permissions set seller_intake_id=$2 where id=(select permission_id from icash_voice_jobs where id=$1)',[first,lead]);
  await q('update icash_voice_jobs set meta_followup_lead_id=$2,permission_id=(select permission_id from icash_voice_jobs where id=$3) where id=$1',[next,lead,first]);
  await attempted(first,1);assert.equal(await val("select icash_meta_followup_current($1,'call')",[lead]),false);assert.equal(await allow(next),false);
  await pg.exec("update icash_call_recordings set dial_claimed_at=now()-interval '2 hours'");assert.equal(await val("select icash_meta_followup_current($1,'call')",[lead]),true);assert.equal(await allow(next),true);
  const final=await dialRow(next);assert.equal(await allow(next),true,'its own undialed recording is not another attempt');
  const competing=await job();await q('update icash_voice_jobs set permission_id=(select permission_id from icash_voice_jobs where id=$2) where id=$1',[competing,first]);
  const otherRecording=await dialRow(competing);assert.equal(await allow(next),false,'another pending recording for this lead still blocks');
  await q('delete from icash_call_recordings where id=$1',[otherRecording]);
  assert((await claim(final,next)).dial_claimed_at,'a genuinely due follow-up still reaches the final dial claim');
  await q('update icash_call_recordings set dial_claimed_at=null where id=$1',[final]);
  const second=await job();await attempted(second,180);assert.equal(await allow(next),false,'a third automatic attempt is not created by another property');
  await q('update icash_meta_leads set response_at=now() where lead_id=$1',[lead]);assert.equal(await val("select icash_meta_followup_current($1,'call')",[lead]),false);
 });
 await scenario('only a bound address response and ready offer preserves the existing offer follow-up',async()=>{
  const lead=randomUUID(),first=await job(),next=await job(),p=await one('select p.* from icash_voice_jobs j join icash_contact_permissions p on p.id=j.permission_id where j.id=$1',[next]);
  await attempted(first,10);await q('update icash_voice_jobs set meta_offer_lead_id=$2 where id=$1',[next,lead]);assert.equal(await allow(next),false);
  await q("insert into icash_seller_intakes(id,phone,state) values($1,$2,'matched')",[lead,phone]);
  await q("insert into icash_meta_leads(lead_id,account_id,screening_id,voice_job_id,paused,voice_paused,address_confirmed_at,offer_ready_at) values($1,$2,$3,$4,false,false,now()-interval '5 minutes',now()-interval '1 minute')",[lead,a,p.screening_id,first]);
  assert.equal(await allow(next),false,'a flag and unrelated lead do not authorize follow-up');
  await q('update icash_contact_permissions set seller_intake_id=$2 where id=$1',[p.id,lead]);assert.equal(await allow(next),true);
  await q('update icash_meta_leads set account_id=$2 where lead_id=$1',[lead,b]);assert.equal(await allow(next),false);
  await q('update icash_meta_leads set account_id=$2,offer_authorized_at=now() where lead_id=$1',[lead,a]);assert.equal(await allow(next),false);
 });
 await scenario('a fresh owner self-demo follows a completed archived demo through final dial admission',async()=>{
  const old=await job(owner,ownerPhone),record=await attempted(old,180,{recipient:ownerPhone});
  await q("update icash_call_recordings set call_ended_at=now()-interval '179 minutes' where id=$1",[record]);
  await q('update icash_contact_permissions set revoked_at=now() where id=(select permission_id from icash_voice_jobs where id=$1)',[old]);
  const next=await ownerDemo();assert.equal(await allow(next.id,owner),true);
  await q("update icash_voice_jobs set state='dispatching' where id=$1",[next.id]);
  const final=await dialRow(next.id,ownerPhone);assert.equal(await allow(next.id,owner),true);
  assert((await claim(final,next.id,owner)).dial_claimed_at,'the exception survives the final serialized claim');
  assert.equal(await claim(final,next.id,owner),null,'the same request cannot dial twice');
  assert.equal(await val('select revoked_at is not null from icash_contact_permissions where id=(select permission_id from icash_voice_jobs where id=$1)',[old]),true);
 });
 await scenario('owner requests expire even without a recent call and cannot become tomorrow calls',async()=>{
  const next=await ownerDemo();assert.equal(await allow(next.id,owner),true);
  await pg.exec("update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute'");
  assert.equal(await allow(next.id,owner),false);
 });
 await scenario('exact owner, recipient, property, request and current permission bindings are required',async()=>{
  const next=await ownerDemo();
  const changes=[
   "update icash_accounts set owner_user_id=gen_random_uuid() where id='"+owner+"'",
   "update icash_accounts set bot_paused=true where id='"+owner+"'",
   "update icash_optin_call_requests set requested_by=gen_random_uuid()",
   "update icash_optin_call_requests set account_id=gen_random_uuid()",
   "update icash_optin_call_requests set request_id=gen_random_uuid()",
   "update icash_optin_call_requests set phone='+12145550999'",
   "update icash_optin_call_requests set source='support_request'",
   "update icash_optin_call_requests set request_version='older'",
   "update icash_optin_call_requests set request_reference='older'",
   "update icash_optin_call_requests set requested_at=now()+interval '1 minute',expires_at=now()+interval '6 minutes'",
   "update icash_seller_intakes set ai_consented=false",
   "update icash_seller_intakes set attribution='{}'",
   "update icash_screening_jobs set state='archived'",
   "update icash_seller_matches set screening_id=gen_random_uuid()",
   "update icash_contact_permissions set revoked_at=now()",
   "update icash_contact_permissions set contact_key='changed'",
   "update icash_contact_permissions set permission_until=now()-interval '1 second'",
   "update icash_voice_jobs set state='dispatched'",
   "update icash_voice_jobs set callback_id=gen_random_uuid()",
   "update icash_voice_jobs set sms_source_message_id=gen_random_uuid()",
   "update icash_voice_jobs set cancellation_notice_id=gen_random_uuid()",
   "update icash_voice_jobs set meta_retry_of=gen_random_uuid()",
   "update icash_voice_jobs set provider_call_sid='already-started'",
   "update icash_voice_jobs set conversation_id='already-started'",
   "delete from fixture_demo_permission",
  ];
  for(const change of changes){await pg.exec('savepoint mutation');await pg.exec(change);assert.equal(await allow(next.id,owner),false,change);await pg.exec('rollback to mutation');}
  assert.equal(await allow(next.id,a),false,'another account cannot borrow the owner request');
  await q('insert into icash_text_suppressions values($1)',[ownerPhone]);assert.equal(await allow(next.id,owner),false);
  await pg.exec('delete from icash_text_suppressions');await q('insert into icash_contact_suppressions select contact_key from icash_contact_permissions where id=$1',[next.permission]);assert.equal(await allow(next.id,owner),false);
 });
 await scenario('new owner requests never override unknown, active or later-finished calls',async()=>{
  const old=await job(b,ownerPhone),record=await attempted(old,1500,{unknown:true,recipient:ownerPhone}),next=await ownerDemo();
  assert.equal(await allow(next.id,owner),false,'old unknown calls remain fenced');
  await q("update icash_call_recordings set call_sid='CA-known-active' where id=$1",[record]);assert.equal(await allow(next.id,owner),false,'known active calls still block');
  await q('update icash_call_recordings set call_ended_at=now() where id=$1',[record]);assert.equal(await allow(next.id,owner),false,'a request made during a prior call cannot queue another');
  await q("update icash_call_recordings set call_ended_at=now()-interval '2 minutes' where id=$1",[record]);assert.equal(await allow(next.id,owner),true);
  await q("insert into icash_customer_phone_calls(recipient_phone,child_sid,created_at) values($1,'manual-active',now())",[ownerPhone]);assert.equal(await allow(next.id,owner),false);
 });
 await scenario('original canonical terminal receipts are honored without erasing old call history',async()=>{
  const old=await job(owner,ownerPhone),record=await attempted(old,1500,{recipient:ownerPhone}),next=await ownerDemo();
  await q("update icash_call_recordings set call_ended_at=null,provider_account_sid='AC-fixture' where id=$1",[record]);assert.equal(await allow(next.id,owner),false);
  const receipt={callSid:'CA'+'a'.repeat(32),providerAccountSid:'AC-fixture',toPhone:ownerPhone,status:'no-answer'};
  await q("insert into icash_recording_private.terminal_cost_receipts values($1,$2,now()-interval '1 day')",[record,receipt]);assert.equal(await allow(next.id,owner),true);
  for(const bad of [{...receipt,callSid:'other'},{...receipt,providerAccountSid:'other'},{...receipt,toPhone:phone},{...receipt,status:'in-progress'}]){await q('update icash_recording_private.terminal_cost_receipts set receipt=$1',[bad]);assert.equal(await allow(next.id,owner),false);}
  await q('update icash_recording_private.terminal_cost_receipts set receipt=$1,created_at=now()',[receipt]);assert.equal(await allow(next.id,owner),false,'terminal evidence must predate the fresh request');
  assert.equal(await val('select call_ended_at from icash_call_recordings where id=$1',[record]),null,'original recording stays unchanged');
 });
 await scenario('another job cannot consume the same demo request and another account keeps ordinary spacing',async()=>{
  const next=await ownerDemo(),second=await job(owner,ownerPhone);
  await q("update icash_voice_jobs set permission_id=$2,created_at=now()+interval '1 second' where id=$1",[second,next.permission]);
  assert.equal(await allow(second,owner),false);
  const old=await job(owner,ownerPhone);await attempted(old,5,{recipient:ownerPhone});
  const other=await job(b,ownerPhone);assert.equal(await allow(other,b),false);
 });
 await scenario('real owner conversation and requested callback receipts preserve the existing service path',async()=>{
  const next=await ownerDemo(),old=await job(owner,ownerPhone),record=await attempted(old,180,{recipient:ownerPhone});
  await q("update icash_call_recordings set call_ended_at=now()-interval '179 minutes' where id=$1",[record]);
  await pg.exec("update icash_optin_call_requests set requested_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute'");
  await q('update icash_voice_jobs set sms_source_message_id=$2 where id=$1',[next.id,randomUUID()]);
  assert.equal(await allow(next.id,owner),false,'a callback flag alone is still insufficient');
  await q('insert into fixture_requested values($1,$2)',[owner,next.id]);assert.equal(await allow(next.id,owner),true);
  await pg.exec('delete from fixture_requested');await q('insert into fixture_active values($1,$2)',[owner,next.id]);assert.equal(await allow(next.id,owner),true);
  await q('update icash_call_recordings set call_sid=null,call_ended_at=null where id=$1',[record]);assert.equal(await allow(next.id,owner),false,'even real requests do not erase unknown attempts');
 });
 console.log(`Seller phone spacing: ${scenarios} offline database scenarios passed; owner fresh-demo repeats, real callback receipts, expired/unknown-call holds, exact final dial admission, tenant boundaries, private ACLs and no paid traffic.`);
}finally{await pg.close();}
