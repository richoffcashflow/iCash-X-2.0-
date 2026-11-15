import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {stepSetup,migration,read} from './helpers/owner-preflight-step-fixture.mjs';
assert.equal(migration,read('supabase/migrations/20261115000614_owner_preflight_step_capacity.sql'));
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const seed=(n,waiting=true)=>v('select fixture_preflight_seed($1,$2)',[n,waiting]);
const due=c=>v('select icash_owner_preflight_due_at($1,$2)',[c.account,c.screening]);
const capacity=c=>v('select icash_owner_preflight_step_capacity($1,$2)',[c.account,c.screening]);
const claim=c=>v('select icash_claim_owner_preflight($1,(select items from icash_research_private.owner_export_preflights where id=$2),(select request from icash_research_private.owner_export_preflights where id=$2))',[c.account,c.preflight]);
const issue=()=>v('select icash_next_acquisition()');
async function isolated(test){await pg.exec('begin');try{await test();}finally{await pg.exec('rollback');}}
try{
 await pg.exec(stepSetup());
 const c=await seed(901),ordinary=await seed(902,false);
 await pg.exec('update fixture_cleanup_policy set ordinary=2');
 assert.equal(await due(c),null,'Reproduce two available ordinary requests rejected by three-token gate');
 assert.equal((await claim(c)).status,'pending');assert.equal(await issue(),null);
 await pg.exec('begin;'+migration+'commit;');
 assert.equal(await capacity(c),false);assert.equal(await due(c),null,'Disabled install preserves original selection');
 assert.equal((await claim(c)).status,'pending');assert.equal(await issue(),null);
 await isolated(async()=>{
  await pg.exec(`create or replace function icash_research_private.owner_preflight_cohort(p_account uuid,p_primary uuid) returns jsonb language plpgsql stable set search_path='' as $$begin raise exception 'DISABLED_SOURCE_READ';end$$;
   create or replace function icash_research_private.owner_preflight_list_known(p_id uuid,p_complete boolean default false) returns boolean language plpgsql stable set search_path='' as $$begin raise exception 'DISABLED_LIST_READ';end$$;`);
  assert.equal(await v('select icash_work_private.owner_preflight_two_step_current($1)',[c.preflight]),false,'Disabled policy stops before source/cohort reads even with two tokens');
  assert.equal(await capacity(c),false,'The deployed read RPC also avoids disabled source work at two tokens');
 });
 assert.equal(await v("select icash_work_private.activate_preflight_step_capacity('invalid')"),false);
 await isolated(async()=>{
  await pg.exec("update icash_work_private.preflight_step_policy set function_hashes='{}'");
  assert.equal(await v("select icash_work_private.activate_preflight_step_capacity(repeat('b',40))"),false,'An incomplete manifest never activates');
 });
 await isolated(async()=>{
  await pg.exec('create or replace function public.icash_dealmachine_capacity_available(p_requests integer default 2) returns boolean language sql stable set search_path=\'\' as $$select true$$');
  assert.equal(await v("select icash_work_private.activate_preflight_step_capacity(repeat('b',40))"),false,'Changed ordinary capacity cannot activate');
 });
 assert.equal(await v("select icash_work_private.activate_preflight_step_capacity(repeat('b',40))"),true);
 assert.equal(await v("select icash_work_private.activate_preflight_step_capacity(repeat('b',40))"),false);
 assert.equal(await capacity(c),true);assert(await due(c));
 await isolated(async()=>{
  await pg.exec(`create or replace function icash_research_private.owner_preflight_cohort(p_account uuid,p_primary uuid) returns jsonb language plpgsql stable set search_path='' as $$begin raise exception 'ENABLED_SOURCE_READ';end$$;`);
  await assert.rejects(capacity(c),/ENABLED_SOURCE_READ/,'Enabled policy still performs the original source checks');
 });
 assert.equal(await v('select icash_enrichment_candidate($1)',[c.account]),c.screening);
 assert.equal(await v('select icash_enrichment_candidate($1)',[ordinary.account]),null,'New owner work still requires three requests');
 const before=await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
 await isolated(async()=>{
  const ticket=await issue();assert(ticket);assert.equal(await v('select id from icash_automation_tickets where token=$1',[ticket.token]),c.ticket);
  assert.equal((await claim(c)).status,'check');
  const after=await v('select to_jsonb(p) from icash_research_private.owner_export_preflights p where id=$1',[c.preflight]);
  for(const field of ['id','created_at','receipts','fingerprint','items','request','deleted_at'])assert.deepEqual(after[field],before[field]);
  assert.equal(await v('select count(*) from icash_research_private.requests'),0,'Selection/claim do not spend requests');
  assert.equal(await v('select count(*) from icash_operation_spend'),0);
 });
 for(const mutation of [
  'update fixture_cleanup_policy set ordinary=1',
  'update fixture_cleanup_policy set quota=false',
  'update fixture_cleanup_policy set member=false',
  'update icash_discovery_configs set contacts_enabled=false',
  'update icash_accounts set bot_paused=true',
  'update icash_wallets set reserved_cents=balance_cents',
  "update icash_research_private.owner_export_preflights set indexing_next_step='metadata'",
  "update icash_research_private.owner_export_preflights set indexing_next_step='baseline',indexing_checks=6",
  'update icash_research_private.owner_export_preflights set cleanup_attempts=1',
  "update icash_research_private.owner_export_preflights set next_check_at=now()+interval '1 minute'",
  "update icash_research_private.owner_export_preflights set created_at=now()-interval '30 minutes'",
  "update icash_research_private.owner_export_preflights set receipts=jsonb_set(receipts,'{create,httpStatus}','500')",
  "update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyId}','\"changed\"')",
  "insert into icash_research_private.owner_exports(request,terminal_at,capacity_review_id) values('{}',null,null)",
 ])await isolated(async()=>{
  await pg.exec('alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;'+mutation);
  assert.equal(await capacity(c),false,mutation);assert.equal(await issue(),null,mutation);
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set ordinary=1,starter=3');
  assert.equal(await v('select icash_dealmachine_capacity_available(2)'),false);
  assert.equal(await v('select icash_dealmachine_capacity_available(2,$1)',[c.account]),true);
  assert.equal(await capacity(c),false,'Protected starter capacity does not qualify this exception');
 });
 await isolated(async()=>{
  await pg.exec('update fixture_cleanup_policy set ordinary=3');
  assert.equal(await v('select icash_enrichment_candidate($1)',[ordinary.account]),ordinary.fresh,'Ordinary work remains reachable at its original capacity');
 });
 await isolated(async()=>{
  await pg.exec('update icash_work_private.continuation_policy set issued=2');
  assert.equal(await issue(),null,'The ordinary turn retains two tokens to accrue its third');
  await pg.exec('update fixture_cleanup_policy set ordinary=3');
  const next=await issue();assert(next);
  assert.equal(await v('select account_id from icash_automation_tickets where token=$1',[next.token]),ordinary.account,'New work gets the ordinary turn once its unchanged capacity accrues');
 });
 await isolated(async()=>{
  await pg.exec('update icash_work_private.preflight_step_policy set enabled=false');
  assert.equal(await capacity(c),false);assert.equal(await due(c),null);assert.equal(await issue(),null);
 });
 for(const enabled of [false,true])await isolated(async()=>{
  await q('update icash_work_private.preflight_step_policy set enabled=$1',[enabled]);
  await pg.exec(`update fixture_cleanup_policy set ordinary=0;
   create or replace function public.icash_enrichment_before_provider_quota(p_account uuid) returns uuid language plpgsql stable set search_path='' as $$begin raise exception 'EXPENSIVE_CANDIDATE_READ';end$$;`);
  assert.equal(await v('select icash_enrichment_candidate($1)',[c.account]),null,'No-quota runs stop before expensive candidate evaluation');
 });
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'public.icash_owner_preflight_step_capacity(uuid,uuid)','execute')",[role]),false);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_work_private.activate_preflight_step_capacity(text)','execute')",[role]),false);
 await pg.exec('set role service_role');assert(await issue());await pg.exec('reset role');
 console.log('PASS source-bound two-request phase: reproduced three-token stall, original ticket/receipts/TTL, fresh-work threshold, ordinary quota, final claim, late controls, disabled activation, rollback and service-role grants.');
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await pg.close();}
