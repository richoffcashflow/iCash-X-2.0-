import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {receiptProgressSetup} from './helpers/receipt-progress-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const pg=await PGlite.create();
const value=async sql=>Object.values((await pg.query(sql)).rows[0]??{})[0];
try{
 await pg.exec(receiptProgressSetup());
 const publicBefore=await value("select pg_get_functiondef('public.icash_account_work_observations()'::regprocedure)");
 const financialBefore=await value('select fixture_progress_evidence()');
 const sql=read('config/account-work-receipts-v2.sql');
 await pg.exec(sql);
 assert.equal(await value("select pg_get_functiondef('public.icash_account_work_observations()'::regprocedure)"),publicBefore);
 await pg.exec(read('tests/fixtures/receipt-progress-v2-assertions.sql'));
 assert.deepEqual(await value('select fixture_progress_evidence()'),financialBefore);
 for(const signature of ['owner_work_output_v2(uuid,uuid,timestamptz)','account_work_receipts_v2(uuid,timestamptz)','account_work_observations_v2()']){
  for(const role of ['anon','authenticated','service_role']) assert.equal(await value(`select has_function_privilege('${role}','icash_reliability_private.${signature}','execute')`),role==='service_role');
 }
 await pg.exec('set role service_role');
 assert.equal(await value('select reason from icash_reliability_private.account_work_observations_v2()'),'pending_work');
 await pg.exec('reset role');
 // Roll back a full install rehearsal, without any live/public activation.
 await pg.exec('drop function icash_reliability_private.account_work_observations_v2();drop function icash_reliability_private.account_work_receipts_v2(uuid,timestamptz);drop function icash_reliability_private.owner_work_output_v2(uuid,uuid,timestamptz);');
 await pg.exec(sql.replace(/commit;\s*$/,'rollback;'));
 assert.equal(await value("select to_regprocedure('icash_reliability_private.account_work_observations_v2()')"),null);
 assert.equal(await value("select pg_get_functiondef('public.icash_account_work_observations()'::regprocedure)"),publicBefore);
 await pg.exec("alter function public.icash_account_work_observations() set statement_timeout='4s'");
 await assert.rejects(pg.exec(sql),/source prerequisite changed/);await pg.exec('rollback');
 assert.equal(await value("select to_regprocedure('icash_reliability_private.account_work_receipts_v2(uuid,timestamptz)')"),null);
 console.log('PASS inactive receipt-progress v2: real production billing-only false-progress reproduction, source-bound research/enrichment, original dial/dispatch timing, separate attempts/outputs, canonical export mismatch, 30-minute neighbors, controls, ACLs, immutable evidence and install rollback. Public observer and frozen schema2 remain unchanged.');
}catch(error){console.error(error.message,error.where??'');process.exitCode=1;}finally{await pg.close();}
