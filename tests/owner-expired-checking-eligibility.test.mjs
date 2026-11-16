import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {baseSql,stepSql,continuationSql,checkingSql} from './helpers/owner-expired-checking-fixture.mjs';
import {eligibilitySql,eligibilitySignature,rehearseCheckingEligibility} from './helpers/owner-expired-checking-eligibility-rehearsal.mjs';
const pg=new PGlite(),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>Object.values((await q(sql,args)).rows[0]??{})[0];
try{
 await pg.exec(baseSql);await pg.exec('begin;'+stepSql+continuationSql+checkingSql+'commit;');
 // A pristine disabled installation also stays disabled; no activation is
 // replayed or created by the correction. Roll back before activated rehearsal.
 await pg.exec('begin');
 const disabled=await v("select jsonb_agg(to_jsonb(p)) from(select * from icash_research_private.expired_preflight_ticket_policy union all select * from icash_research_private.expired_checking_policy)p");
 await pg.exec(eligibilitySql);
 const installed=await v("select jsonb_agg(to_jsonb(p)) from(select * from icash_research_private.expired_preflight_ticket_policy union all select * from icash_research_private.expired_checking_policy)p");
 for(let i=0;i<disabled.length;i++)assert.deepEqual({...installed[i],function_hashes:{...installed[i].function_hashes,[eligibilitySignature]:disabled[i].function_hashes[eligibilitySignature]}},disabled[i]);
 assert.equal((await v('select public.icash_continue_expired_owner_preflight_ticket()')).status,'disabled');
 for(const sql of ["select icash_work_private.activate_preflight_step_capacity(repeat('b',40))","select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))","select icash_research_private.activate_expired_checking_continuation(repeat('b',40))"])assert.equal(await v(sql),true);
 await pg.exec('rollback');
 for(const sql of ["select icash_work_private.activate_preflight_step_capacity(repeat('b',40))","select icash_research_private.activate_expired_preflight_ticket_continuation(repeat('b',40))","select icash_research_private.activate_expired_checking_continuation(repeat('b',40))"])assert.equal(await v(sql),true);
 await v('select public.fixture_expired_checking_seed(17999)');assert.equal((await v('select public.icash_continue_expired_owner_preflight_ticket()')).status,'continued');
 const hash=await rehearseCheckingEligibility({exec:sql=>pg.exec(sql),query:q});
 const eligible=await v('select public.fixture_expired_checking_seed(17998)');
 assert.equal((await v('select public.icash_continue_expired_owner_preflight_ticket()')).ticketId,eligible.ticket);
 assert.equal(await v('select count(*)::int from public.icash_operation_spend'),0);
 console.log('PASS CHECKING eligibility order: old/new truth table, exact cap short circuit, full eligible proof, guarded rollback, unchanged source/history/activation/financials; wrapper '+hash);
}catch(error){console.error(error.stack,error.where??'');process.exitCode=1;}finally{await pg.close();}
