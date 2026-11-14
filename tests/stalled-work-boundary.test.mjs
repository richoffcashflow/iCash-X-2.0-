import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create(),q=(s,a=[])=>pg.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const definitions=JSON.parse(read('tests/fixtures/stalled-work-production-20261114.json'));
try{
 await pg.exec(read('tests/fixtures/account-work-repair.sql'));
 await pg.exec(read('tests/fixtures/stalled-work-boundary.sql'));
 await pg.exec(definitions.observations);
 await pg.exec('revoke all on function icash_account_work_observations() from public,anon,authenticated;grant execute on function icash_account_work_observations() to service_role;');
 const before=await v('select fixture_work_evidence()');
 assert.equal(await v('select count(*) from icash_account_work_observations()'),0,'Reproduce nine unsettled originals falling through the real production function');
 assert.equal(read('config/stalled-work-boundary.sql'),read('supabase/migrations/20261114150000_stalled_work_boundary.sql'));
 await pg.exec(read('config/stalled-work-boundary.sql'));
 await pg.exec(read('tests/fixtures/stalled-work-boundary-assertions.sql'));
 assert.deepEqual(await v('select fixture_work_evidence()'),before,'Detection cannot mutate operations, money, receipts or controls');
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_function_privilege($1,'icash_account_work_observations()','execute')",[role]),role==='service_role');
 await pg.exec('set role service_role');assert.equal(await v('select reason from icash_account_work_observations()'),'pending_work');await pg.exec('reset role');
 await assert.rejects(pg.exec(read('config/stalled-work-boundary.sql')),/prerequisite changed/);await pg.exec('rollback');
 console.log('PASS exact production false-healthy boundary: nine original holds, quote/time neighbors, recent work, Pause/membership/cancel/configuration, grace, role permissions and unchanged financial evidence.');
}finally{await pg.close();}
