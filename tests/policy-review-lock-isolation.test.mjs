import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {before,migration,read,setup,value,decision,snapshot} from './helpers/policy-review-lock-fixture.mjs';
const db=new PGlite(),v=(sql,args=[])=>value(db,sql,args);
try{
 await db.exec(setup);
 for(const f of before.functions)assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);
 const first=await v(decision());await v(decision('other'));
 await db.query("update icash_learning_private.policy_cohorts set last_reviewed_at=now()-interval '2 hours',last_error_at=now()-interval '2 hours',last_error_code='57014' where market='*'");
 const original=await v(snapshot);
 const metadata=()=>v("select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'owner',proowner,'security',prosecdef,'config',proconfig) order by oid) from pg_proc where oid=any($1::regprocedure[])",[before.functions.map(f=>f.signature)]);
 const oldMeta=await metadata();
 await db.exec('begin;'+migration);
 assert.deepEqual(await v(snapshot),original,'All original pointers and review diagnostics survive');
 await assert.rejects(db.query('select 1/0'),/division by zero/);
 await db.exec('rollback');
 assert.equal(await v("select relkind from pg_class where oid='icash_learning_private.policy_cohorts'::regclass"),'r');
 assert.equal(await v("select to_regclass('icash_learning_private.policy_cohort_reviews')"),null);
 assert.deepEqual(await v(snapshot),original,'Migration-ledger failure rolls back every schema change');
 await db.exec('begin;'+migration+'commit;');
 assert.deepEqual(await v(snapshot),original);
 assert.deepEqual(await metadata(),oldMeta,'Original function identity, access and execution mode are unchanged');
 const files=readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(n=>n.endsWith('_policy_review_lock_isolation.sql'));
 assert.equal(files.length,1);assert.equal(read('supabase/migrations/'+files[0]),migration);
 for(const f of before.functions){
  const current=await v('select pg_get_functiondef($1::regprocedure)',[f.signature]);
  if(/observe_policy_decision|record_policy_application|icash_record_learning_policy_hold/.test(f.signature)){
   assert.equal(current,f.definition.replaceAll('icash_learning_private.policy_cohorts','icash_learning_private.policy_cohort_sources'));
  }else if(!f.signature.includes('icash_review_policy_cohorts'))assert.equal(current,f.definition,'Promotion and wrapper logic remain byte-identical');
 }
 const latest=await v(decision());assert(latest>first);
 assert.equal(await v("select latest_decision_id from icash_learning_private.policy_cohorts where market='*'"),latest);
 assert.equal(await v('select count(*)::int from icash_learning_private.policy_cohort_reviews'),2,'Existing source updates do not add cursor rows');
 await v(decision('new'));assert.equal(await v('select count(*)::int from icash_learning_private.policy_cohort_reviews'),3);
 assert.equal(await v('select count(*)::int from icash_learning_private.policy_cohorts'),3);
 assert.deepEqual(await v('select icash_review_policy_cohorts()'),{reviewed:3,errors:0});
 assert.deepEqual(await v('select icash_review_policy_cohorts()'),{reviewed:0,errors:0},'One observation per cohort-hour');
 assert.equal(await v("select count(*)::int from icash_learning_private.policy_cohorts where last_reviewed_at is null or last_error_code is not null"),0);
 assert.equal(await v("select count(*)::int from icash_learning_private.proposal_events where evidence->>'businessSuccess'='true'"),0);
 // A failed review preserves diagnostics and does not advance a proposal.
 await v(decision('failure'));
 await db.exec("create or replace function public.icash_advance_policy_proposal(p_proposal bigint) returns jsonb language plpgsql as $$begin raise exception using errcode='22023',message='fixture';end$$;");
 assert.deepEqual(await v('select icash_review_policy_cohorts()'),{reviewed:0,errors:1});
 assert.equal(await v("select last_error_code from icash_learning_private.policy_cohorts where market='failure'"),'22023');
 assert.equal(await v("select count(*)::int from icash_learning_private.improvement_proposals where policy_market='failure'"),0);
 // All public roles remain unable to read or mutate private policy state.
 for(const relation of ['policy_cohorts','policy_cohort_sources','policy_cohort_reviews']){
  for(const role of ['anon','authenticated'])assert.equal(await v('select has_table_privilege($1,$2,\'select\')',[role,'icash_learning_private.'+relation]),false);
  assert.equal(await v('select has_table_privilege(\'service_role\',$1,\'select\')',['icash_learning_private.'+relation]),true);
  assert.equal(await v('select has_table_privilege(\'service_role\',$1,\'update\')',['icash_learning_private.'+relation]),false);
 }
 assert.equal(await v("select bool_and(relrowsecurity) from pg_class where oid in ('icash_learning_private.policy_cohort_sources'::regclass,'icash_learning_private.policy_cohort_reviews'::regclass)"),true);
 assert.deepEqual(await v("select reloptions from pg_class where oid='icash_learning_private.policy_cohorts'::regclass"),['security_invoker=true']);
 await assert.rejects(db.exec('begin;'+migration+'commit;'),/predecessor changed/);await db.exec('rollback');
 console.log('Policy review isolation: exact original source, lossless split/projection, rollback, immutable policy behavior, hourly review, diagnostics, private rights and repeat refusal passed.');
}finally{await db.close();}
