import assert from 'node:assert/strict';
import {installContinuedHandlerFixture,seedHandlerOriginal,handlerBoundary,issueAndConsume,issue,value,read,captured,SyntheticFinalClaimReached} from './continued-owner-handler-fixture.mjs';
import {OwnerExportPreflightPendingError} from '../../lib/owner-export-preflight.ts';
import {OwnerPreviewRateLimitError,OwnerExportCapacityBusyError} from '../../lib/owner-enrichment-deferral.ts';
import {installContinuedHandlerFinancialFixture,seedContinuedHandlerFinancial,seedContinuedHandlerOutreachFloor,seedContinuedHandlerOrphanCost,financialFunctions} from './continued-owner-handler-financial-fixture.mjs';
export async function rehearseContinuedOwnerHandler(pg,{afterHandoffInstall=null}={}){
const v=(sql,args=[])=>value(pg,sql,args);
const priorKey=process.env.DEALMACHINE_API_KEY;process.env.DEALMACHINE_API_KEY='dm_sk_live_synthetic_fixture_only';
const priorFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('External network is forbidden in the continued-handler rehearsal');};
// Seed the journal in its own committed transaction, like maintenance. The
// later selector's now() must follow its clock_timestamp() receipt.
let financialReady=false;
const isolated=async fn=>{let c;const seed=async(n,options)=>{c=await seedHandlerOriginal(pg,n,{...options,prepareFinancial:financialReady?seedContinuedHandlerFinancial:null});await pg.exec('begin');return c;};
 try{await fn(seed);}finally{if(c){await pg.exec('rollback');await pg.query('update public.icash_discovery_configs set enabled=false where account_id=$1',[c.account]);await pg.query('update public.icash_accounts set bot_paused=true where id=$1',[c.account]);}}};
