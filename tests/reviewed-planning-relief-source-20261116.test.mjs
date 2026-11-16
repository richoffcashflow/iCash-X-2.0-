// Fictional evidence, actual operation-row shape and the shipped source bodies.
// These tests prove source selection; they never claim a provider cost is zero.
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {baseSQL,read,account,rate} from './helpers/reviewed-planning-relief-20261116-fixture.mjs';
const db=new PGlite();
const val=async sql=>Object.values((await db.query(sql)).rows[0]??{})[0];
const file=read('config/reviewed-planning-relief-20261116.sql');
const source=file.slice(file.indexOf('create function icash_reliability_private.pending_work_relief_idle_source_20261116'),file.indexOf('create function icash_reliability_private.stage_pending_work_relief_20261116'));
const id='20000000-0000-4000-8000-000000000001';
const wrong='20000000-0000-4000-8000-000000000099';
let key;
const get=()=>val(`select icash_reliability_private.pending_work_relief_idle_source_20261116(o) from public.icash_operation_spend o where operation_key='${key}'`);
async function mutate(sql,expected=null){await db.exec('savepoint mutation');try{await db.exec(sql);const got=await get();if(expected===null)assert.equal(got,null,sql);else expected(got);}finally{await db.exec('rollback to mutation');}}
async function kind(name,operationKey,sql,run){
 await db.exec('begin');key=operationKey;
 try{await db.exec(`update public.icash_operation_rates set operation='${name}' where id='${rate}';update public.icash_operation_spend set operation_key='${key}' where operation_key='fixture-original';`+sql);assert.ok(await get(),name+' valid exact old original');await val(`select icash_reliability_private.pending_work_relief_lock_source_20261116(o) from public.icash_operation_spend o where operation_key='${key}'`);await run();}finally{await db.exec('rollback');}
}
try{
 await db.exec(baseSQL());
 await db.exec(`create table public.icash_call_recordings(id uuid primary key,account_id uuid,operation_key text unique,voice_job_id uuid references public.icash_voice_jobs(id),state text,call_ended_at timestamptz,max_total_seconds integer,dial_claimed_at timestamptz,start_claimed_at timestamptz,reconcile_lease_token uuid,reconcile_lease_expires_at timestamptz,deletion_lease_token uuid,deletion_lease_expires_at timestamptz,row_version bigint,updated_at timestamptz,next_reconcile_at timestamptz,reconcile_attempts integer,next_delete_at timestamptz,deletion_attempts integer,last_error text,last_action text,recording_sid text,provider_recording_price_micros bigint);
 create schema icash_text_receipt_private;create table icash_text_receipt_private.attempts(id uuid primary key,message_id uuid references public.icash_text_messages(id),account_id uuid,expires_at timestamptz,finished_at timestamptz,receipt jsonb);
 create table icash_research_private.estimates(operation_key text primary key,account_id uuid,token uuid,lease_until timestamptz,response jsonb);
 ${source}`);
 assert.ok(!source.includes('id::text=substring'),'source identifiers preserve UUID primary-key indexability');
 await db.exec('set enable_seqscan=off');
 for(const table of ['icash_voice_jobs','icash_text_messages']){const plan=await val(`explain(format json) select id from public.${table} where id='${id}'::uuid`);assert.match(JSON.stringify(plan),/Index (Only )?Scan/);}
 await db.exec('reset enable_seqscan');
 const stamp="now()-interval '2 days'";
 await kind('owner_enrichment','fixture-owner',`
 insert into icash_research_private.owner_batches(id,account_id,primary_screening,state,created_at,items,preview_receipt) values('${id}','${account}','${id}','claimed',${stamp},'[]','{}');
 insert into icash_research_private.owner_batch_items(screening_id,batch_id,operation_key) values('${id}','${id}','fixture-owner');
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('${id}','owner_lookup','${account}','owner-batch:${id}',true,${stamp},${stamp},'{"outcome":"http_error","httpStatus":400}');
 insert into icash_research_private.owner_exports(id,request,receipt,recovery_history,next_recover_at,recovery_attempts) values('${id}','{}','{"httpStatus":400,"raw":{"error":{"code":"invalid_request"}}}','[]',now(),0);`,async()=>{
  const original=await get();
  await mutate(`update icash_research_private.owner_exports set recovery_attempts=4,next_recover_at=now()+interval '1 day',lease_token='${id}',lease_until=now()-interval '1 hour'`,v=>assert.deepEqual(v,original,'expired free retry bookkeeping does not change source identity'));
  for(const change of [`lease_token='${id}',lease_until=now()+interval '1 second'`,`lease_token='${id}',lease_until=null`,`completed_at=now()`,`csv='a,b'`,`parsed_rows='[]'`,`receipt='{"httpStatus":500}'`])await mutate('update icash_research_private.owner_exports set '+change);
  await mutate(`update icash_research_private.owner_exports set recovery='{"outcome":"response","creditsUsed":1}',recovery_history='[{"outcome":"response"}]'`,v=>assert.notDeepEqual(v,original,'new provider recovery evidence changes identity'));
  for(const change of [`account_id='${wrong}'`,`operation_key='wrong'`,`kind='owner_preview'`,`admitted=false`,`finished_at=null`,`finished_at=now()`,`result='{"outcome":"response"}'`])await mutate('update icash_research_private.requests set '+change);
  await mutate(`update icash_research_private.requests set result='{"outcome":"unknown"}';update icash_research_private.owner_exports set receipt=null`,v=>assert.ok(v,'unknown is eligible only for planning, without becoming zero cost'));
  await mutate(`insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at) values('${wrong}','owner_lookup','${account}','owner-batch:${id}',true,now())`);
 });
 const ticket=(kind,field)=>`insert into public.icash_automation_tickets(id,account_id,kind,state,${field},created_at,expires_at,completed_at) values('${id}','${account}','${kind}','held','${id}',${stamp},${stamp},${stamp});`;
 await kind('seller_call','voice:'+id,`
 insert into public.icash_voice_jobs(id,account_id,permission_id,state,outcome,operation_key,created_at,updated_at) values('${id}','${account}','${id}','held','recording_admission_held','voice:${id}',${stamp},${stamp});${ticket('voice_dispatch','voice_job_id')}`,async()=>{
  assert.equal(await val(`select icash_reliability_private.pending_work_relief_idle_source_20261116(jsonb_populate_record(null::public.icash_operation_spend,to_jsonb(o)||'{"operation_key":"voice:invalid"}')) from public.icash_operation_spend o where operation_key='${key}'`),null,'malformed UUID fails closed');
  for(const change of [`state='ready'`,`outcome='unreviewed_reason'`,`account_id='${wrong}'`,`operation_key='wrong'`,`updated_at=now()`])await mutate('update public.icash_voice_jobs set '+change);
  for(const change of [`state='consumed'`,`expires_at=now()`,`completed_at=null`,`account_id='${wrong}'`])await mutate('update public.icash_automation_tickets set '+change+` where id='${id}'`);
  await db.exec(`insert into public.icash_call_recordings(id,account_id,operation_key,voice_job_id,state,call_ended_at,max_total_seconds,dial_claimed_at,start_claimed_at,row_version,reconcile_attempts) values('${id}','${account}','voice:${id}','${id}','stopping',${stamp},600,${stamp},${stamp},1,0)`);
  const original=await get();assert.ok(original,'ended claimed recording can retain unknown price');
  await mutate(`update public.icash_call_recordings set row_version=7,reconcile_attempts=9,last_error='not yet available',last_action='reconcile',updated_at=now(),next_reconcile_at=now()+interval '15 minutes'`,v=>assert.deepEqual(v,original));
  for(const change of [`call_ended_at=null`,`call_ended_at=now()`,`state='recording'`,`dial_claimed_at=now()`,`max_total_seconds=601`,`reconcile_lease_token='${id}',reconcile_lease_expires_at=now()+interval '1 minute'`,`deletion_lease_token='${id}',deletion_lease_expires_at=now()+interval '1 minute'`])await mutate('update public.icash_call_recordings set '+change);
  await mutate("update public.icash_call_recordings set provider_recording_price_micros=1",v=>assert.notDeepEqual(v,original));
  await db.exec(`insert into public.icash_live_conversations(id,account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,state,tool_expires_at,created_at) values('${id}','${account}','${id}','seller','agent_synthetic','conv_synthetic','voice:${id}','synthetic-contact-key','cash_interest','review',${stamp},${stamp})`);
  assert.ok(await get(),'expired review conversation is uncertain evidence, not a current tool window');
  await mutate('update public.icash_live_conversations set tool_expires_at=now()');
  await mutate("update public.icash_live_conversations set state='waiting'");
 });
 await kind('sms_send','text:'+id,`
 insert into public.icash_text_messages(id,account_id,direction,state,created_at,updated_at) values('${id}','${account}','outgoing','dispatching',${stamp},${stamp});${ticket('seller_opener','opener_message_id')}`,async()=>{
  for(const change of [`state='ready'`,`provider_id='synthetic-provider'`,`event_id='synthetic-event'`,`last_delivery_at=now()`,`updated_at=now()`,`account_id='${wrong}'`])await mutate('update public.icash_text_messages set '+change);
  await mutate(`insert into icash_text_receipt_private.attempts(id,message_id,account_id) values('${id}','${id}','${account}')`);
  await mutate(`update public.icash_automation_tickets set expires_at=now() where id='${id}'`);
 });
 await kind('property_search','fixture-search',`
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('${id}','property_search','${account}','fixture-search',true,${stamp},${stamp},'{"outcome":"unknown"}');`,async()=>{
  for(const change of [`account_id='${wrong}'`,`kind='owner_lookup'`,`finished_at=null`,`finished_at=now()`,`result='{"outcome":"response"}'`])await mutate('update icash_research_private.requests set '+change);
  await mutate(`insert into icash_research_private.estimates(operation_key,account_id) values('fixture-search','${account}')`);
  await mutate(`insert into public.icash_discovery_results(operation_key,account_id,result) values('fixture-search','${account}','{}')`);
  await mutate(`insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,created_at,finished_at,result) values('${wrong}','property_search','${account}','fixture-search',true,${stamp},${stamp},'{"outcome":"unknown"}')`);
  await mutate("update public.icash_operation_spend set dispatched_at=now() where operation_key='fixture-search'");
 });
 console.log('reviewed planning relief: shipped per-kind source proof, active windows, material evidence drift and free-bookkeeping stability passed');
}finally{await db.close();}
