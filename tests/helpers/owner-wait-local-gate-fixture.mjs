import assert from 'node:assert/strict';
import {installContinuedHandlerFixture,seedHandlerOriginal,value,read} from './continued-owner-handler-fixture.mjs';
export {seedHandlerOriginal,value,read};
export {seedOrdinary,seedLive,seedContinued,issue} from './continued-owner-scheduling-fixture.mjs';
export {recordWait,waitRow,evidence} from './owner-wait-admission-fixture.mjs';
export const signature='icash_work_private.owner_enrichment_wait_candidate(uuid)';
export const candidateSignature='icash_work_private.owner_enrichment_candidate_exists(uuid)';
export const captured=JSON.parse(read('tests/fixtures/owner-wait-local-gate-before.json'));
export const before=captured.functions.find(f=>f.signature===signature).definition;
export const after=captured.expectedAfter,afterHash=captured.afterHash;
export const migration=read('config/owner-wait-local-gate.sql');
export const migrationPath='supabase/migrations/20261117185740_owner_wait_local_gate.sql';
export const exec=(db,sql)=>db.exec?db.exec(sql):db.query(sql);
export const definition=(db,s=signature)=>value(db,'select pg_get_functiondef($1::regprocedure)',[s]);
export async function install(db){
 if(!db.exec)db.exec=sql=>db.query(sql);
 await installContinuedHandlerFixture(db);
 await db.exec('begin;'+read('config/continued-owner-cohort-handoff.sql')+'commit;');
 for(const f of captured.functions)assert.equal(await definition(db,f.signature),f.definition,'Exact captured predecessor '+f.signature);
 await db.exec('create index fixture_wait_screening_account on public.icash_screening_jobs(account_id,created_at desc)');
}
export const policies=['icash_work_private.continuation_policy','icash_work_private.preflight_step_policy','icash_research_private.expired_preflight_ticket_policy','icash_research_private.expired_checking_policy','icash_research_private.acquisition_headroom_policy'];
export const histories=['public.icash_accounts','public.icash_discovery_configs','public.icash_wallets','public.icash_automation_tickets','icash_research_private.owner_export_preflights','icash_research_private.requests','public.icash_owner_enrichment_recoveries','icash_research_private.expired_preflight_ticket_continuations','icash_research_private.expired_checking_proofs','icash_research_private.owner_preflight_cleanup_admissions','icash_work_private.continuation_decisions','public.icash_operation_spend','public.icash_credit_reservations','public.icash_operating_budget','public.icash_dealmachine_request_budget'];
export const rows=async(db,tables)=>Object.fromEntries(await Promise.all(tables.map(async table=>[table,await value(db,`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') from ${table} t`)])));
export const catalog=async db=>Object.fromEntries((await db.query(`select p.oid::regprocedure::text signature,pg_get_functiondef(p.oid) definition,
 jsonb_build_object('owner',proowner,'acl',proacl,'config',proconfig,'volatile',provolatile,'parallel',proparallel,'strict',proisstrict,'definer',prosecdef,'leakproof',proleakproof) metadata
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','icash_research_private','icash_work_private') and p.prokind='f' order by 1`)).rows.map(r=>[r.signature,r]));
export const planNodes=p=>[p,...(p.Plans??[]).flatMap(planNodes)];
export const sqlBody=source=>source.split('AS $function$')[1].split('$function$')[0].trim().replace(/;\s*$/,'').replaceAll('p_account','$1::uuid');
export function expectedPolicies(old){
 const result=structuredClone(old);
 result['icash_work_private.continuation_policy'][0].owner_wait_hashes[signature]=afterHash;
 return result;
}