try{
 await installContinuedHandlerFixture(pg);
 const finalGuards=[...JSON.parse(read('tests/fixtures/continued-owner-handler-final.json')),...captured.filter(entry=>!entry.signature.includes('icash_owner_batch_candidates'))];
 const assertFinalGuards=async()=>{for(const entry of finalGuards)assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[entry.signature]),entry.md5,'The actual final guard/recorder remains unchanged: '+entry.signature);};
 await assertFinalGuards();
 await isolated(async seed=>{
  const c=await seed(54001,{size:3,siblingTickets:true,competitors:false});
  assert.equal(await v('select icash_research_private.owner_preflight_cohort($1,$2)',[c.account,c.screening]),null);
  const candidates=await v('select public.icash_owner_batch_candidates($1,$2)',[c.account,c.screening]);
  assert.equal(candidates.length,1,'Reproduce original three-item source reduced to primary after cleanup');
  assert.equal((await v('select public.icash_continued_owner_preflight($1,$2,$3,false)',[c.account,c.screening,JSON.stringify(c.items)])).status,'bound');
  await issueAndConsume(pg,c);
  const boundary=handlerBoundary(pg,c);
  assert.deepEqual(await boundary.run(),{status:'held'});assert.equal(boundary.calls.length,0);
  assert.equal((await v('select public.icash_claim_owner_preflight($1,$2,$3)',[c.account,JSON.stringify(c.items),c.request])).status,'quota_wait','Existing sibling-ticket renewal guard stays authoritative');
 });
 // The same failure also affects still-authorized originals without ticketed
 // siblings: unrelated fresh candidates displace the old complete cohort.
 await isolated(async seed=>{
  const c=await seed(54002,{size:3,siblingTickets:false,competitors:true});
  await issueAndConsume(pg,c);
  const boundary=handlerBoundary(pg,c);
  assert.deepEqual(await boundary.run(),{status:'held'});assert.equal(boundary.calls.length,0);
 });
 const migration=read('config/continued-owner-cohort-handoff.sql');
 assert.equal(migration,read('supabase/migrations/20261115152657_continued_owner_cohort_handoff.sql'));
 await pg.exec('begin;'+migration+'commit;');
 await assertFinalGuards();
 if(afterHandoffInstall)await afterHandoffInstall();
 await installContinuedHandlerFinancialFixture(pg);financialReady=true;
 const assertFinancialGuards=async()=>{for(const entry of financialFunctions)assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[entry.signature]),entry.md5,'Exact production financial dependency: '+entry.signature);};
 await isolated(async seed=>{
  const c=await seed(54003,{size:3,siblingTickets:true,competitors:false});
  await pg.query("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where id=$1",[c.fresh]);
  // The ordinary turn must not provide an alternate route around a blocked
  // journal. Ranked selection and rank-free existence share this exclusion.
  for(const turn of [0,1,2]){
   await pg.query('savepoint blocked_original_turn');
   await pg.query('update icash_work_private.continuation_policy set issued=$1',[turn]);
   assert.equal(await v('select public.icash_enrichment_before_prospecting_budget($1)',[c.account]),null);
   assert.equal(await v('select icash_work_private.owner_enrichment_candidate_exists($1)',[c.account]),false);
   assert.equal(await issue(pg),null,'Both ordinary and continuation turns exclude the original with sibling tickets');
   await pg.exec('rollback to savepoint blocked_original_turn;release savepoint blocked_original_turn');
  }
 });
 let positiveNumber=54100;
 for(const scenario of [{size:2},{size:3},{size:3,checking:true,cleanup:false},{size:2,cleanup:false}])await isolated(async seed=>{
  const c=await seed(++positiveNumber,{...scenario,siblingTickets:false,competitors:true});
  const journal=await v('select to_jsonb(j) from icash_research_private.expired_preflight_ticket_continuations j where ticket_id=$1',[c.ticket]);
  const wallet=await v('select jsonb_build_array(balance_cents,reserved_cents) from public.icash_wallets where account_id=$1',[c.account]);
  const selected=await issueAndConsume(pg,c),boundary=handlerBoundary(pg,c);
  assert.deepEqual(await v('select icash_work_private.continued_owner_batch_cohort($1,$2)',[c.account,c.screening]),c.items);
  await assert.rejects(boundary.run(),OwnerExportPreflightPendingError);
  assert.equal(boundary.calls.length,scenario.cleanup===false?2:1);
  const original=await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
  const child=await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where supersedes=$1',[c.preflight]);
  assert.equal(child.state,'waiting');assert.equal(child.generation,2);assert.deepEqual(child.items,c.items);assert.deepEqual(child.request,c.request);
  assert.equal(await v('select public.icash_defer_owner_enrichment($1,$2,$3,$4,$5)',[c.ticket,c.account,c.screening,selected.token,`owners:${c.account}:${c.screening}`]),true);
  await pg.query('update icash_research_private.owner_export_settings set preflight_renewal_enabled=false');
  // Advance only synthetic due times; the immutable original expiry is retained.
  await pg.query("update icash_research_private.owner_export_preflights set next_check_at=clock_timestamp()-interval '1 second' where id=$1",[child.id]);
  await pg.query("update public.icash_automation_tickets set owner_preview_retry_after=clock_timestamp()-interval '1 second' where id=$1",[c.ticket]);
  await pg.query("update public.icash_discovery_configs set next_run_at=now()-interval '1 minute' where account_id=$1",[c.account]);
  await issueAndConsume(pg,c);
  const live=await v('select icash_research_private.owner_preflight_cohort($1,$2)',[c.account,c.screening]);assert.deepEqual(live,c.items);
  // Introduce each late control only after the full current cohort, refreshed
  // preview and READY child have reached the actual final RPC. Recover just
  // that statement so earlier per-item reservations cannot hide partial work.
  if(scenario.size===3&&!scenario.checking&&scenario.cleanup!==false){
   for(const label of ['Pause','funds','sibling ticket']){
    await pg.query('savepoint final_control_case');let changed=false;
    const late=handlerBoundary(pg,c,{finalQuota:true,stopAfterFinalClaim:true,recoverFinalFailure:true,beforeRpc:async name=>{
     if(name!=='icash_admit_owner_active_export')return;changed=true;
     if(label==='Pause')await pg.query('update public.icash_accounts set bot_paused=true where id=$1',[c.account]);
     if(label==='funds')await pg.query('update public.icash_wallets set balance_cents=0 where account_id=$1',[c.account]);
     if(label==='sibling ticket')await pg.query("insert into public.icash_automation_tickets(account_id,kind,screening_id,state,outcome) values($1,'contacts',$2,'held','held')",[c.account,c.items[1].screeningId]);
    }});
    if(label==='Pause')assert.deepEqual(await late.run(),{status:'held'});
    else await assert.rejects(late.run(),error=>error.message===(label==='sibling ticket'?'Owner batch sibling already ticketed':'Research pacing or state hold'));
    assert(changed,label+' must be tested at the final RPC');
    assert.equal(late.rpcCalls.at(-1).name,'icash_admit_owner_active_export');
    assert.equal(await v('select count(*)::integer from public.icash_operation_spend where account_id=$1',[c.account]),0,label+' leaves no partial spend');
    assert.equal(await v('select count(*)::integer from public.icash_credit_reservations where account_id=$1',[c.account]),0,label+' leaves no partial credit reservation');
    assert.equal(await v('select count(*)::integer from icash_research_private.owner_batches where account_id=$1',[c.account]),0);
    assert(late.calls.every(x=>!x.url.endsWith('/people/export')));
    await pg.exec('rollback to savepoint final_control_case;release savepoint final_control_case');
   }
   const financialEvidence=()=>v(`select jsonb_build_object(
    'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from public.icash_operation_spend o where account_id=$1),
    'reservations',(select jsonb_agg(to_jsonb(r) order by id) from public.icash_credit_reservations r where account_id=$1),
    'batches',(select jsonb_agg(to_jsonb(b) order by id) from icash_research_private.owner_batches b where account_id=$1),
    'exports',(select jsonb_agg(to_jsonb(e) order by e.id) from icash_research_private.owner_exports e join icash_research_private.owner_batches b on b.id=e.id where b.account_id=$1),
    'requests',(select jsonb_agg(to_jsonb(r) order by id) from icash_research_private.requests r where account_id=$1),
    'operatingBudget',(select to_jsonb(b) from public.icash_operating_budget b where id=1),
    'prospectingBudgets',(select jsonb_agg(to_jsonb(b) order by id) from public.icash_prospecting_budgets b where account_id=$1),
    'wallet',(select to_jsonb(w) from public.icash_wallets w where account_id=$1))`,[c.account]);
   for(const kind of ['sibling operation','active export']){
    await pg.query('savepoint canonical_unknown_case');let known;
    const late=handlerBoundary(pg,c,{finalQuota:true,stopAfterFinalClaim:true,recoverFinalFailure:true,beforeRpc:async(name,payload)=>{
     if(name!=='icash_admit_owner_active_export')return;
     if(kind==='sibling operation'){
      const item=c.items[1],op=`owners:${c.account}:${item.screeningId}`;
      await v('select public.icash_reserve_operation($1,$2,$3,$4)',[c.account,op,c.rate,c.config.data_rights_until]);
      assert.equal(await v('select public.icash_claim_owner_enrichment($1,$2,$3,$4,$5,$6,$7,$8,$9)',[c.account,item.screeningId,op,item.snapshot,c.rate,c.config.contact_credit_cap,c.config.property_credit_micros,250000,c.config.data_rights_until]),true);
     }else{
      assert.equal(await v('select public.icash_admit_owner_active_export($1,$2,gen_random_uuid(),$3,$4,$5,$6)',[c.account,c.screening,JSON.stringify(payload.p_items),payload.p_preview,payload.p_config,payload.p_request]),'claimed');
     }
     known=await financialEvidence();
     assert(known.operations.every(o=>o.state==='dispatched'&&o.settled_at===null),'The prior canonical attempt has no settled result');
    }});
    if(kind==='sibling operation')await assert.rejects(late.run(),/Owner batch operation already exists/);
    else await assert.rejects(late.run(),OwnerExportCapacityBusyError);
    assert(known);assert.deepEqual(await financialEvidence(),known,kind+' retains its original authority with no new partial claim');
    assert.equal(late.rpcCalls.at(-1).name,'icash_admit_owner_active_export');
    assert(late.calls.every(x=>!x.url.endsWith('/people/export')));
    await pg.exec('rollback to savepoint canonical_unknown_case;release savepoint canonical_unknown_case');
   }
   // Record unchanged final semantics separately from canonical unknown work.
   // A schema-valid orphan cost row has no batch/operation/export admission. It blocks
   // source/reissue gates above but is not re-read by the existing final claim.
   // Likewise an already-consumed READY handler can complete after its original
   // reissue deadline passes. Neither observation authorizes a fresh reissue.
   for(const observation of ['orphan cost only','deadline crossed after consume']){
    await pg.query('savepoint final_semantics_case');
    const late=handlerBoundary(pg,c,{finalQuota:true,stopAfterFinalClaim:true,beforeRpc:async name=>{
     if(name!=='icash_admit_owner_active_export')return;
     if(observation==='orphan cost only')await seedContinuedHandlerOrphanCost(pg,c,c.items[1].screeningId);
     else await pg.query("update public.icash_automation_tickets set owner_preview_retry_until=clock_timestamp()-interval '1 second' where id=$1",[c.ticket]);
     assert.equal(await v('select icash_work_private.continued_owner_batch_cohort($1,$2)',[c.account,c.screening]),null,'This changed source cannot authorize a new continuation');
    }});
    await assert.rejects(late.run(),SyntheticFinalClaimReached);
    assert.equal(late.rpcCalls.at(-1).result,'claimed',observation+' is an explicitly recorded pre-existing final-boundary behavior');
    assert(late.calls.every(x=>!x.url.endsWith('/people/export')));
    await pg.exec('rollback to savepoint final_semantics_case;release savepoint final_semantics_case');
   }
  }
  const second=handlerBoundary(pg,c,{finalQuota:true,stopAfterFinalClaim:true});
  await assert.rejects(second.run(),SyntheticFinalClaimReached);
  const finalCall=second.rpcCalls.at(-1);assert.equal(finalCall.name,'icash_admit_owner_active_export');assert.equal(finalCall.result,'claimed');
  assert.deepEqual(finalCall.payload.p_items,c.items);
  const batch=await v('select to_jsonb(b) from icash_research_private.owner_batches b where id=$1',[finalCall.payload.p_batch]);
  assert.deepEqual(batch.items,c.items);assert.equal(batch.primary_screening,c.screening);
  assert.deepEqual(await v('select request from icash_research_private.owner_exports where id=$1',[batch.id]),c.request);
  const admitted=await v("select to_jsonb(r) from icash_research_private.requests r where id=$1",[batch.id]);
  assert.equal(admitted.admitted,true);assert.equal(admitted.operation_key,'owner-batch:'+batch.id);assert.equal(admitted.finished_at,null);
  const spend=await v('select jsonb_agg(to_jsonb(o) order by operation_key) from public.icash_operation_spend o where account_id=$1',[c.account]);
  const reservations=await v('select jsonb_agg(to_jsonb(r) order by operation_key) from public.icash_credit_reservations r where account_id=$1',[c.account]);
  assert.equal(spend.length,c.items.length);assert.equal(reservations.length,c.items.length);
  for(const item of c.items){
   const op=`owners:${c.account}:${item.screeningId}`,operation=spend.find(x=>x.operation_key===op),reservation=reservations.find(x=>x.operation_key===op);
   assert(operation&&reservation);assert.equal(operation.state,'dispatched');assert.equal(operation.credit_reservation_id,reservation.id);
   assert.equal(reservation.status,'reserved');assert(reservation.amount_cents>0);assert.equal(reservation.settled_cents,null);
  }
  // The actual current credit reservation records authority without a wallet
  // hold or charge. Only the eventual settlement may change the balance.
  assert.deepEqual(await v('select jsonb_build_array(balance_cents,reserved_cents) from public.icash_wallets where account_id=$1',[c.account]),wallet);
  assert(second.calls.every(x=>!x.url.endsWith('/people/export')),'The admitted fixture operation is never dispatched to any provider');
  assert.deepEqual(await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]),original);
  assert.deepEqual(await v('select to_jsonb(j) from icash_research_private.expired_preflight_ticket_continuations j where ticket_id=$1',[c.ticket]),journal);
 });
 const rejects=[
  ['Pause',c=>pg.query('update public.icash_accounts set bot_paused=true where id=$1',[c.account])],
  ['whole-cohort funds',c=>pg.query('update public.icash_wallets set balance_cents=210 where account_id=$1',[c.account])],
  ['outreach floor',async c=>{const floor=await seedContinuedHandlerOutreachFloor(pg,c);await pg.query('update public.icash_wallets set balance_cents=$2 where account_id=$1',[c.account,c.items.length*105+floor-1]);}],
  ['expired original',c=>pg.query('update public.icash_automation_tickets set owner_preview_retry_until=now() where id=$1',[c.ticket])],
  ['generic hold',c=>pg.query("update public.icash_automation_tickets set outcome='held' where id=$1",[c.ticket])],
  ['source drift',c=>pg.query("update public.icash_screening_jobs set snapshot=snapshot||'{\"changed\":true}' where id=$1",[c.items[1].screeningId])],
  ['NULL source timestamp',c=>pg.query("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{fetchedAt}','null') where id=$1",[c.items[1].screeningId])],
  ['unknown sibling receipt',c=>seedContinuedHandlerOrphanCost(pg,c,c.items[1].screeningId)],
  ['renewal disabled',()=>pg.query('update icash_research_private.owner_export_settings set preflight_renewal_enabled=false')],
  ['sibling ticket',c=>pg.query("insert into public.icash_automation_tickets(account_id,kind,screening_id,state,outcome) values($1,'contacts',$2,'held','held')",[c.account,c.items[1].screeningId])],
 ];
 for(let i=0;i<rejects.length;i++)await isolated(async seed=>{
  const c=await seed(54200+i,{size:3,competitors:false});await rejects[i][1](c);
  assert.equal(await v('select icash_work_private.continued_owner_batch_cohort($1,$2)',[c.account,c.screening]),null,rejects[i][0]);
  assert.equal(await v('select icash_work_private.continued_owner_preflight_deadline($1,$2)',[c.account,c.screening]),null,rejects[i][0]+' cannot consume recovery priority');
  assert.deepEqual(await v('select public.icash_owner_batch_candidates($1,$2)',[c.account,c.screening]),[],rejects[i][0]+' cannot select a partial/replacement cohort');
  const boundary=handlerBoundary(pg,c);assert.deepEqual(await boundary.run(),{status:'held'});assert.equal(boundary.calls.length,0);
  assert.equal(await v('select count(*)::integer from icash_research_private.owner_export_preflights where supersedes=$1',[c.preflight]),0);
 });
 assert.equal(await v('select icash_work_private.continued_owner_batch_cohort(null,null)'),null);
 for(const [i,label] of ['Pause','unknown sibling','late sibling ticket','renewal disabled','zero funds'].entries())await isolated(async seed=>{
  const c=await seed(54300+i,{size:3,competitors:true});await issueAndConsume(pg,c);let changed=false;
  const boundary=handlerBoundary(pg,c,{beforeRpc:async name=>{
   if(name!=='icash_claim_owner_preflight'||changed)return;changed=true;
   if(label==='Pause')await pg.query('update public.icash_accounts set bot_paused=true where id=$1',[c.account]);
   if(label==='unknown sibling')await seedContinuedHandlerOrphanCost(pg,c,c.items[1].screeningId);
   if(label==='late sibling ticket')await pg.query("insert into public.icash_automation_tickets(account_id,kind,screening_id,state,outcome) values($1,'contacts',$2,'held','held')",[c.account,c.items[1].screeningId]);
   if(label==='renewal disabled')await pg.query('update icash_research_private.owner_export_settings set preflight_renewal_enabled=false');
   if(label==='zero funds')await pg.query('update public.icash_wallets set balance_cents=0 where account_id=$1',[c.account]);
  }});
  if(label==='late sibling ticket')await assert.rejects(boundary.run(),OwnerPreviewRateLimitError);else assert.deepEqual(await boundary.run(),{status:'held'});
  assert(changed);assert.equal(boundary.calls.length,0,label+' must win the unchanged final claim');
  assert.equal(await v('select count(*)::integer from icash_research_private.owner_export_preflights where supersedes=$1',[c.preflight]),0);
 });
 await assertFinalGuards();
 await assertFinancialGuards();
 console.log('PASS actual consumed-handler complete ordered 2/3-item cohorts, WAITING/CHECKING cleanup, READY child, actual financial claims, late controls and canonical unknown operation/export preservation; all synthetic claims rolled back, no provider transport.');
 console.log('Recorded unchanged final semantics separately: orphan cost alone and a deadline crossed after consumed READY admission are accepted by the existing final claim; both block new continuation source admission.');
}finally{globalThis.fetch=priorFetch;if(priorKey===undefined)delete process.env.DEALMACHINE_API_KEY;else process.env.DEALMACHINE_API_KEY=priorKey;}
}
