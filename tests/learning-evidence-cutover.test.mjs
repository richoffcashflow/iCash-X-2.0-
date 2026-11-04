import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/learning-evidence-refresh-cutover.sql');
assert.equal(sql,read('supabase/migrations/20261104060153_learning_evidence_refresh_cutover.sql'));
const db=new PGlite();
const value=async q=>Object.values((await db.query(q)).rows[0])[0];
try{
 await db.exec(read('tests/fixtures/learning-evidence-cutover.sql'));
 const finish=read('supabase/migrations/20261027035912_outcome_ranker.sql').match(/create function public\.icash_finish_ranker_training[\s\S]*?end \$\$;/)[0];
 await db.exec(finish);
 const before=await value("select jsonb_build_object('original',(select to_jsonb(e) from original_provider_evidence e),'lastTrained',(select last_trained_at from icash_ranker_private.settings),'lastRefresh',(select last_refreshed_at from icash_learning_queue))");
 await db.exec(sql);
 assert.equal(await value("select refreshed_at='-infinity' and interest=1 and features='[0,1]' from icash_ranker_private.samples"),true);
 assert.equal(await value("select updated_at='-infinity' and positive=1 from icash_learning_rollups"),true);
 assert.equal(await value('select generation=43 and due_at<=now() from icash_learning_queue'),true);
 assert.equal(await value("select evidence_after>now()-interval '1 minute' and not enabled from icash_learning_policy_private.settings"),true);
 assert.equal(await value("select public.icash_finish_ranker_training('00000000-0000-4000-8000-000000000001','{\"status\":\"collecting\",\"model\":null}',10)"),false,'An original pre-cutover training response cannot publish');
 assert.equal(await value('select count(*)::int from icash_ranker_private.runs'),0);
 assert.deepEqual(await value("select jsonb_build_object('original',(select to_jsonb(e) from original_provider_evidence e),'lastTrained',(select last_trained_at from icash_ranker_private.settings),'lastRefresh',(select last_refreshed_at from icash_learning_queue))"),before);
 await db.exec('update icash_learning_policy_private.settings set enabled=true');
 await assert.rejects(db.exec(sql),/Disabled complete learning release/);await db.exec('rollback');
 await db.exec("update icash_learning_policy_private.settings set enabled=false;update icash_ranker_private.settings set active_model='00000000-0000-4000-8000-000000000002'");
 await assert.rejects(db.exec(sql),/Existing qualified model/);await db.exec('rollback');
}finally{await db.close();}
console.log('Learning evidence cutover: derived freshness, generation wakeup, original evidence, release gates and old training token rejection passed.');
