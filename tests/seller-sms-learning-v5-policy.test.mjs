import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {setupSql,migration,seedSql,queueSql,candidateSql} from './helpers/seller-sms-learning-v5-fixture.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const source=read('config/evidence-weighted-learning-policy.sql');
const purePolicy=source.slice(0,source.indexOf('-- Patching only the reviewed live implementations'))+'\ncommit;';
assert.ok(purePolicy.includes('create function public.icash_record_learning_decision('));
const pg=new PGlite();
const value=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0]??{})[0];
const choices=['identity_as_is_v5','identity_cash_v5','identity_timing_v5'];
const stats=(variant,positive=20,opted_out=0,attempts=1000)=>({variant,contributors:5,attempts,pending:0,positive,opted_out,contract_trials:0,contracts:0,closing_trials:0,closings:0,cost_cents:10000,costs_complete:true,updated_at:new Date().toISOString(),effective_attempts:attempts,effective_pending:0,effective_positive:positive,effective_opted_out:opted_out,effective_contract_trials:0,effective_contracts:0,effective_closing_trials:0,effective_closings:0,effective_cost_cents:10000});
try{
 await pg.exec(setupSql+seedSql);
 await pg.exec(`drop function icash_learning_decision_v2(jsonb,text[],boolean);drop function icash_record_learning_decision(text,text,text,jsonb,text[],boolean);
 drop schema icash_learning_policy_private cascade;create table icash_learning_assignments(id bigint primary key);`);
 await pg.exec(purePolicy);await pg.exec(migration);
 await assert.rejects(pg.exec('select icash_set_seller_sms_learning_enabled(true)'),/Verified evidence-v2 release/);
 await pg.exec("update icash_learning_policy_private.settings set enabled=true,release_sha=repeat('a',40),activated_at=now();select icash_set_seller_sms_learning_enabled(true);");
 await pg.exec(`create table fixture_sms_stats(stats jsonb);insert into fixture_sms_stats values('[]');
 create or replace function icash_shared_learning_stats(text,text,text) returns jsonb language sql stable set search_path='' as $$select stats from public.fixture_sms_stats$$;`);
 const plan=()=>value('select icash_seller_sms_learning_plan(account_id,id) from icash_text_threads');
 await pg.exec('begin');
 const p=await plan();assert.equal(p.decision.status,'explore');assert.equal(await value(candidateSql),p.body);
 await value(queueSql);
 assert.deepEqual(await value('select decision from icash_learning_policy_private.decisions'),p.decision);
 assert.equal(await value("select count(*)::int from icash_seller_opener_assignments a join icash_learning_policy_private.decisions d on d.id=a.learning_decision_id where a.learning_policy_version=d.policy_version and d.context=a.learning_context"),1);
 await pg.exec('rollback');

 // Only the shortest reviewed copy can fit this exact identity and address.
 // A singleton remains safe exploration, but a recorded opt-out hold blocks it.
 await pg.exec('begin');
 const shortest=await value("select icash_seller_identity_opener_v5('identity_cash_v5','A','123 Main St #4/2')");
 await pg.query('update icash_customer_identities set company_name=$1',['A'.repeat(161-shortest.length)]);
 const single=await plan();assert.deepEqual(single.choices,['identity_cash_v5']);assert.equal(single.decision.status,'explore');assert.equal(single.body.length,160);
 assert.ok(await value(candidateSql));
 await pg.query('update fixture_sms_stats set stats=$1',[JSON.stringify([stats('identity_cash_v5',0,3,20)])]);
 assert.equal(await plan(),null);assert.equal(await value(candidateSql),null);assert.equal(await value(queueSql),null);
 assert.equal(await value('select count(*)::int from icash_seller_opener_assignments'),0);
 await pg.exec('rollback');

 await pg.exec('begin');
 await pg.query('update fixture_sms_stats set stats=$1',[JSON.stringify(choices.map(c=>stats(c,c==='identity_cash_v5'?300:20)))]);
 const winning=await plan();assert.equal(winning.decision.status,'shared');assert.equal(winning.decision.winner,'identity_cash_v5');
 await value(queueSql);assert.deepEqual(await value('select decision from icash_learning_policy_private.decisions'),winning.decision);
 await pg.exec('rollback');
 await pg.exec('begin');
 await pg.query('update fixture_sms_stats set stats=$1',[JSON.stringify(choices.map(c=>stats(c,0,3,20)))]);
 assert.equal(await plan(),null);assert.equal(await value(queueSql),null);
 await pg.exec('rollback');
 await pg.exec('update icash_learning_policy_private.settings set enabled=false;');
 assert.equal(await plan(),null,'The global reviewed release gate also controls future v5 assignments');
 console.log('PASS actual evidence-v2/SMS integration: release gate, empty evidence exploration, exact decision binding, singleton160-character copy, unsafe singleton/all-arm holds and a measured shared winner.');
}finally{await pg.close();}
