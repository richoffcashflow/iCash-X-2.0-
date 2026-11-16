// Native concurrent queueing in a separate disposable local database. No providers.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {threeTouchFixtureSql,threeTouchMigrations,threeTouchMetaFixtureSql,read} from '../tests/helpers/three-touch-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg');
const database='icash_three_touch_fixture',clients=[],a='00000000-0000-4000-8000-000000000001',contact='00000000-0000-4000-8000-000000000002',screen='00000000-0000-4000-8000-000000000003',first='00000000-0000-4000-8000-000000000004',second='00000000-0000-4000-8000-000000000007';
const value=async(c,s,p=[])=>Object.values((await c.query(s,p)).rows[0]??{})[0];
async function connect(name,db=database){
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:db,application_name:'three-touch-'+name,connectionTimeoutMillis:5000});
 await c.connect();clients.push(c);await c.query("set statement_timeout='8s';set lock_timeout='3s'");return c;
}
let admin,created=false,priorBypass;
const seed=`
update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=true,three_touch_activated_at=now();
update icash_call_recordings set dial_claimed_at=now()-interval '10 hours',call_ended_at=now()-interval '599 minutes';
update icash_live_conversations set completed_at=now()-interval '599 minutes';
insert into icash_voice_jobs(id,account_id,operational_contact_id,seller_followup_of,state,created_at)
 values('${second}','${a}','${contact}','${first}','dispatched',now()-interval '5 hours');
insert into icash_call_recordings(id,account_id,voice_job_id,screening_id,party,operation_key,to_phone,from_phone,contact_key,dial_claimed_at,call_ended_at,call_sid,conversation_id)
 values('00000000-0000-4000-8000-000000000008','${a}','${second}','${screen}','seller','voice:${second}','+12145550123','+17205550100','fixture-contact',now()-interval '5 hours',now()-interval '299 minutes','CAsecond','conv-second');
insert into icash_operation_spend(operation_key,account_id,state) values('voice:${second}','${a}','settled');
insert into icash_live_conversations(id,account_id,screening_id,party,operation_key,contact_key,conversation_id,state,completed_at,result)
 values('00000000-0000-4000-8000-000000000009','${a}','${screen}','seller','voice:${second}','fixture-contact','conv-second','complete',now()-interval '299 minutes','{"contactEvidence":"automated_answer","transcript":[{"role":"user","message":"Please leave a message after the tone."}]}');
grant select on all tables in schema public to service_role;
`;
try{
 admin=await connect('admin','icash_reliability');await assertDisposablePostgresTarget(admin);
 priorBypass=await value(admin,"select rolbypassrls from pg_roles where rolname='service_role'");
 await admin.query(`create database ${database}`);created=true;
 const owner=await connect('owner'),holder=await connect('holder');
 const fixture=threeTouchFixtureSql().replace(/create role (anon|authenticated|service_role)( bypassrls)?;/g,(_,role,extra)=>`do $$begin create role ${role}${extra??''};exception when duplicate_object then null;end$$;`);
 async function setup(){
  await owner.query('drop schema if exists icash_recording_private,icash_seller_recovery_private,icash_seller_agreement_private,icash_text_receipt_private cascade;drop schema public cascade;create schema public;');
  await owner.query(fixture+threeTouchMetaFixtureSql()+'begin;'+threeTouchMigrations()+read('config/three-touch-meta-calls.sql')+'commit;'+seed);
  await admin.query('alter role service_role bypassrls');
 }
 await setup();
 const workers=await Promise.all(Array.from({length:16},(_,i)=>connect('worker-'+i)));
 for(const c of workers)await c.query('set role service_role');
 const originals=await value(owner,'select jsonb_agg(to_jsonb(j) order by id) from icash_voice_jobs j');
 const counts=await Promise.all(workers.map(c=>value(c,'select icash_queue_unanswered_seller_calls()')));
 assert.equal(counts.reduce((n,x)=>n+x,0),1,'16 competing queues create one third call');
 assert.equal(await value(owner,'select count(*)::int from icash_voice_jobs'),3);
 assert.deepEqual(await value(owner,'select jsonb_agg(to_jsonb(j) order by id) from icash_voice_jobs j where id in ($1,$2)',[first,second]),originals);
 assert.equal(await value(owner,'select count(*)::int from icash_operation_spend'),2);
 for(const mutation of [
  "update icash_accounts set bot_paused=true",
  "insert into icash_text_suppressions values('+12145550123')",
  "update fixture_eligibility set allowed=false",
  "update icash_operation_spend set state='dispatched'",
  "update icash_seller_recovery_private.unanswered_policy set three_touch_enabled=false",
 ]){
  await setup();await holder.query('begin;select 1 from icash_operating_budget where id=1 for update;'+mutation);
  const contender=workers[0],pid=await value(contender,'select pg_backend_pid()');
  const pending=value(contender,'select icash_queue_unanswered_seller_calls()');
  let blocked=false;
  for(let i=0;i<200;i++){
   if(await value(owner,"select wait_event_type='Lock' from pg_stat_activity where pid=$1",[pid])){blocked=true;break;}
   await new Promise(r=>setTimeout(r,10));
  }
  assert.ok(blocked,'queue waits behind the real admission lock');await holder.query('commit');assert.equal(await pending,0);
  assert.equal(await value(owner,'select count(*)::int from icash_voice_jobs'),2);
 }
 await setup();
 const thread=randomUUID(),m1=randomUUID(),m2=randomUUID();
 await owner.query("insert into icash_text_threads(id,account_id,deal_id,recipient,sender,party,operational_contact_id,eligibility_until,paused,manual_only,ai_mode) values($1,$2,$1,'+12145550123','+17205550100','seller',$3,now()+interval '10 hours',false,false,'auto')",[thread,a,contact]);
 await owner.query("insert into icash_deal_files(id,account_id,screening_id,stage,terms) values($1,$2,$3,'draft','{}')",[thread,a,screen]);
 for(const [id,age] of [[m1,'12 hours'],[m2,'6 hours']])await owner.query("insert into icash_text_messages(id,thread_id,account_id,direction,state,provider_id,body,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered',$1::uuid::text,'Would you consider selling?',now()-$4::interval,now()-$4::interval)",[id,thread,a,age]);
 await owner.query("insert into icash_seller_recovery_attempts(account_id,thread_id,message_id,reason,assigned_at,delivered_at) values($1,$2,$3,'no_response',now()-interval '6 hours',now()-interval '6 hours')",[a,thread,m2]);
 await owner.query("insert into icash_operation_spend(operation_key,account_id,state,dispatched_at) values('text:'||$1::uuid::text,$2,'settled',now()-interval '6 hours')",[m2,a]);
 const gaps=await Promise.all(workers.map(c=>value(c,'select icash_prepare_unanswered_seller_texts()')));
 assert.equal(gaps.reduce((n,x)=>n+x,0),1);assert.equal(await value(owner,'select source_id from icash_seller_gaps'),m2);
 assert.equal(await value(owner,'select count(*)::int from icash_text_messages'),2,'no historical message replay');
 const gap=await value(owner,'select id from icash_seller_gaps');
 const prepared=await Promise.all(workers.map(c=>value(c,'select icash_prepare_seller_recovery($1,$2)',[a,gap])));
 assert.equal(prepared.filter(Boolean).length,1,'16 preparations queue the actual third message once');
 assert.equal(await value(owner,'select count(*)::int from icash_text_messages'),3);
 assert.equal(await value(owner,"select state from icash_text_messages where id=$1",[prepared.find(Boolean)]),'ready');
 console.log('PASS native three-touch: 16 competing call queues and 16 text catch-up scans create one next step, original jobs/costs stay unchanged, five late control races block the third call.');
}finally{
 await Promise.allSettled(clients.filter(c=>c!==admin).map(c=>c.end()));
 if(admin){
  if(created)await admin.query(`drop database ${database}`);
  if(priorBypass===false)await admin.query('alter role service_role nobypassrls');
  await admin.end();
 }
}
