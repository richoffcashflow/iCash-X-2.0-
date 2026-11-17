import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setup,baseline,cases,atomicMigration} from './helpers/seller-atomic-memory-fixture.mjs';
globalThis.fetch=async()=>{throw Error('NO NETWORK: fictional seller admission fixture only');};
const pg=await PGlite.create();try{
 await setup(pg);await baseline(pg);
 const migration=atomicMigration();assert(!/^\s*(?:begin|commit);/im.test(migration));
 for(const change of ["grant execute on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) to anon", "create role fixture_changed_owner;alter function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) owner to fixture_changed_owner", "create or replace function public.icash_signing_action_allowed(p_account uuid,p_envelope uuid) returns boolean language sql stable set search_path='' as $$select true$$"]){
  await pg.exec('begin;'+change+';');await assert.rejects(pg.exec(migration),/prerequisite|predecessor|changed/i);await pg.exec('rollback;');
  assert.equal((await pg.query("select to_regnamespace('icash_seller_agreement_memory_private') value")).rows[0].value,null);
 }
 await pg.exec('begin;'+migration+'create table fixture_migration_ledger(id integer);insert into fixture_migration_ledger values(1);');
 await assert.rejects(pg.exec('select 1/0'));await pg.exec('rollback');
 assert.equal((await pg.query("select to_regnamespace('icash_seller_agreement_memory_private') value")).rows[0].value,null,'caller rollback removes admission schema and fake ledger together');
 assert.equal((await pg.query("select to_regclass('fixture_migration_ledger') value")).rows[0].value,null);
 await pg.exec('begin;'+migration+'commit;');await cases(pg);
}finally{await pg.close();}
console.log('PASS actual seller source admission, old/new callers, original document preservation, final text guard and text-only admission. Financial/provider sentinels only.');
