import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reliabilitySchema} from '../../lib/reliability.ts';
import {reliabilityPriority} from '../../lib/reliability-priority.ts';

export async function verifyWorkflowAcknowledgements({pg,one,id}){
 const sql=readFileSync(new URL('../../config/workflow-acknowledgements.sql',import.meta.url),'utf8');
 assert.equal(sql,readFileSync(new URL('../../supabase/migrations/20261026221446_workflow_acknowledgements.sql',import.meta.url),'utf8'));
 await pg.exec(sql);
 const refresh=async(name='icash_refresh_reviewed_workflow_snapshot')=>{
  await pg.exec("update icash_reliability_private.snapshots set checked_at=now()-interval '1 minute';select public."+name+'()');
  return reliabilitySchema.parse(await one('select public.icash_reliability_status()'));
 };
 assert.equal((await refresh()).snapshot.issueCount,0);
 const account=id(902),thread=id(903),message=id(904),job=id(905);
 await pg.query('insert into icash_text_threads(id,account_id,sender,recipient) values($1,$2,$3,$4)',[thread,account,'+12025550100','+12025550101']);
 await pg.query("insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,updated_at) values($1,$2,$3,'outgoing','needs_review','SIMULATION original receipt',now()-interval '1 day')",[message,account,thread]);
 await pg.query("insert into icash_voice_jobs(id,account_id,state,operation_key,updated_at) values($1,$2,'dispatching','SIMULATION original held operation',now()-interval '1 day')",[job,account]);
 await pg.exec("insert into icash_operation_spend(operation_key) values('SIMULATION original held operation')");
 const original=await one('select jsonb_build_object(\'text\',(select to_jsonb(m) from icash_text_messages m where id=$1),\'voice\',(select to_jsonb(v) from icash_voice_jobs v where id=$2),\'operation\',(select to_jsonb(o) from icash_operation_spend o where operation_key=$3))',[message,job,'SIMULATION original held operation']);
 let report=await refresh();assert.equal(report.snapshot.issueCount,2);assert.equal(report.snapshot.acknowledgedCount,0,'migration never automatically acknowledges work');
 const before=report.snapshot.issues;
 const acknowledge=async(issue,overrides={})=>{
  const v={...issue,...overrides};
  await pg.query('insert into icash_reliability_private.workflow_acknowledgements(kind,resource_id,account_id,since,disposition,review_reference) values($1,$2,$3,$4,$5,$6)',[v.kind,v.resourceId,v.accountId,v.since,v.kind==='text_review'?'provider_failure_confirmed':'provider_outcome_unknown','SIMULATION explicit owner review']);
 };
 for(const overrides of [{accountId:id(999)},{resourceId:id(999)},{kind:'seller_response'},{since:new Date(Date.parse(before[0].since)-1000).toISOString()}]){
  await pg.exec('begin');
  try{await acknowledge(before[0],overrides);assert.equal((await refresh()).snapshot.issueCount,2,'another account, resource, kind or failure timestamp cannot match');}
  finally{await pg.exec('rollback');}
 }
 for(const issue of before)await acknowledge(issue);
 report=await refresh();assert.equal(report.snapshot.issueCount,0);assert.equal(report.snapshot.acknowledgedCount,2);assert.equal(report.snapshot.acknowledgedIssues.length,2);
 assert.equal(report.status,'ok');assert.equal(reliabilityPriority(report),null);
 assert(!JSON.stringify(report).includes('+1202'));assert(!JSON.stringify(report).includes('SIMULATION original receipt'));
 assert.equal((await refresh('icash_refresh_outreach_reliability_snapshot')).snapshot.issueCount,2,'older app still sees original failures before compatible activation');
 assert.equal((await refresh()).snapshot.issueCount,0);
 const after=await one('select jsonb_build_object(\'text\',(select to_jsonb(m) from icash_text_messages m where id=$1),\'voice\',(select to_jsonb(v) from icash_voice_jobs v where id=$2),\'operation\',(select to_jsonb(o) from icash_operation_spend o where operation_key=$3))',[message,job,'SIMULATION original held operation']);
 assert.deepEqual(after,original,'acknowledgment never changes provider receipts, jobs or spending holds');
 await pg.query("update icash_voice_jobs set updated_at=updated_at+interval '1 second' where id=$1",[job]);
 report=await refresh();assert.equal(report.snapshot.issueCount,1,'a changed failure is active again');assert.equal(report.snapshot.issues[0].resourceId,job);
 assert.equal(report.snapshot.acknowledgedCount,1);
 await pg.query('update icash_voice_jobs set updated_at=$2 where id=$1',[job,before.find(x=>x.resourceId===job).since]);
 for(let i=0;i<30;i++){
  await pg.query("insert into icash_voice_jobs(id,account_id,state,updated_at) values($1,$2,'dispatching',now()-interval '12 hours')",[id(1000+i),account]);
 }
 report=await refresh();assert.equal(report.snapshot.issueCount,30);assert.equal(report.snapshot.issues.length,25,'reviewed rows are removed before pagination');
 for(const issue of report.snapshot.issues)await acknowledge(issue);
 report=await refresh();assert.equal(report.snapshot.issueCount,5);assert.equal(report.snapshot.issues.length,5,'new work after the first page remains visible');
 assert.equal(report.snapshot.acknowledgedCount,27);assert.equal(report.snapshot.acknowledgedIssues.length,25);
 await pg.query("update icash_text_messages set state='delivered' where id=$1",[message]);
 report=await refresh();assert.equal(report.snapshot.acknowledgedCount,26,'original receipt recovery removes the item from pending reviewed history');
 assert.equal(await one('select count(*)::int from icash_reliability_private.workflow_acknowledgements'),27,'audit history is retained after recovery');
 await pg.exec("select public.icash_record_service_heartbeat('worker','degraded')");
 report=await refresh();assert.equal(reliabilityPriority(report),'critical','acknowledgments cannot hide a core outage');
 await pg.exec("select public.icash_record_service_heartbeat('worker','ok');set role service_role");
 assert.equal(await one('select count(*)::int from icash_reliability_private.workflow_acknowledgements'),27);
 await assert.rejects(pg.query('insert into icash_reliability_private.workflow_acknowledgements select * from icash_reliability_private.workflow_acknowledgements limit 0'),/permission denied/);
 await assert.rejects(pg.query('delete from icash_reliability_private.workflow_acknowledgements where false'),/permission denied/);
 await pg.exec('reset role');
 for(const role of ['anon','authenticated']){
  await pg.exec('set role '+role);
  await assert.rejects(pg.query('select * from icash_reliability_private.workflow_acknowledgements'),/permission denied/);
  await assert.rejects(pg.query('select public.icash_refresh_reviewed_workflow_snapshot()'),/permission denied/);
  await pg.exec('reset role');
 }
 console.log('PASS owner-reviewed workflow history: exact occurrence binding, retained holds, new failures, pagination, core outage priority and read-only service access.');
}
