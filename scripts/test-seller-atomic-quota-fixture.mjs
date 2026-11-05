// Offline validation of the *same* native fixture and rejection matrix.
// PGlite does not prove native competing-session locks or deadlock freedom.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
const python = flag => execFileSync('python3', ['scripts/test-seller-atomic-quota-postgres.py', flag], {cwd: new URL('..', import.meta.url), env: {PATH: process.env.PATH}, encoding: 'utf8'});
const inputs = JSON.parse(python('--emit-cases'));
const pg = await PGlite.create();
const val = async query => Object.values((await pg.query(query)).rows[0])[0];
const snap = () => val(inputs.snapshot);
const kinds = ['seller', 'untargeted', 'refresh', 'meta', 'meta_network', 'meta_submission'];
const seed = async kind => {const id = randomUUID(); await pg.query('select fixture_seller_quota_seed($1,$2,$3)', [kind, id, randomUUID()]);return id;};
const claim = async (kind, id) => {
 const expr = kind === 'refresh' ? 'icash_claim_seller_research_refresh_admitted()' : kind === 'untargeted' ? 'icash_claim_seller_lookup_admitted()' : `${kind.startsWith('meta') ? 'icash_meta_claim_lookup_admitted' : 'icash_claim_seller_lookup_admitted_for'}('${id}')`;
 await pg.exec('set role service_role');
 try {return await val(`select ${expr}`);} finally {await pg.exec('reset role');}
};
try {
 await pg.exec(python('--emit-fixture'));
 await pg.exec(inputs.reset);
 let before = await snap();
 for(let i=0;i<10;i++) for(const kind of ['refresh', 'untargeted']) assert.equal(await claim(kind,null),null);
 assert.deepEqual(await snap(),before,'idle preserves all quota/money/receipt fields');
 for(const test of inputs.cases) {
  await pg.exec(inputs.reset); const id=await seed(test.kind); await pg.exec(test.mutation);before=await snap();
  assert.equal(await claim(test.kind,id),null,JSON.stringify(test));
  assert.deepEqual(await snap(),before,JSON.stringify(test));
 }
 for(const kind of kinds) {
  await pg.exec(inputs.reset); const id=await seed(kind);
  const result=await claim(kind,id);assert(result?.id,kind);
  assert.equal(await val('select day_used from icash_dealmachine_request_budget'),1,kind);
  assert.equal(await val('select lookup_reserved_micros from icash_seller_controls'),16000,kind);
  assert.equal(await claim(kind,id),null,kind);
 }
 for(const kind of kinds) {
  await pg.exec(inputs.reset);const id=await seed(kind);await pg.exec('update icash_dealmachine_request_budget set day_used=8820');before=await snap();
  assert.deepEqual(await claim(kind,id),{status:'rate_limited'},kind);assert.deepEqual(await snap(),before,kind);
 }
 for(const kind of kinds) {
  await pg.exec(inputs.reset);const id=await seed(kind);before=await snap();
  await pg.exec("create function fixture_fail_reservation() returns trigger language plpgsql as $$begin raise exception 'injected offline reservation failure';end$$;create trigger fixture_fail_reservation before update on icash_seller_controls for each row execute function fixture_fail_reservation();");
  try {await assert.rejects(claim(kind,id),/injected offline reservation failure/);assert.deepEqual(await snap(),before,kind);}
  finally {await pg.exec('drop trigger fixture_fail_reservation on icash_seller_controls;drop function fixture_fail_reservation()');}
 }
 await pg.exec(inputs.reset);const demo=await seed('demo');await pg.exec('update icash_dealmachine_request_budget set day_used=9800');
 await pg.exec('set role service_role');
 assert.equal((await val(`select icash_claim_owner_demo_lookup('${demo}')`))?.id,demo);
 assert.equal(await val(`select icash_claim_owner_demo_lookup('${demo}')`),null);
 await pg.exec('reset role');
 assert.equal(await val('select day_used from icash_dealmachine_request_budget'),9801);
 for(const fn of ['icash_claim_seller_lookup_admitted_for(uuid)','icash_claim_seller_lookup_admitted()','icash_claim_seller_research_refresh_admitted()','icash_meta_claim_lookup_admitted(uuid)']) {
  for(const role of ['anon','authenticated']) assert.equal(await val(`select has_function_privilege('${role}','${fn}','EXECUTE')`),false);
  assert.equal(await val(`select has_function_privilege('service_role','${fn}','EXECUTE')`),true);
 }
 for(const table of ['request_reserve_policy','request_reserve_admissions','owner_demo_request_policy','owner_demo_request_admissions'])
  for(const role of ['anon','authenticated','service_role']) assert.equal(await val(`select has_table_privilege('${role}','icash_research_private.${table}','SELECT,INSERT,UPDATE,DELETE')`),false);
 console.log(`PASS offline native-fixture validation: 13 exact predicate hashes, ${inputs.cases.length} rejection cases, 6 successful/duplicate paths, actual quota denials, postquota rollback, owner-demo one-use and private ACL. Native locks remain unverified by PGlite.`);
} finally {await pg.close();}
