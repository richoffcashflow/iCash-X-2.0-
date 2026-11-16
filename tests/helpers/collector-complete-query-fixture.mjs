import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installPriorityFixture,value,operation} from './research-priority-fixture.mjs';
import {seedLive,seedReady,seedOrdinary} from './continued-owner-scheduling-fixture.mjs';
import {migration} from './collector-deadline-fixture.mjs';
import {renderCohortQuery,createObservation} from '../../scripts/work-cohort.mjs';
const exec=(db,s)=>db.exec?db.exec(s):db.query(s);
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
// Complete collector SQL and observation transformation, not full installed
// production schema: provider/eligibility boundaries remain fixture helpers.
export async function exerciseCompleteCollector(db){
 await installPriorityFixture(db);
 await exec(db,'begin isolation level repeatable read');
 try{
  await exec(db,readFileSync(new URL('../fixtures/collector-complete-columns.sql',import.meta.url),'utf8'));
  const cases=[];for(const seed of [seedLive,seedReady,seedOrdinary,seedOrdinary])cases.push(await seed(db,98000+cases.length));
  const [a,b,c,d]=cases.map(x=>x.account);
  await exec(db,`create table public.fixture_cohort_excluded(id uuid primary key);
   create or replace function public.icash_membership_work_allowed(a uuid) returns boolean language sql stable as $$select a is not null and not exists(select 1 from public.fixture_cohort_excluded where id=a)$$;
   create or replace function public.icash_outreach_window_open(z text,b text,t timestamptz) returns boolean language sql stable as $$select z='America/Chicago'$$;`);
  await db.query(`update public.icash_accounts set created_at=now()-interval '30 days',workspace_ack_version='current' where id=any($1::uuid[])`,[[a,b,c,d]]);
  await db.query(`update public.icash_operation_rates set enabled=true,expires_at=now()+interval '1 day'`);
  await db.query(`update public.icash_discovery_configs set enabled=true,auto_enabled=true,contacts_enabled=true,data_rights_until=now()+interval '1 day' where account_id=any($1::uuid[])`,[[a,b,c,d]]);
  await db.query("update public.icash_screening_jobs set completed_at=now()-interval '2 days' where account_id=$1",[d]);
  await db.query('update public.fixture_cleanup_policy set ordinary=3,starter=0');
  await db.query(`update public.icash_accounts set bot_paused=true where id=$1`,[b]);
  await db.query(`insert into public.icash_control_events(id,account_id,action,created_at) values($1,$2,'pause',now())`,[id(900),b]);
  await db.query(`insert into public.fixture_cohort_excluded values($1)`,[c]);
  await db.query(`insert into public.icash_text_messages(id,account_id,provider_id,state,direction,body,attachments,created_at,updated_at,last_delivery_at) values
   ($1,$3,'accepted-original','accepted','outgoing','synthetic','[]',now()-interval '1 hour',now(),null),
   ($2,$3,'delivered-original','delivered','outgoing','synthetic','[]',now()-interval '1 hour',now(),now())`,[id(901),id(902),a]);
  await db.query(`insert into public.icash_voice_jobs(id,account_id,operation_key,provider_call_sid,permission_id,state,created_at,updated_at) values($1,$2,'synthetic-call','exact-sid',$1,'dispatched',now()-interval '1 hour',now()),($3,$2,'unmatched','unmatched-sid',$3,'dispatched',now(),now())`,[id(903),a,id(904)]);
  await db.query(`insert into public.icash_call_recordings(id,account_id,voice_job_id,operation_key,call_sid,created_at,dial_claimed_at) values
   ($1,$4,$5,'wrong-operation','exact-sid',now()-interval '2 hours',now()-interval '2 hours'),
   ($2,$4,$5,'synthetic-call','wrong-sid',now()-interval '2 hours',now()-interval '2 hours'),
   ($3,$4,$5,'synthetic-call','exact-sid',now()-interval '1 hour',now()-interval '1 hour')`,[id(905),id(906),id(907),a,id(903)]);
  await operation(db,a,'synthetic-unsettled-original',{state:'dispatched',cap:100});
  await db.query("update public.icash_operation_spend set settled_at=null,dispatched_at=now()-interval '2 days' where operation_key='synthetic-unsettled-original'");
  const baseline={cohortId:'synthetic-complete-363',accounts:[...cases.map(x=>({id:x.account})),...Array.from({length:359},(_,n)=>({id:id(n+1)}))]};
  const rendered=renderCohortQuery(baseline);
  // Strip ONLY transaction envelope: both exact SELECTs share this transaction
  // and now(). Keep unchanged 20s timeout, complete CTEs, fields and ordering.
  assert(rendered.startsWith('-- Read-only'));assert(rendered.endsWith('commit;\n'));
  const query=rendered.slice(rendered.indexOf('with fixed_members'),rendered.lastIndexOf('commit;'));
  await exec(db,"set local statement_timeout='20s'");
  // Test transport projection only: preserve PostgreSQL microseconds instead
  // of letting a JavaScript Date parser truncate the top-level timestamp.
  // The complete inner SELECT is unchanged, apart from its final semicolon.
  const fixedTime=await value(db,'select now()::text');
  const transport=`select observed_at::text,evidence from (${query.trim().replace(/;$/,'')}) exact_observation order by (evidence->>'id')::uuid`;
  const observe=async()=>{
   const rows=JSON.parse(JSON.stringify((await db.query(transport)).rows));
   assert(rows.every(row=>row.observed_at===fixedTime),'Exact common PostgreSQL microsecond timestamp');
   return rows;
  };
  const before=await observe();assert.equal(before.length,363);
  const evidence=before.find(r=>r.evidence.id===a).evidence;
  assert(evidence.original_operations.some(o=>o.id==='synthetic-unsettled-original'&&o.state==='dispatched'&&o.settledAt===null));
  assert(evidence.enrichment_candidate,'Must include a real non-null ranked candidate');
  assert.equal(evidence.call_receipts.find(r=>r.operationId==='synthetic-call').recordingId,id(907));
  assert.equal(evidence.call_receipts.find(r=>r.operationId==='unmatched').recordingId,null);
  assert.equal(before.find(r=>r.evidence.id===d).evidence.enrichment_candidate,null,'Known current account with no current eligible screening');
  const old=createObservation(baseline,before);
  assert.equal(old.payload.counts.textAccepted24h,2);assert.equal(old.payload.counts.textDelivered24h,1);assert.equal(old.payload.counts.textAwaitingReceipt,1);
  assert.equal(old.payload.counts.callProviderIds24h,1);assert.equal(old.payload.counts.callTimesUnknown,1);
  assert(old.payload.accounts.find(x=>x.id===b).classification.tags.includes('customer_pause'));
  assert(old.payload.accounts.find(x=>x.id===c).classification.tags.includes('membership_not_current'));
  assert.equal(old.payload.accounts.find(x=>x.id===id(1)).classification.status,'unknown');
  await exec(db,migration);await exec(db,"set local statement_timeout='20s'");
  const after=await observe();assert.deepEqual(after,before,'All collector evidence, row/array order and timestamps');
  const next=createObservation(baseline,after);assert.deepEqual(next,old,'Every classification/count and complete observation hash');
  return {rows:after.length,hash:next.hash,counts:next.payload.counts,scope:'complete unchanged collector and createObservation on synthetic schema with captured selector chain; not full production schema or unmocked admission'};
 }finally{await exec(db,'rollback');}
}
