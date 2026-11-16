import assert from 'node:assert/strict';
import {installBudgetYieldFixture,migration as budgetMigration,value,read} from './acquisition-budget-yield-fixture.mjs';
export {seedOrdinary,seedContinued,seedRecovery,lane,value,read,definition,policies,catalog,snapshot,
 assertOnlySchedulerHashesChanged} from './acquisition-budget-yield-fixture.mjs';
export const migration=read('config/acquisition-account-yield.sql');
export const migrationPath='supabase/migrations/20261116031138_acquisition_account_yield.sql';
export const predecessorHash='15426cf63cce56d98db8f14e66fb0675';
export const beforeSelection='d.next_run_at,d.account_id limit 5 for update of d skip locked loop';
export const afterSelection='d.next_run_at,d.account_id limit 5 for update of d,a skip locked loop';
export async function installAccountYieldFixture(db){
 const exec=sql=>db.exec?db.exec(sql):db.query(sql);
 await installBudgetYieldFixture(db);
 await exec('begin;'+budgetMigration+'commit;');
 assert.equal(await value(db,"select md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))"),predecessorHash);
 // The unchanged preparation's relevant account-lock boundary is projected
 // here; all selection, ticket issuance and fairness code is actual SQL.
 // Source assertion binds it to the real continuation/prepare definitions.
 const prepare=read('config/research-request-efficiency.sql');
 const continuation=read('config/independent-query-stall-recovery.sql');
 const lock='perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;';
 assert(prepare.includes(lock)&&continuation.includes(lock));
 await exec(`create or replace function public.icash_prepare_research_efficiency(p_account uuid) returns void language plpgsql set search_path='' as $$
 begin ${lock} end$$;`);
}
