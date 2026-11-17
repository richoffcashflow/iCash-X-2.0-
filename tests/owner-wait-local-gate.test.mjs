import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {install,value,read,exec,definition,catalog,rows,policies,histories,expectedPolicies,signature,candidateSignature,captured,before,after,migration,migrationPath,sqlBody,seedOrdinary,seedLive,seedContinued,recordWait,waitRow,evidence} from './helpers/owner-wait-local-gate-fixture.mjs';
const db=await PGlite.create(),q=(s,a=[])=>db.query(s,a),v=(s,a=[])=>value(db,s,a);
const isolated=async fn=>{await db.exec('begin');try{return await fn();}finally{await db.exec('rollback');}};
try{
 assert.equal(migration,read(migrationPath));await install(db);
 const c=await seedOrdinary(db,66100),live=await seedLive(db,66101),continued=await seedContinued(db,66102);
 const sources=await catalog(db),oldPolicies=await rows(db,policies),oldHistory=await rows(db,histories);
 for(const change of [
  `grant execute on function ${signature} to authenticated`,
  `alter function ${signature} volatile`,
  `alter function ${signature} security definer`,
  `alter function ${signature} set search_path=public`,
  captured.functions.find(f=>f.signature===candidateSignature).definition.replace('with source_candidates as materialized (','with source_candidates as materialized ( -- drift\n'),
  `update icash_work_private.continuation_policy set owner_wait_hashes=owner_wait_hashes-'${signature}'`,
  `update icash_work_private.continuation_policy set owner_wait_hashes=owner_wait_hashes||'{"unexpected":"value"}'`,
  `update icash_work_private.continuation_policy set owner_wait_hashes=jsonb_set(owner_wait_hashes,array['${candidateSignature}'],'"wrong"')`,
 ]){
  await db.exec('begin');await db.exec(change);await assert.rejects(db.exec(migration),/Owner wait local gate/);await db.exec('rollback');
  assert.deepEqual(await catalog(db),sources);assert.deepEqual(await rows(db,policies),oldPolicies);
 }
 await db.exec('begin;'+migration);await assert.rejects(db.exec('select 1/0'),/division by zero/);await db.exec('rollback');
 assert.deepEqual(await catalog(db),sources);assert.deepEqual(await rows(db,histories),oldHistory);
 // A trigger that silently edits an unrelated policy field must abort the
 // entire migration, including the function replacement and manifest slot.
 await isolated(async()=>{
  await db.exec("create function public.fixture_policy_drift() returns trigger language plpgsql as $$begin new.issued:=new.issued+1;return new;end$$;create trigger fixture_policy_drift before update on icash_work_private.continuation_policy for each row execute function public.fixture_policy_drift()");
  await assert.rejects(db.exec(migration),/unrelated policy fields/);
 });
 await db.exec('begin;'+migration+'commit;');assert.equal(await definition(db),after);
 const nextSources=await catalog(db);
 for(const [s,old] of Object.entries(sources))assert.deepEqual(nextSources[s],s===signature?{...old,definition:after}:old,'Only target function definition may change: '+s);
 assert.deepEqual(await rows(db,policies),expectedPolicies(oldPolicies));assert.deepEqual(await rows(db,histories),oldHistory);
 // Keep the real current candidate and every original source/financial guard.
 // Only the unrelated outreach-status boundary varies across boolean/NULL cases.
 await db.exec('create table public.fixture_local_wait(value boolean);insert into public.fixture_local_wait values(false);create or replace function public.icash_research_waiting_on_outreach(uuid) returns boolean language sql stable set search_path=\'\' as $$select value from public.fixture_local_wait$$');
 for(const target of [c,live,continued])assert.equal(await v(sqlBody(before),[target.account]),true,'Ordinary, live and continued sources start eligible');
 let comparisons=0;
 const mutations=[
  ['current',()=>Promise.resolve()],
  ['financial missing',()=>q("update public.icash_screening_jobs set result='{}' where account_id=$1",[c.account])],
  ['financial null',()=>q("update public.icash_screening_jobs set result='{\"financialCheck\":{\"status\":null}}' where account_id=$1",[c.account])],
  ['stale',()=>q("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where account_id=$1",[c.account])],
  ['missing time',()=>q('update public.icash_screening_jobs set completed_at=null where account_id=$1',[c.account])],
  ['land',()=>q("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyType}','\"land\"') where account_id=$1",[c.account])],
  ['missing type',()=>q("update public.icash_screening_jobs set snapshot=snapshot-'propertyType' where account_id=$1",[c.account])],
  ['seller request',()=>q("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{sellerRequest}','{}') where account_id=$1",[c.account])],
  ['disallowed state',()=>q("update public.icash_screening_jobs set snapshot=jsonb_set(snapshot,'{raw,data,state}','\"ZZ\"') where account_id=$1",[c.account])],
  ['queued',()=>q("update public.icash_screening_jobs set state='queued' where account_id=$1",[c.account])],
  ['manual',()=>q("insert into public.icash_property_controls(account_id,property_id,manual) select account_id,snapshot->>'propertyId',true from public.icash_screening_jobs where account_id=$1",[c.account])],
  ['missing rate',()=>q('update public.icash_discovery_configs set contact_rate_id=null where account_id=$1',[c.account])],
  ['unaffordable',()=>q('update public.icash_wallets set reserved_cents=balance_cents where account_id=$1',[c.account])],
 ];
 for(const [name,state,outcome,attempts,deferrals] of [
  ['completed ticket','complete','contacts_saved',1,0],
  ['expired retry','held','expired',1,0],
  ['exhausted retry','held','expired',3,0],
  ['unproven rate limit','held','owner_preview_rate_limited',1,0],
  ['rate limited source','held','owner_preview_rate_limited',1,1],
  ['unknown outcome','held',null,1,0],
 ])mutations.push([name,()=>q(`insert into public.icash_automation_tickets(account_id,screening_id,kind,state,outcome,issue_attempts,owner_preview_deferrals)
  select account_id,id,'contacts',$2,$3,$4,$5 from public.icash_screening_jobs where account_id=$1`,[c.account,state,outcome,attempts,deferrals])]);
 for(const mode of ['force_generic_plan','force_custom_plan']){
  await db.exec(`set plan_cache_mode=${mode};prepare old_wait(uuid) as ${sqlBody(before)};prepare new_wait(uuid) as ${sqlBody(after)}`);
  for(const [label,mutate] of mutations)await isolated(async()=>{
   await mutate();
   for(const waiting of ['true','false','null']){
    await db.exec('update public.fixture_local_wait set value='+waiting);
    for(const account of [c.account,live.account,continued.account,'00000000-0000-0000-0000-000000000000',null]){
     const arg=account===null?'null':`'${account}'`;
     assert.equal(await v(`execute new_wait(${arg})`),await v(`execute old_wait(${arg})`),`${mode}:${label}:${waiting}`);comparisons++;
    }
   }
  });
  await db.exec('deallocate old_wait;deallocate new_wait');
 }
 // SQL NULL behavior is independent of source eligibility. Keep a real hint
 // match, then vary the three original boolean inputs through all 27 cases.
 await isolated(async()=>{
  await db.exec(`create table public.fixture_wait_inputs(candidate boolean,affordable boolean,waiting boolean);insert into public.fixture_wait_inputs values(true,true,false);
   create or replace function icash_work_private.owner_enrichment_candidate_exists(p_account uuid) returns boolean language sql stable set search_path='' as $$select candidate from public.fixture_wait_inputs$$;
   create or replace function public.icash_prospecting_available(p_account uuid) returns bigint language sql stable set search_path='' as $$select case when affordable then 1000000 when not affordable then -1 end::bigint from public.fixture_wait_inputs$$;
   create or replace function public.icash_research_waiting_on_outreach(uuid) returns boolean language sql stable set search_path='' as $$select waiting from public.fixture_wait_inputs$$;`);
  for(const candidate of ['true','false','null'])for(const affordable of ['true','false','null'])for(const waiting of ['true','false','null']){
   await db.exec(`update public.fixture_wait_inputs set candidate=${candidate},affordable=${affordable},waiting=${waiting}`);
   assert.equal(await v(sqlBody(after),[c.account]),await v(sqlBody(before),[c.account]));comparisons++;
  }
 });
 await isolated(async()=>{
  await db.exec("create or replace function public.icash_research_waiting_on_outreach(uuid) returns boolean language plpgsql stable set search_path='' as $$begin raise exception 'global outreach sentinel';end$$");
  await q("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where account_id=$1",[c.account]);
  await assert.rejects(q(sqlBody(before),[c.account]),/global outreach sentinel/);
 });
 await isolated(async()=>{
  await db.exec("create or replace function public.icash_research_waiting_on_outreach(uuid) returns boolean language plpgsql stable set search_path='' as $$begin raise exception 'global outreach sentinel';end$$");
  await q("update public.icash_screening_jobs set completed_at=now()-interval '25 hours' where account_id=$1",[c.account]);
  assert.equal(await v(sqlBody(after),[c.account]),false);
 });
 await isolated(async()=>{
  await db.exec("create or replace function public.icash_research_waiting_on_outreach(uuid) returns boolean language plpgsql stable set search_path='' as $$begin raise exception 'global outreach sentinel';end$$");
  await assert.rejects(q(sqlBody(after),[c.account]),/global outreach sentinel/);
 });
 await isolated(async()=>{
  await db.exec('update public.fixture_local_wait set value=false');
  await q("insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)");
  const money=await evidence(db);assert.equal(await recordWait(db,c),true);const first=await waitRow(db,c);assert(first);
  await q("update public.icash_discovery_configs set next_run_at=now()-interval '1 second' where account_id=$1",[c.account]);
  assert.equal(await recordWait(db,c),true);assert.equal((await waitRow(db,c)).waiting_since,first.waiting_since);assert.deepEqual(await evidence(db),money);
 });
 await db.exec('begin');await assert.rejects(db.exec(migration),/Owner wait local gate/);await db.exec('rollback');
 console.log(JSON.stringify({result:'PASS owner wait local gate',comparisons,afterHash:captured.afterHash,unchangedFinalAdmission:true}));
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
