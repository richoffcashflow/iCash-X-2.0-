import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {learningHealthSchema,improvementReviewSchema} from '../lib/learning-health.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(sql,args=[])=>db.query(sql,args),value=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',account='00000000-0000-4000-8000-000000000001';
try{
 await db.exec(read('tests/fixtures/learning-refresh-concurrency.sql'));
 await db.exec(read('config/learning-refresh-concurrency.sql'));
 await db.exec(read('tests/fixtures/learning-operations-monitor.sql'));
 await db.exec(read('config/learning-operations-review.sql'));
 const migration=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_learning_operations_review.sql'));
 assert.equal(read('supabase/migrations/'+migration),read('config/learning-operations-review.sql'));
 await q('insert into icash_accounts values($1)',[account]);await q('insert into fixture_outcomes(account_id) values($1)',[account]);
 await q('insert into icash_learning_queue(account_id) values($1)',[account]);
 await q("insert into icash_support_threads(id,status,updated_at) values($1,'open',now()-interval '20 days')",[account]);
 let health=learningHealthSchema.parse(await value('select icash_learning_health()'));assert.equal(health.fresh,false);assert.equal(health.queue.neverRefreshed,1);
 assert.deepEqual(await value('select icash_refresh_shared_learning(1)'),{refreshed:1,failed:0,due:0});
 health=learningHealthSchema.parse(await value('select icash_learning_health()'));assert.equal(health.status,'ok');assert.equal(health.queue.neverRefreshed,0);
 assert.equal(await value('select count(*)::int from icash_learning_private.refresh_runs'),1);
 const proposals=()=>value('select icash_learning_operations_report($1)',[owner]);
 let report=improvementReviewSchema.parse(await proposals());assert(report.proposals.some(p=>p.category==='support_stalled'));
 assert(report.proposals.every(p=>p.status==='observed'));
 const count=await value('select sum(observations)::int from icash_learning_private.improvement_proposals');
 await value('select icash_review_learning_operations()');assert.equal(await value('select sum(observations)::int from icash_learning_private.improvement_proposals'),count,'Review is bounded to hourly');
 for(let i=0;i<2;i++){
  await q("update icash_learning_private.components set last_attempt_at=now()-interval '61 minutes' where component='review'");
  await q("update icash_learning_private.improvement_proposals set first_observed_at=now()-interval '3 hours',last_observed_at=now()-interval '61 minutes'");
  await value('select icash_review_learning_operations()');
 }
 report=await proposals();const p=report.proposals.find(p=>p.category==='support_stalled');assert.equal(p.status,'candidate');assert.equal(p.observations,3);
 assert.equal(await value("select count(*)::int from icash_learning_private.proposal_events where status='candidate'"),2);
 // Failed work preserves source data, error SQLSTATE and the last success; no private exception text survives.
 await q("update icash_learning_queue set due_at=now()-interval '1 minute'");await q("set fixture.fail='true'");
 const oldSuccess=health.refresh.lastSuccessAt;await value('select icash_refresh_shared_learning(1)');
 health=learningHealthSchema.parse(await value('select icash_learning_health()'));assert.equal(health.queue.failed,1);assert.equal(health.refresh.lastErrorCode,'P0001');assert.equal(health.refresh.lastSuccessAt,oldSuccess);
 assert.doesNotMatch(JSON.stringify(await value('select jsonb_agg(to_jsonb(c)) from icash_learning_private.components c')),/Synthetic/);
 await db.exec("create or replace function icash_usage_loop_report(uuid,boolean) returns jsonb language plpgsql as $$begin raise exception using errcode='22000',message='private customer detail';end $$;");
 await q("update icash_learning_conversion_cache set updated_at=now()-interval '7 hours'");await value('select icash_refresh_shared_learning(1)');
 health=learningHealthSchema.parse(await value('select icash_learning_health()'));assert.equal(health.conversion.lastErrorCode,'22000');assert.equal(health.status,'degraded');
 assert(await value('select conversion_error is not null from icash_learning_private.refresh_runs order by id desc limit 1'));
 const snapshot=await value('select icash_refresh_account_work_snapshot()');assert.equal(snapshot.issueCount,2+health.warningCount);
 assert.equal((await value('select icash_refresh_account_work_snapshot()')).issueCount,snapshot.issueCount,'Repeated health snapshot does not double-count warnings');
 await assert.rejects(value('select icash_platform_learning_report($1)',[account]),/Owner required/);
 // No stage can advance from arbitrary claims or a mismatched receipt.
 const transition=(stage,receipt)=>value('select icash_transition_improvement_proposal($1,1,$2,$3)',[p.id,stage,receipt]);
 const rid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 await assert.rejects(transition('offline_validated',rid(1)),/Verified receipt required/);
 const receipt=async(n,stage,extra={},sha='a'.repeat(40))=>q('insert into icash_learning_private.validation_receipts(id,proposal_id,proposal_version,stage,release_sha,policy_version,receipt) values($1,$2,1,$3,$4,\'reviewed-v1\',$5)',[rid(n),p.id,stage,sha,JSON.stringify({verified:true,sourceId:'canonical-fixture-'+n,...extra})]);
 await receipt(1,'offline_validated');await assert.rejects(transition('offline_validated',rid(1)),/Unsupported/);
 await receipt(2,'promoted',{source:'policy_decision',outcomePassed:true});await assert.rejects(transition('promoted',rid(2)),/Unsupported/);
 await receipt(3,'offline_validated',{source:'release_ci',offlinePassed:true});assert.equal((await transition('offline_validated',rid(3))).status,'offline_validated');
 assert.equal((await transition('offline_validated',rid(3))).replayed,true);
 await receipt(4,'limited_experiment',{source:'policy_decision',limitedActive:true},'b'.repeat(40));await assert.rejects(transition('limited_experiment',rid(4)),/lineage changed/);
 await receipt(5,'limited_experiment',{source:'policy_decision',limitedActive:true});await transition('limited_experiment',rid(5));
 await transition('promoted',rid(2));await receipt(6,'rolled_back',{source:'policy_decision',rollbackApplied:true});await transition('rolled_back',rid(6));
 assert.equal((await proposals()).proposals.find(x=>x.id===p.id).status,'rolled_back');
 await q("update icash_learning_private.proposal_events set created_at=now()-interval '25 hours' where proposal_id=$1 and status='rolled_back'",[p.id]);
 await q("update icash_learning_private.components set last_attempt_at=now()-interval '61 minutes' where component='review'");
 await value('select icash_review_learning_operations()');
 const successor=(await proposals()).proposals.find(x=>x.category==='support_stalled'&&x.version===2);assert(successor);assert.equal(successor.status,'observed');
 assert.equal((await proposals()).proposals.find(x=>x.id===p.id).status,'rolled_back','Terminal original evidence is preserved');

 for(const role of ['anon','authenticated']){
  for(const fn of ['icash_learning_health()','icash_review_learning_operations()','icash_learning_operations_report(uuid)','icash_transition_improvement_proposal(bigint,integer,text,uuid)'])assert.equal(await value(`select has_function_privilege('${role}',$1,'execute')`,[fn]),false);
  assert.equal(await value(`select has_schema_privilege('${role}','icash_learning_private','usage')`),false);
 }
 assert.equal(await value("select has_table_privilege('service_role','icash_learning_private.validation_receipts','insert')"),false,'Only canonical registrar can register receipts');
 console.log('Learning operations: durable errors, cache freshness, monitor accounting, bounded recurring candidates, immutable validation lineage, stage gates and private ACLs passed.');
}finally{await db.close();}
