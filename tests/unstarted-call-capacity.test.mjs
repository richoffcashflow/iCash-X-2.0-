import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),patch=read('config/unstarted-call-capacity.sql');
assert.equal(patch,read('supabase/migrations/20261025163344_unstarted_call_capacity.sql'));
const db=new PGlite(),one=async s=>(await db.query(s)).rows[0],slots=async()=>Number((await one('select count(*) n from icash_active_voice_slots()')).n);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create schema icash_recording_private;create schema icash_recorded_reception_private;
 create table icash_voice_jobs(id uuid primary key,account_id uuid,state text,outcome text,permission_id uuid,operational_contact_id uuid,operation_key text,conversation_id text,provider_call_sid text,updated_at timestamptz);
 create table icash_voice_configs(account_id uuid,agent_id text);
 create table icash_voice_contact_targets(id uuid,account_id uuid,contact_key text);
 create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,voice_job_id uuid,kind text,state text,outcome text,created_at timestamptz,expires_at timestamptz,completed_at timestamptz);
 create table icash_operation_spend(operation_key text,account_id uuid,state text);
 create table icash_call_recordings(id uuid,account_id uuid,operation_key text,voice_job_id uuid,agent_id text,contact_key text,call_ended_at timestamptz,call_sid text);
 create table icash_live_conversations(operation_key text,account_id uuid,agent_id text,contact_key text,state text);
 create table icash_recorded_reception_private.sessions(operation_key text,account_id uuid,agent_id text,contact_key text,call_ended_at timestamptz);
 create table icash_recorded_gate_terminal_receipts(recording_id uuid,account_id uuid,call_sid text,receipt jsonb);
 create table icash_recording_private.terminal_cost_receipts(recording_id uuid,receipt jsonb);
 insert into icash_voice_configs values(md5('account')::uuid,'agent_fixture');
 `);
 const reset=async()=>db.exec(`truncate icash_voice_jobs,icash_automation_tickets,icash_operation_spend,icash_call_recordings,icash_live_conversations,icash_recorded_reception_private.sessions;
 insert into icash_voice_jobs(id,account_id,state,updated_at) values(md5('job')::uuid,md5('account')::uuid,'issued',now()-interval '10 minutes');
 insert into icash_automation_tickets(account_id,voice_job_id,kind,state,outcome,created_at,expires_at,completed_at) values(md5('account')::uuid,md5('job')::uuid,'voice_dispatch','held','held_for_reconciliation',now()-interval '10 minutes',now()-interval '8 minutes',now()-interval '3 minutes');`);
 await reset();
 await db.exec(read('tests/fixtures/unstarted-call-capacity-before.sql'));
 await db.exec('revoke all on function icash_active_voice_slots() from public;grant execute on function icash_active_voice_slots() to service_role;');
 assert.equal(await slots(),1,'The old query counts the closed unstarted handler until its later job reset');
 const snapshot=await one('select (select to_jsonb(j) from icash_voice_jobs j) job,(select to_jsonb(t) from icash_automation_tickets t) ticket');
 await db.exec(patch);
 assert.equal(await slots(),0);
 assert.deepEqual(await one('select (select to_jsonb(j) from icash_voice_jobs j) job,(select to_jsonb(t) from icash_automation_tickets t) ticket'),snapshot,'No ticket retry, state rewrite, recipient change or charge');
 for(const role of ['anon','authenticated','service_role'])assert.equal((await one(`select has_function_privilege('${role}','icash_active_voice_slots()','execute') allowed`)).allowed,role==='service_role');
 for(const change of ["state='dispatching'","state='held',outcome='provider_outcome_unknown_no_retry'","state='held',outcome='provider_receipt_needs_reconciliation'","operation_key='voice:bound'","conversation_id='conv_bound'","provider_call_sid='CA_bound'","updated_at=now()","updated_at=null"]){
  await reset();await db.exec('update icash_voice_jobs set '+change);assert.equal(await slots(),1,change+' must preserve capacity');
 }
 for(const change of ["state='consumed'","state='issued'","outcome='expired'","kind='seller_opener'","account_id=md5('foreign')::uuid","expires_at=now()+interval '1 minute'","completed_at=now()","completed_at=null","completed_at=created_at-interval '1 second'"]){
  await reset();await db.exec('update icash_automation_tickets set '+change);assert.equal(await slots(),1,change+' is not a closed unstarted voice handler');
 }
 await reset();await db.exec('truncate icash_automation_tickets;');assert.equal(await slots(),1,'A missing ticket is not proof');
 await reset();await db.exec('insert into icash_automation_tickets select gen_random_uuid(),account_id,voice_job_id,kind,state,outcome,created_at,expires_at,completed_at from icash_automation_tickets;');assert.equal(await slots(),1,'Multiple attempts require their own reconciliation');
 for(const state of ['reserved','dispatched','settled']){
  await reset();await db.exec(`insert into icash_operation_spend values('voice:'||md5('job')::uuid,md5('foreign')::uuid,'${state}');`);assert.equal(await slots(),1,'Any admitted financial operation retains its original gates');
 }
 for(const binding of ["voice_job_id=md5('job')::uuid","operation_key='voice:'||md5('job')::uuid"]){
  await reset();await db.exec(`insert into icash_call_recordings(id,account_id,agent_id,call_ended_at) values(gen_random_uuid(),md5('account')::uuid,'agent_fixture',now());update icash_call_recordings set ${binding};`);
  // A real ended receipt may release an operation by its existing exact binding.
  // An unrelated recording linked only by job must block the new exception.
  if(binding.startsWith('voice_job_id'))assert.equal(await slots(),1);
  else{await db.exec('update icash_call_recordings set call_ended_at=null;');assert.equal(await slots(),1);}
 }
 await reset();await db.exec("insert into icash_live_conversations values('voice:'||md5('job')::uuid,md5('account')::uuid,'agent_fixture','contact','complete');");assert.equal(await slots(),1,'Even a completed conversation prevents the unstarted exception');
 await reset();await db.exec("insert into icash_recorded_reception_private.sessions values('incoming:fixture',md5('account')::uuid,'agent_fixture','contact',null);");assert.equal(await slots(),1,'Inbound calls retain their slot');
 console.log('Unstarted capacity: completed failed handler only; in-flight, unknown, financial, recording, conversation, multiple-attempt and missing-evidence cases stay held; no retries, writes or changed grants.');
}finally{await db.close();}
