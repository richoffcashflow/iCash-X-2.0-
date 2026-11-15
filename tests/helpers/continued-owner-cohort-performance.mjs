import assert from 'node:assert/strict';
import {seedHandlerOriginal,value,read,issue} from './continued-owner-handler-fixture.mjs';
import {scoreCalls,resetScoreCalls,evidence,original,source} from './owner-wait-admission-fixture.mjs';

// Run only in the fixed disposable native harness, after all five migrations
// and actual batch/cohort definitions are installed. No provider or paid claim.
export async function rehearseContinuedCohortPerformance({admin,blocker,worker}){
 const accounts=[];
 const originalScore=await value(admin,"select pg_get_functiondef('public.icash_opportunity_score(uuid,jsonb,text)'::regprocedure)");
 const originalTurn=await value(admin,'select issued from icash_work_private.continuation_policy where id=1');
 const originalCapacity=await value(admin,'select jsonb_build_object(\'ordinary\',ordinary,\'starter\',starter) from public.fixture_cleanup_policy');
 const isolate=async fn=>{await admin.query('begin');try{return await fn();}finally{await admin.query('rollback');}};
 const oldWait=JSON.parse(read('tests/fixtures/owner-wait-admission-before.json')).find(f=>f.signature==='icash_work_private.record_export_wait(p_account uuid, p_due timestamp with time zone)').definition;
 assert(oldWait.includes('icash_work_private.record_export_wait(p_account uuid, p_due timestamp with time zone)'));
 await admin.query(oldWait.replace('icash_work_private.record_export_wait(p_account uuid, p_due timestamp with time zone)','icash_work_private.fixture_original_record_export_wait(p_account uuid, p_due timestamp with time zone)'));
 await admin.query(`revoke all on function icash_work_private.fixture_original_record_export_wait(uuid,timestamptz) from public,anon,authenticated,service_role;
 create sequence public.fixture_wait_score_calls;
 create or replace function public.icash_opportunity_score(uuid,jsonb,text) returns numeric language sql stable as $$
  select case when nextval('public.fixture_wait_score_calls')>0 then coalesce(($2->>'fixtureScore')::numeric,0) end$$;
 grant usage,select on sequence public.fixture_wait_score_calls to service_role;`);
 try{
  const batch=await seedHandlerOriginal(admin,49000,{size:1,competitors:false});accounts.push(batch.account);
  await admin.query(`insert into public.icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
   select md5('final-wait-candidate-'||i)::uuid,s.account_id,'final-wait-candidate-'||i,
    jsonb_set(jsonb_set(s.snapshot,'{propertyId}',to_jsonb('prop_'||(49000000+i))),'{raw,data,dm_property_id}',to_jsonb('prop_'||(49000000+i))),
    'complete',jsonb_build_object('financialCheck',jsonb_build_object('status','eligible'),'fixtureScore',i),s.completed_at
   from public.icash_screening_jobs s cross join generate_series(1,199)i where s.id=$1`,[batch.screening]);
  assert.equal(await value(admin,'select count(*)::int from public.icash_screening_jobs where account_id=$1',[batch.account]),200);
  assert.equal(await value(admin,'select icash_work_private.continued_owner_handoff_current($1,$2)',[batch.account,batch.screening]),true,'The benchmark includes a valid journal-bound original');
  const saved=await evidence(admin),wait=fn=>value(admin,`select icash_work_private.${fn}($1,(select next_run_at from public.icash_discovery_configs where account_id=$1))`,[batch.account]);
  let beforeElapsed,afterElapsed;
  await isolate(async()=>{
   await admin.query("insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)");
   await resetScoreCalls(admin);const started=performance.now();
   assert.equal(await wait('fixture_original_record_export_wait'),true);beforeElapsed=performance.now()-started;
   assert.equal(await scoreCalls(admin),200,'Captured original wait invokes ranking for every candidate on the final selector');
   assert.deepEqual(await evidence(admin),saved);
  });
  await isolate(async()=>{
   await admin.query("insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)");
   await resetScoreCalls(admin);const started=performance.now();
   assert.equal(await wait('record_export_wait'),true);afterElapsed=performance.now()-started;
   assert.equal(await scoreCalls(admin),0,'Final five-migration existence path does no ranking');
   assert(afterElapsed<3000,`Final 200-candidate wait must stay below 3000ms (${afterElapsed.toFixed(1)}ms)`);
   assert.deepEqual(await evidence(admin),saved);
  });
  for(const blocked of [false,true])await isolate(async()=>{
   if(blocked)await admin.query('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[batch.account]);
   const expected=(await value(admin,'select public.icash_enrichment_before_provider_quota($1)',[batch.account]))!==null;
   await resetScoreCalls(admin);
   assert.equal(await value(admin,'select icash_work_private.owner_enrichment_wait_candidate($1)',[batch.account]),expected);
   assert.equal(await scoreCalls(admin),0,'Final ranked/boolean eligibility agrees without scoring');
  });
  await admin.query('update public.icash_discovery_configs set enabled=false where account_id=$1',[batch.account]);
  // Seed before the contended transaction: real issuance has a later timestamp
  // than the already committed immutable journal, just as the actual handler.
  const paused=await seedHandlerOriginal(admin,49001,{size:3,competitors:false});accounts.push(paused.account);
  const independent=await seedHandlerOriginal(admin,49002,{size:2,competitors:false});accounts.push(independent.account);
  await admin.query('update public.fixture_cleanup_policy set ordinary=3,starter=0');
  await admin.query('update icash_work_private.continuation_policy set issued=0');
  const pausedTicket=await original(admin,paused),pausedSource=await source(admin,paused),independentTicket=await original(admin,independent),before=await evidence(admin);
  await worker.query('set role service_role');
  await blocker.query('begin;select 1 from public.icash_operating_budget where id=1 for update');
  await blocker.query('update public.icash_accounts set bot_paused=true where id=$1',[paused.account]);
  await worker.query('begin');
  const pending=issue(worker).then(result=>({result}),error=>({error}));
  try{
   let waiting=false;const started=performance.now();
   while(performance.now()-started<1500){
    waiting=await value(admin,'select $1::integer=any(pg_blocking_pids($2::integer))',[blocker.processID,worker.processID]);
    if(waiting)break;await new Promise(resolve=>setTimeout(resolve,20));
   }
   assert(waiting,'Final actual issuer waits behind the shared budget lock');
  }finally{await blocker.query('commit');}
  const result=await pending;assert.ifError(result.error);assert.equal(result.result?.id,independent.ticket);
  assert.equal((await original(worker,independent)).state,'issued');
  assert.equal(result.result.owner_preview_retry_until,independentTicket.owner_preview_retry_until);
  assert.deepEqual(await original(admin,paused),pausedTicket);assert.deepEqual(await source(admin,paused),pausedSource);
  assert.deepEqual(await evidence(worker),before,'Contended issuance does not create requests or change financial evidence inside its transaction');
  assert.equal(await value(admin,'select count(*)::int from icash_work_private.acquisition_export_waits where account_id=any($1::uuid[])',[[paused.account,independent.account]]),0);
  console.log(`PASS final five-migration native wait: 200→0 score calls (${beforeElapsed.toFixed(1)}ms→${afterElapsed.toFixed(1)}ms; limit 3000ms), final selector/existence parity, actual multi-item late-Pause budget contention and immutable financial/provider evidence.`);
 }finally{
  await worker.query('rollback');
  await worker.query('reset role');
  if(accounts.length)await admin.query('update public.icash_discovery_configs set enabled=false where account_id=any($1::uuid[])',[accounts]);
  await admin.query('update icash_work_private.continuation_policy set issued=$1 where id=1',[originalTurn]);
  await admin.query('update public.fixture_cleanup_policy set ordinary=$1,starter=$2',[originalCapacity.ordinary,originalCapacity.starter]);
  await admin.query(originalScore);
  await admin.query('drop function icash_work_private.fixture_original_record_export_wait(uuid,timestamptz);drop sequence public.fixture_wait_score_calls');
 }
}
