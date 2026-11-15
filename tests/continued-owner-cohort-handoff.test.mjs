import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {installContinuedHandlerFixture,seedHandlerOriginal,value,read} from './helpers/continued-owner-handler-fixture.mjs';
const pg=new PGlite(),v=(sql,args=[])=>value(pg,sql,args);
const migration=read('supabase/migrations/20261115152657_continued_owner_cohort_handoff.sql');
const changed=new Set(['public.icash_owner_batch_candidates','public.icash_enrichment_before_prospecting_budget','icash_work_private.owner_enrichment_candidate_exists','icash_work_private.continued_owner_preflight_source']);
const created=new Set(['icash_work_private.continued_owner_batch_cohort','icash_work_private.continued_owner_handoff_current']);
const catalog=async()=>Object.fromEntries((await pg.query(`select n.nspname||'.'||p.proname name,
 pg_get_function_identity_arguments(p.oid) arguments,pg_get_functiondef(p.oid) definition,
 pg_get_userbyid(p.proowner) owner,p.proacl::text acl
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in('public','icash_research_private','icash_work_private') and p.prokind='f'
 order by n.nspname,p.proname,p.oid`)).rows.map(row=>[row.name+'('+row.arguments+')',row]));
const policyTables=['icash_work_private.continuation_policy','icash_work_private.preflight_step_policy','icash_research_private.expired_preflight_ticket_policy','icash_research_private.expired_checking_policy','icash_research_private.acquisition_headroom_policy'];
const historyTables=['public.icash_automation_tickets','icash_research_private.owner_export_preflights','icash_research_private.requests','public.icash_owner_enrichment_recoveries','icash_research_private.expired_preflight_ticket_continuations','icash_research_private.expired_checking_proofs','icash_research_private.owner_preflight_cleanup_admissions','icash_work_private.continuation_decisions','public.icash_operation_spend','public.icash_credit_reservations','public.icash_operating_budget','public.icash_dealmachine_request_budget'];
const rows=async tables=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await v(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`)])));
const cohort=c=>v('select icash_work_private.continued_owner_batch_cohort($1,$2)',[c.account,c.screening]);
try{
 await installContinuedHandlerFixture(pg);assert.equal(migration,read('config/continued-owner-cohort-handoff.sql'));
 const original=await seedHandlerOriginal(pg,31000,{size:3}),other=await seedHandlerOriginal(pg,31001,{size:2});
 const checking=await seedHandlerOriginal(pg,31002,{size:2,checking:true,cleanup:false});
 const beforeCatalog=await catalog(),beforePolicies=await rows(policyTables),beforeHistory=await rows(historyTables);
 await pg.exec('begin');await pg.exec(migration);
 await assert.rejects(pg.exec('select 1/0 as final_migration_ledger_failure'),/division by zero/);await pg.exec('rollback');
 assert.deepEqual(await catalog(),beforeCatalog);assert.deepEqual(await rows(policyTables),beforePolicies);assert.deepEqual(await rows(historyTables),beforeHistory);
 for(const mutation of [
  'grant execute on function public.icash_owner_batch_candidates(uuid,uuid) to public',
  'grant execute on function public.icash_owner_batch_candidates(uuid,uuid) to service_role with grant option',
  'create role fixture_cohort_unexpected;grant execute on function public.icash_enrichment_before_prospecting_budget(uuid) to fixture_cohort_unexpected',
  'alter function public.icash_owner_batch_candidates(uuid,uuid) security invoker',
  'alter function icash_work_private.owner_enrichment_candidate_exists(uuid) volatile',
  "update icash_work_private.continuation_policy set owner_wait_hashes=owner_wait_hashes-'icash_work_private.owner_enrichment_candidate_exists(uuid)'",
  "update icash_work_private.continuation_policy set continued_original_hashes=jsonb_set(continued_original_hashes,array['icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)'],'\"wrong\"')",
  "update icash_research_private.expired_checking_policy set function_hashes=function_hashes-'icash_research_private.expired_checking_original_proof(uuid)'",
  'alter table icash_research_private.expired_preflight_ticket_continuations disable trigger expired_checking_proof_capture',
  'alter table public.icash_credit_reservations disable trigger icash_owner_recovery_credit_guard',
  'delete from public.icash_operating_budget where id=1',
 ]){
  await pg.exec('begin');await pg.exec(mutation);await assert.rejects(pg.exec(migration),/Continued cohort/,mutation);await pg.exec('rollback');
  assert.deepEqual(await catalog(),beforeCatalog);assert.deepEqual(await rows(policyTables),beforePolicies);assert.deepEqual(await rows(historyTables),beforeHistory);
 }
 await pg.exec('begin;'+migration+'commit;');
 const afterCatalog=await catalog(),afterPolicies=await rows(policyTables);
 for(const [signature,previous] of Object.entries(beforeCatalog))if(!changed.has(previous.name))assert.deepEqual(afterCatalog[signature],previous,'All original claim, paid, proof and ordinary live-cohort functions stay byte-identical: '+signature);
 assert.deepEqual(Object.values(afterCatalog).filter(row=>!beforeCatalog[row.name+'('+row.arguments+')']).map(row=>row.name).sort(),[...created].sort());
 const oldPolicy=beforePolicies[policyTables[0]][0],newPolicy=afterPolicies[policyTables[0]][0];
 assert.deepEqual({...newPolicy,continued_original_hashes:oldPolicy.continued_original_hashes,owner_wait_hashes:oldPolicy.owner_wait_hashes,continued_cohort_hashes:undefined},{...oldPolicy,continued_cohort_hashes:undefined});
 for(const field of ['continued_original_hashes','owner_wait_hashes']){
  assert.deepEqual(Object.keys(newPolicy[field]).sort(),Object.keys(oldPolicy[field]).sort());
  for(const [signature,hash] of Object.entries(oldPolicy[field]))if(![...changed].some(name=>signature.startsWith(name+'(')))assert.equal(newPolicy[field][signature],hash);
 }
 assert.equal(Object.keys(newPolicy.continued_cohort_hashes).length,3);
 for(const table of policyTables.slice(1))assert.deepEqual(afterPolicies[table],beforePolicies[table]);
 assert.deepEqual(await rows(historyTables),beforeHistory);
 assert.deepEqual(await cohort(original),original.items);
 assert.deepEqual(await cohort(checking),checking.items,'Pre-cleanup CHECKING retains the exact captured refusal proof and complete source');
 // Administrative fixture corruption creates an ambiguous journal only inside
 // this rollback. Restore the real immutable guard before the proof is called.
 await pg.exec('begin;alter table icash_research_private.expired_preflight_ticket_continuations disable trigger expired_preflight_ticket_continuation_immutable');
 await pg.query('update icash_research_private.expired_preflight_ticket_continuations set account_id=$1,screening_id=$2 where ticket_id=$3',[original.account,original.screening,other.ticket]);
 await pg.exec('alter table icash_research_private.expired_preflight_ticket_continuations enable trigger expired_preflight_ticket_continuation_immutable');
 assert.equal(await cohort(original),null,'Ambiguous journals cannot select an arbitrary original');await pg.exec('rollback');
 assert.deepEqual(await rows(historyTables),beforeHistory);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_work_private.continued_owner_batch_cohort(uuid,uuid)','execute')",[role]),false);
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_work_private.continued_owner_handoff_current(uuid,uuid)','execute')",[role]),false);
 assert.equal(await v("select has_function_privilege('service_role','icash_work_private.continued_owner_handoff_current(uuid,uuid)','execute')"),true);
 console.log('PASS continued-cohort guarded migration: exact predecessor/ACL/manifests/triggers, ledger rollback, ambiguous journal rejection, unchanged activation/history/quota/financial rows and byte-identical source/claim/payment guards.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
