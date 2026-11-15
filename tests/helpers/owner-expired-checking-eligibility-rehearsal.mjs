import assert from 'node:assert/strict';
import {read} from './owner-expired-checking-fixture.mjs';
export const eligibilitySql=read('supabase/migrations/20261115150210_owner_expired_checking_eligibility.sql');
export const eligibilitySignature='icash_research_private.expired_preflight_ticket_current(uuid,uuid)';

// Shared by PGlite and native PostgreSQL: actual predecessor functions and
// synthetic source rows only. Installs the exact reviewed migration last.
export async function rehearseCheckingEligibility({exec,query}){
 const v=async(sql,args=[])=>Object.values((await query(sql,args)).rows[0]??{})[0];
 const definition=()=>v('select pg_get_functiondef($1::regprocedure)',[eligibilitySignature]);
 const policies=()=>v("select jsonb_build_object('base',to_jsonb(b),'checking',to_jsonb(c),'step',to_jsonb(s)) from icash_research_private.expired_preflight_ticket_policy b,icash_research_private.expired_checking_policy c,icash_work_private.preflight_step_policy s");
 const history=()=>v(`select jsonb_build_object(
  'tickets',(select jsonb_agg(to_jsonb(t) order by id) from public.icash_automation_tickets t),
  'preflights',(select jsonb_agg(to_jsonb(p) order by id) from icash_research_private.owner_export_preflights p),
  'requests',(select jsonb_agg(to_jsonb(r) order by id) from icash_research_private.requests r),
  'recoveries',(select jsonb_agg(to_jsonb(r) order by ticket_id) from public.icash_owner_enrichment_recoveries r),
  'journals',(select jsonb_agg(to_jsonb(j) order by ticket_id) from icash_research_private.expired_preflight_ticket_continuations j),
  'proofs',(select jsonb_agg(to_jsonb(p) order by ticket_id) from icash_research_private.expired_checking_proofs p),
  'spend',(select jsonb_agg(to_jsonb(s)) from public.icash_operation_spend s),
  'credits',(select jsonb_agg(to_jsonb(c)) from public.icash_credit_reservations c),
  'budget',(select to_jsonb(b) from public.icash_operating_budget b where id=1),
  'quota',(select to_jsonb(b) from public.icash_dealmachine_request_budget b where id=1))`);
 const current=c=>v('select icash_research_private.expired_preflight_ticket_current($1,$2)',[c.ticket,c.preflight]);
 const beforeDefinition=await definition(),beforePolicies=await policies(),beforeHistory=await history();
 const proofDefinition=await v("select pg_get_functiondef('icash_research_private.expired_checking_original_proof(uuid)'::regprocedure)");
 assert.equal(eligibilitySql,read('config/owner-expired-checking-eligibility.sql'));
 assert.equal(await v('select md5($1)',[beforeDefinition]),'0f0026b490932675588ecb802740b142');
 await exec('begin');await exec(eligibilitySql);
 await assert.rejects(exec('select 1/0 as final_migration_ledger_failure'),/division by zero/);await exec('rollback');
 assert.equal(await definition(),beforeDefinition);assert.deepEqual(await policies(),beforePolicies);assert.deepEqual(await history(),beforeHistory);
 for(const mutation of [
  "update icash_research_private.expired_preflight_ticket_policy set function_hashes=function_hashes-'public.icash_membership_work_allowed(uuid)'",
  "update icash_research_private.expired_checking_policy set function_hashes=jsonb_set(function_hashes,array['icash_research_private.expired_checking_original_proof(uuid)'],'\"wrong\"')",
  "alter table icash_research_private.expired_preflight_ticket_continuations disable trigger expired_checking_proof_capture",
  'grant execute on function '+eligibilitySignature+' to service_role',
  'create role fixture_unexpected_checker;grant execute on function '+eligibilitySignature+' to fixture_unexpected_checker',
  'alter function '+eligibilitySignature+' volatile',
  'delete from public.icash_operating_budget where id=1',
 ]){
  await exec('begin');await exec(mutation);await assert.rejects(exec(eligibilitySql),/Expired-checking eligibility/,mutation);await exec('rollback');
  assert.equal(await definition(),beforeDefinition);assert.deepEqual(await policies(),beforePolicies);
 }
 await exec('begin');
 try{
  const cases=[];
  const add=async(label,expected,mutate=async()=>{},waiting=false)=>{
   const c=await v(`select public.${waiting?'fixture_expired_ticket_seed':'fixture_expired_checking_seed'}($1)`,[17000+cases.length]);
   await mutate(c);cases.push({label,expected,c});return c;
  };
  const valid=await add('eligible checking',true);
  await add('eligible waiting delegation',true,undefined,true);
  for(const [label,quote,expected] of [['null original quote',null,true],['equal original quote',105,true],['higher original quote',106,true],['lower original quote',104,false],['zero original quote',0,false],['negative original quote',-1,false]])
   await add(label,expected,c=>query('update public.icash_automation_tickets set prospecting_quote_cents=$2 where id=$1',[c.ticket,quote]));
  const cap=await add('restrictive original cap',false,c=>query('update public.icash_automation_tickets set prospecting_quote_cents=1 where id=$1',[c.ticket]));
  await add('missing current config',false,c=>query('delete from public.icash_discovery_configs where account_id=$1',[c.account]));
  await add('missing current rate',false,c=>query('update public.icash_discovery_configs set contact_rate_id=gen_random_uuid() where account_id=$1',[c.account]));
  await add('unknown extra eligible request',false,c=>query("insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result) values(gen_random_uuid(),'owner_preview',$1,$2,null,null)",[c.account,'owner-preflight:'+c.preflight+':eligible']));
  await add('paused account',false,c=>query('update public.icash_accounts set bot_paused=true where id=$1',[c.account]));
  await add('original retry deadline expired',false,c=>query('update public.icash_automation_tickets set owner_preview_retry_until=now() where id=$1',[c.ticket]));
  await add('original source hash changed',false,c=>query("update public.icash_automation_tickets set owner_preview_screening_hash=repeat('c',64) where id=$1",[c.ticket]));
  await add('ticket absent',false,c=>query('delete from public.icash_automation_tickets where id=$1',[c.ticket]));
  const old=[];for(const item of cases){const result=await current(item.c);assert.equal(result,item.expected,item.label+' predecessor');old.push(result);}
  const originalRows=await history();await exec(eligibilitySql);
  for(let i=0;i<cases.length;i++)assert.equal(await current(cases[i].c),old[i],cases[i].label+' equivalent');
  assert.deepEqual(await history(),originalRows,'Eligibility calls and installation never mutate source, financial or provider evidence');
  // Make the expensive proof raise in this rolled-back fixture. An over-cap
  // source must short-circuit, while an eligible source must still require it.
  await exec("create or replace function icash_research_private.expired_checking_original_proof(p_id uuid) returns jsonb language plpgsql stable set search_path='' as $$begin raise exception 'fixture required original proof';end$$");
  assert.equal(await current(cap),false,'Rejected cap does not reconstruct proof');
  assert.equal(await current(cases[1].c),true,'Waiting delegation does not call CHECKING proof');
  await assert.rejects(current(valid),/fixture required original proof/,'Eligible checking source still requires the full proof');
 }finally{await exec('rollback');}
 assert.equal(await definition(),beforeDefinition);assert.deepEqual(await policies(),beforePolicies);assert.deepEqual(await history(),beforeHistory);
 await exec('begin');await exec(eligibilitySql);await exec('commit');
 const afterPolicies=await policies(),hash=await v('select md5($1)',[await definition()]);
 for(const name of ['base','checking']){
  assert.equal(afterPolicies[name].function_hashes[eligibilitySignature],hash);
  assert.deepEqual({...afterPolicies[name],function_hashes:{...afterPolicies[name].function_hashes,[eligibilitySignature]:beforePolicies[name].function_hashes[eligibilitySignature]}},beforePolicies[name],'Only the wrapper manifest entry changes; enabled/release/activation metadata remains exact');
 }
 assert.deepEqual(afterPolicies.step,beforePolicies.step);assert.deepEqual(await history(),beforeHistory);
 assert.equal(await v("select pg_get_functiondef('icash_research_private.expired_checking_original_proof(uuid)'::regprocedure)"),proofDefinition);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,$2,'execute')",[role,eligibilitySignature]),false);
 return hash;
}
