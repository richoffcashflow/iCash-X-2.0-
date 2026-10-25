// Isolated database with the production settlement function; no provider requests.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/verified-call-creation-rejection.sql');
assert.equal(sql,read('supabase/migrations/20261025195846_verified_call_creation_rejection.sql'));
const db=new PGlite(),one=async(s,args=[])=> (await db.query(s,args)).rows[0];
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222',job='33333333-3333-4333-8333-333333333333',op='voice:'+job;
const ac='AC'+'a'.repeat(32),alert='NO'+'b'.repeat(32),hash='c'.repeat(64),from='+15555550101',to='+15555550102';
const now=Date.now(),stamp=n=>new Date(n).toISOString();
const proof={recordingId:id,providerAccountSid:ac,alertSid:alert,errorCode:21211,responseStatus:400,resourceSid:null,requestMethod:'POST',
 requestUrl:`https://api.twilio.com/2010-04-01/Accounts/${ac}/Calls.json`,fromPhone:from,toPhone:to,nonceHash:hash,generatedAt:stamp(now-599000),requestHash:hash,evidenceHash:hash};
const settle=async(p=proof,a=account)=>one('select icash_note_call_creation_rejection($1,$2,$3,$4::jsonb) result',[id,a,op,JSON.stringify(p)]);
const slots=async()=>Number((await one('select count(*) n from icash_active_voice_slots()')).n);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema icash_recording_private;create schema icash_recorded_reception_private;
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_operating_budget(id integer primary key,reserved_micros bigint,spent_micros bigint,enabled boolean,hold_reason text);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,reserved_micros bigint,charge_cap_cents bigint,charged_cents bigint,actual_micros bigint,settlement_evidence text,settled_at timestamptz,unique(operation_key,account_id));
 create table fixture_credits(account_id uuid primary key,held_cents bigint,charged_cents bigint);
 create function icash_finish_credit(a uuid,o text,c bigint,e text) returns void language plpgsql as $$ begin
  update public.fixture_credits set held_cents=held_cents-(select charge_cap_cents from public.icash_operation_spend where operation_key=o),charged_cents=charged_cents+c where account_id=a;
 end $$;
 create function icash_account_margin_ok(uuid,bigint,bigint,boolean) returns boolean language sql as $$select true$$;
 create table icash_voice_jobs(id uuid primary key,account_id uuid,state text,outcome text,permission_id uuid,operational_contact_id uuid,operation_key text,conversation_id text,provider_call_sid text,updated_at timestamptz);
 create table icash_voice_configs(account_id uuid,agent_id text);
 create table icash_voice_contact_targets(id uuid,account_id uuid,contact_key text);
 create table icash_automation_tickets(id uuid,account_id uuid,voice_job_id uuid,kind text,state text,outcome text,created_at timestamptz,expires_at timestamptz,completed_at timestamptz);
 create table icash_call_recordings(id uuid primary key,account_id uuid,operation_key text,voice_job_id uuid,agent_id text,contact_key text,entry_policy text,
  provider_account_sid text,from_phone text,to_phone text,nonce_hash text,state text,call_sid text,recording_sid text,conversation_id text,start_claimed_at timestamptz,consent_at timestamptz,recording_authorized_at timestamptz,provider_started_at timestamptz,
  call_ended_at timestamptz,end_requested_at timestamptz,dial_claimed_at timestamptz,created_at timestamptz,last_error text,last_action text,row_version bigint,updated_at timestamptz,
  next_reconcile_at timestamptz check(isfinite(next_reconcile_at)),reconcile_lease_token uuid,reconcile_lease_expires_at timestamptz);
 create table icash_live_conversations(operation_key text,account_id uuid,agent_id text,contact_key text,state text);
 create table icash_recorded_reception_private.sessions(operation_key text,account_id uuid,agent_id text,contact_key text,call_ended_at timestamptz);
 create table icash_recorded_gate_terminal_receipts(recording_id uuid,account_id uuid,call_sid text,receipt jsonb);
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid,receipt jsonb);
 create function icash_recording_private.audit_immutable() returns trigger language plpgsql as $$begin raise exception 'Recording audit is append only';end$$;
 create function icash_recording_private.keys(p_value jsonb,p_required text[],p_optional text[] default '{}') returns boolean language sql immutable set search_path='' as $$
  select case when jsonb_typeof(p_value) is distinct from 'object' then false else p_value ?& p_required and not exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_required||p_optional)) end;
 $$;
 insert into icash_accounts values('${account}',false);
 insert into fixture_credits values('${account}',256,0);
 insert into icash_operating_budget values(1,1800000,99,true,null);
 insert into icash_operation_spend(operation_key,account_id,state,reserved_micros,charge_cap_cents) values('${op}','${account}','dispatched',1800000,256);
 insert into icash_voice_configs values('${account}','agent_fixture');
 insert into icash_voice_jobs(id,account_id,state,outcome,operation_key,updated_at) values('${job}','${account}','held','provider_outcome_unknown_no_retry','${op}',now()-interval '10 minutes');
 insert into icash_automation_tickets values(gen_random_uuid(),'${account}','${job}','voice_dispatch','held','held_for_reconciliation',now()-interval '12 minutes',now()-interval '11 minutes',now()-interval '10 minutes');
 `);
 await db.query(`insert into icash_call_recordings(id,account_id,operation_key,voice_job_id,agent_id,entry_policy,provider_account_sid,from_phone,to_phone,nonce_hash,state,dial_claimed_at,created_at,row_version,next_reconcile_at,reconcile_lease_token,reconcile_lease_expires_at)
 values($1,$2,$3,$4,'agent_fixture','direct_recorded_v1',$5,$6,$7,$8,'consent_pending',$9,$10,7,now(),gen_random_uuid(),now()+interval '1 minute')`,[id,account,op,job,ac,from,to,hash,stamp(now-600000),stamp(now-601000)]);
 await db.exec(read('tests/fixtures/call-rejection-capacity-before.sql'));await db.exec(read('tests/fixtures/call-rejection-settlement.sql'));
 await db.exec('revoke all on function icash_active_voice_slots() from public;grant execute on function icash_active_voice_slots() to service_role;');
 assert.equal(await slots(),1);await db.exec(sql);assert.equal(await slots(),1,'Installing recovery alone releases no unknown call');
 for(const role of ['anon','authenticated','service_role']){
  assert.equal((await one(`select has_function_privilege('${role}','icash_note_call_creation_rejection(uuid,uuid,text,jsonb)','execute') ok`)).ok,role==='service_role');
  assert.equal((await one(`select has_function_privilege('${role}','icash_active_voice_slots()','execute') ok`)).ok,role==='service_role');
  for(const action of ['SELECT','INSERT','UPDATE','DELETE'])assert.equal((await one(`select has_table_privilege('${role}','icash_recording_private.call_creation_rejections','${action}') ok`)).ok,false);
 }
 const snapshot=async()=>one(`select (select to_jsonb(r) from icash_call_recordings r) recording,(select to_jsonb(j) from icash_voice_jobs j) job,(select to_jsonb(o) from icash_operation_spend o) operation,(select to_jsonb(b) from icash_operating_budget b) budget,(select to_jsonb(c) from fixture_credits c) credits,(select to_jsonb(t) from icash_automation_tickets t) ticket`);
 const before=await snapshot();
 for(const patch of [{recordingId:job},{providerAccountSid:'AC'+'d'.repeat(32)},{fromPhone:to},{toPhone:from},{nonceHash:'d'.repeat(64)},{resourceSid:'CA'+'d'.repeat(32)},
  {errorCode:11200},{errorCode:'21211'},{responseStatus:500},{requestMethod:'GET'},{requestUrl:proof.requestUrl+'?other=1'},
  {generatedAt:stamp(now-603000)},{generatedAt:stamp(now)},{generatedAt:'invalid'},{alertSid:'bad'},{evidenceHash:'bad'},{requestHash:null},{extra:'raw private data'}]){
  await assert.rejects(()=>settle({...proof,...patch}));assert.deepEqual(await snapshot(),before);assert.equal(await slots(),1);
 }
 await assert.rejects(()=>settle(proof,job));await assert.rejects(()=>settle(null));
 for(const change of ["call_sid='CA'||repeat('d',32)","recording_sid='RE'||repeat('d',32)","conversation_id='conv_other'","consent_at=now()","start_claimed_at=now()","provider_started_at=now()","call_ended_at=now()","end_requested_at=now()","state='starting'","entry_policy='other'","dial_claimed_at=null"]){
  await db.exec('begin;');await db.exec('update icash_call_recordings set '+change);await assert.rejects(()=>settle());await db.exec('rollback;');
 }
 for(const statement of ["update icash_voice_jobs set provider_call_sid='CA'||repeat('d',32)","update icash_voice_jobs set conversation_id='conv_other'","update icash_voice_jobs set operation_key=null","update icash_operation_spend set state='settled'",`insert into icash_live_conversations(operation_key,state) values('${op}','complete')`,`insert into icash_recorded_gate_terminal_receipts(recording_id) values('${id}')`,`insert into icash_recording_private.terminal_cost_receipts(recording_id) values('${id}')`]){
  await db.exec('begin;');await db.exec(statement);await assert.rejects(()=>settle());await db.exec('rollback;');
 }
 await db.exec('begin;');await db.exec("create or replace function icash_finish_credit(a uuid,o text,c bigint,e text) returns void language plpgsql as $$begin raise exception 'Fixture credit failure';end$$;");
 await assert.rejects(()=>settle());await db.exec('rollback;');assert.deepEqual(await snapshot(),before);assert.equal((await one('select count(*) n from icash_recording_private.call_creation_rejections')).n,0);
 await db.exec("begin;update icash_operation_spend set state='reserved';");await settle();assert.equal((await snapshot()).operation.state,'cancelled');await db.exec('rollback;');
 // The actual zero-cost settlement releases both holds atomically, without billing or redialing.
 await db.exec('set role service_role;');assert.deepEqual((await settle()).result,{settled:true,alreadySettled:false});await db.exec('reset role;');
 const after=await snapshot();assert.equal(await slots(),0);assert.equal(after.recording.state,'failed');assert.equal(after.recording.row_version,8);
 for(const key of ['call_sid','recording_sid','conversation_id','call_ended_at','next_reconcile_at','reconcile_lease_token','reconcile_lease_expires_at'])assert.equal(after.recording[key],null);
 assert.equal(after.job.state,'held');assert.equal(after.job.outcome,'provider_rejected_call_creation');assert.deepEqual(after.ticket,before.ticket);
 assert.equal(after.operation.state,'settled');assert.equal(after.operation.actual_micros,0);assert.equal(after.operation.charged_cents,0);
 assert.equal(after.budget.reserved_micros,0);assert.equal(after.budget.spent_micros,99);assert.equal(after.credits.held_cents,0);assert.equal(after.credits.charged_cents,0);
 assert.deepEqual((await settle()).result,{settled:true,alreadySettled:true});assert.deepEqual(await snapshot(),after);
 await assert.rejects(()=>settle({...proof,evidenceHash:'d'.repeat(64)}));
 for(const statement of ["update icash_call_recordings set call_sid='CA'||repeat('d',32)","update icash_voice_jobs set provider_call_sid='CA'||repeat('d',32)",`insert into icash_live_conversations(operation_key,state) values('${op}','complete')`]){
  await db.exec('begin;');await db.exec(statement);assert.equal(await slots(),1,'Contradictory later provider identity restores the hold');await assert.rejects(()=>settle());await db.exec('rollback;');
 }
 await assert.rejects(()=>db.exec('delete from icash_recording_private.call_creation_rejections'));await assert.rejects(()=>db.exec('truncate icash_recording_private.call_creation_rejections'));
 console.log('Verified rejection: original exact receipt, atomic zero-cost settlement, capacity release only after proof, no retry, private immutable evidence, idempotency and late-identity holds passed.');
}finally{await db.close();}
