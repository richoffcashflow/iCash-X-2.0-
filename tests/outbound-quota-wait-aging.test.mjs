import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 await pg.exec(read('tests/fixtures/export-capacity-wait-foundation.sql'));
 await pg.exec(JSON.parse(read('tests/fixtures/export-capacity-wait-before.json'))['public.icash_next_acquisition()']);
 await pg.exec(read('config/export-capacity-wait-fairness.sql'));
 await pg.exec(`create function icash_work_private.warm_seller_due(uuid) returns boolean language sql as $$select false$$;
  create function public.icash_acquisition_capacity_available(uuid) returns boolean language sql as $$select public.icash_dealmachine_capacity_available(2,$1)$$;`);
 await pg.exec(read('tests/fixtures/outbound-acquisition-current.sql'));
 const seed=n=>v("select fixture_export_wait_seed($1,true,interval '12 minutes')",[n]);
 const a=await seed(91),b=await seed(92);
 const initial=await v('select jsonb_object_agg(account_id,next_run_at::text) from icash_discovery_configs');
 await pg.exec("update fixture_export_wait_policy set export_capacity='quota_wait'");
 await pg.exec('begin');
 assert.equal(await v('select icash_next_acquisition()'),null);
 assert.equal(await v('select count(*)::int from icash_work_private.acquisition_export_waits'),0,'Reproduce quota waits dropping queue age');
 await pg.exec('rollback');
 const sql=read('config/outbound-quota-wait-aging.sql');
 assert.equal(sql,read('supabase/migrations/20261113191403_outbound_quota_wait_aging.sql'));
 const issuer=await v("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)");
 const before=await v('select jsonb_build_object(\'spend\',(select jsonb_agg(o) from icash_operation_spend o),\'reservations\',(select jsonb_agg(r) from icash_credit_reservations r),\'wallets\',(select jsonb_agg(w order by account_id) from icash_wallets w))');
 await pg.exec(sql);
 assert.equal(await v("select pg_get_functiondef('icash_next_acquisition()'::regprocedure)"),issuer,'No selector or final admission predicate is changed');
 assert.equal(await v('select icash_next_acquisition()'),null);
 assert.deepEqual(await v('select jsonb_object_agg(account_id,waiting_since::text) from icash_work_private.acquisition_export_waits'),initial);
 for(let i=0;i<5;i++){
  await pg.exec("update icash_discovery_configs set next_run_at=now()-interval '1 second'");
  assert.equal(await v('select icash_next_acquisition()'),null);
  assert.deepEqual(await v('select jsonb_object_agg(account_id,waiting_since::text) from icash_work_private.acquisition_export_waits'),initial);
 }
 const newer=await v("select fixture_export_wait_seed(93,true,interval '2 minutes')");
 await q("update fixture_export_wait_accounts set preflight_due=now()-interval '8 minutes' where account_id=$1",[newer.account]);
 await pg.exec("update fixture_export_wait_policy set export_capacity='ready';update icash_discovery_configs set next_run_at=now()-interval '1 second'");
 const served=[];
 for(let i=0;i<3;i++){const t=await v('select icash_next_acquisition()');assert(t?.token);served.push(await v('select account_id from icash_automation_tickets where token=$1',[t.token]));}
 assert.deepEqual(new Set(served.slice(0,2)),new Set([a.account,b.account]));assert.equal(served[2],newer.account);
 assert.equal(await v('select count(*)::int from icash_work_private.acquisition_export_waits'),0);
 assert.deepEqual(await v('select jsonb_build_object(\'spend\',(select jsonb_agg(o) from icash_operation_spend o),\'reservations\',(select jsonb_agg(r) from icash_credit_reservations r),\'wallets\',(select jsonb_agg(w order by account_id) from icash_wallets w))'),{...before,wallets:[...before.wallets,{account_id:newer.account,balance_cents:10000,reserved_cents:0}].sort((x,y)=>x.account_id.localeCompare(y.account_id))});
 for(const status of ['ready','disabled','unavailable']){
  await pg.exec('begin');await v('select fixture_export_wait_seed(94)');await q('update fixture_export_wait_policy set export_capacity=$1',[status]);
  assert.equal(await v('select icash_work_private.record_export_wait(account_id,next_run_at) from icash_discovery_configs where account_id=md5(\'export-wait-account-94\')::uuid'),false);await pg.exec('rollback');
 }
 console.log('PASS exact current acquisition: quota-wait aging, repeated polls, fair resumption ahead of newer preflights, unchanged money/receipts and rejection of unknown capacity. No provider calls.');
}finally{await pg.close();}
