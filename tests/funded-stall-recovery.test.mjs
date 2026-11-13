import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite();
const val=async(s,a=[])=>Object.values((await db.query(s,a)).rows[0]??{})[0];
const account='10000000-0000-4000-8000-000000000001';
const before=JSON.parse(read('tests/fixtures/reviewed-pending-work-before.json'));
const migration=read('config/funded-stall-recovery-20261113.sql');
const snapshot=()=>val(`select jsonb_build_object('operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
 'wallets',(select jsonb_agg(to_jsonb(w) order by account_id) from icash_wallets w),'budget',(select to_jsonb(b) from icash_operating_budget b),
 'authorizations',(select jsonb_agg(to_jsonb(r) order by operation_key) from icash_credit_reservations r),'ledger',(select jsonb_agg(to_jsonb(l)) from icash_credit_ledger l),
 'originalPolicy',(select to_jsonb(p) from icash_reliability_private.pending_work_relief_policy p),
 'originalManifest',(select jsonb_agg(to_jsonb(r) order by operation_key) from icash_reliability_private.pending_work_relief r))`);
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/opportunity-schema.sql'));
 await db.exec('create table icash_prospecting_budgets(id bigint generated always as identity primary key,account_id uuid,baseline_cents bigint);');
 await db.exec(before.icash_prospecting_total_available);
 await db.exec('drop table icash_prospecting_budgets cascade;');
 await db.exec(read('tests/fixtures/reviewed-pending-work-foundation.sql'));
 for(const d of Object.values(before))await db.exec(d);
 await db.exec('create trigger fixture_final_guard before insert on icash_operation_spend for each row execute function icash_guard_prospecting_spend();');
 await db.exec(read('config/reviewed-pending-work-relief.sql'));
 const oldManifest=await val('select manifest from icash_reliability_private.pending_work_relief_policy');
 await val('select icash_reliability_private.activate_pending_work_relief($1,$2)',[oldManifest,'a'.repeat(40)]);
 assert.equal(Number(await val('select icash_prospecting_total_available($1)',[account])),900);
 const unchanged=await snapshot();
 await db.exec('begin;'+migration+'commit;');
 assert.deepEqual(await snapshot(),unchanged,'installation preserves original money and the first recovery manifest');
 assert.equal(await val('select count(*)::int from icash_reliability_private.pending_work_relief_20261113'),1,'only the still-counted reviewed operation is captured');
 assert.equal(Number(await val('select icash_prospecting_total_available($1)',[account])),900,'disabled installation gives no planning relief');
 const manifest=await val('select manifest from icash_reliability_private.pending_work_relief_policy_20261113');
 const activate=(m=manifest,sha='b'.repeat(40))=>val('select icash_reliability_private.activate_pending_work_relief_20261113($1,$2)',[m,sha]);
 await assert.rejects(activate('c'.repeat(32)),/manifest changed/);
 assert.equal((await activate()).activated,true);assert.equal((await activate()).activated,false);
 await assert.rejects(activate(manifest,'c'.repeat(40)),/another release/);
 assert.deepEqual(await snapshot(),unchanged,'activation does not settle, refund, replay or release supplier reserves');
 assert.equal(Number(await val('select icash_prospecting_total_available($1)',[account])),1000);
 await assert.rejects(db.exec('delete from icash_reliability_private.pending_work_relief_20261113'),/Immutable/);
 await assert.rejects(db.exec('truncate icash_reliability_private.pending_work_relief_20261113'),/Immutable/);
 for(const change of ["charge_cap_cents=99","reserved_micros=1","state='reserved'","account_id='10000000-0000-4000-8000-000000000002'","permission_until='2028-01-01'","credit_reservation_id=gen_random_uuid()"]){
  await db.exec('begin');await db.exec("update icash_operation_spend set "+change+" where operation_key='fresh'");
  assert.equal(Number(await val("select icash_reliability_private.pending_planning_cents(o) from icash_operation_spend o where operation_key='fresh'")),change.startsWith('charge')?99:100);
  await db.exec('rollback');
 }
 await db.exec("update icash_operation_spend set estimate_checked_at=now() where operation_key='fresh'");
 assert.equal(Number(await val('select icash_prospecting_total_available($1)',[account])),1000,'receipt polling is not a new commitment');
 for(const [id,pattern] of [['10000000-0000-4000-8000-000000000003',/Bot paused/],['10000000-0000-4000-8000-000000000004',/Insufficient credits/]])
  await assert.rejects(val('select fixture_relief_admit($1,$2,100)',[id,'blocked-'+id]),pattern);
 for(let n=0;n<5;n++)assert.equal(await val('select fixture_relief_admit($1,$2,200)',[account,'new-'+n]),true);
 await assert.rejects(val('select fixture_relief_admit($1,$2,1)',[account,'over-budget']),/Prospecting budget reached/);
 assert.equal(Number(await val('select icash_prospecting_total_available($1)',[account])),0,'new reservations count in full');
 await val("select icash_finish_credit($1,'fresh',25,'SYNTHETIC exact late receipt')",[account]);
 await db.exec("update icash_operation_spend set state='settled',charged_cents=25,actual_micros=10000,settled_at=now() where operation_key='fresh'");
 await val("select icash_finish_credit($1,'fresh',25,'SYNTHETIC exact late receipt')",[account]);
 assert.equal(Number(await val('select balance_cents from icash_wallets where account_id=$1',[account])),975);
 assert.equal(Number(await val('select count(*) from icash_credit_ledger')),1,'late original cost bills once');
 for(const role of ['anon','authenticated','service_role']){
  assert.equal(await val("select has_function_privilege($1,'icash_reliability_private.activate_pending_work_relief_20261113(text,text)','execute')",[role]),false);
  assert.equal(await val("select has_table_privilege($1,'icash_reliability_private.pending_work_relief_20261113','insert,update,delete')",[role]),false);
 }
 const name=readdirSync(new URL('../supabase/migrations/',import.meta.url)).find(n=>n.endsWith('_funded_stall_recovery_20261113.sql'));
 assert.equal(read('supabase/migrations/'+name),migration);
 console.log('PASS frozen funded-account recovery: prior manifest preserved, disabled installation, exact once-only activation, immutable evidence, new holds, Pause, zero balance, final admission and late billing.');
}finally{await db.close();}
