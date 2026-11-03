import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const migration=read('config/legacy-voice-candidate-fence.sql'),original=read('tests/fixtures/legacy-voice-before-candidate-fence.sql');
const before=migration.match(/original_query text:=\$old\$([\s\S]*?)\$old\$/)[1],after=migration.match(/replacement_query text:=\$new\$([\s\S]*?)\$new\$/)[1];
const seed=n=>q('select fixture_seed($1)',[n]);
const count=n=>v('select count(*)::integer from icash_voice_jobs where permission_id=fixture_id($1)',[n]);
const run=()=>q('select public.icash_queue_voice_jobs_before_operational()');
const isolated=async fn=>{await q('begin');try{await fn();}finally{await q('rollback');}};
try{
 await db.exec(read('tests/fixtures/legacy-voice-candidate-fence.sql'));await db.exec(original);
 await db.exec('revoke all on function icash_queue_voice_jobs_before_operational() from public,anon,authenticated;grant execute on function icash_queue_voice_jobs_before_operational() to service_role;');
 const originalDefinition=await v("select pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure)");
 assert.equal(await v("select md5(pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure))"),'a8eb1f89eb58fa1cd9aac427af6e7252');
 await db.exec('select fixture_seed(n) from generate_series(100,299)n;');
 await db.exec("insert into icash_voice_jobs(account_id,permission_id,state,outcome) select account_id,id,case when id::text like '%0' then 'held' else 'complete' end,'original_unknown_receipt' from icash_contact_permissions;update fixture_evidence set explode=true;");
 const saved=await v('select md5(string_agg(to_jsonb(j)::text,\',\' order by id)) from icash_voice_jobs j');
 // The unfenced selector can plan full evidence before the anti-join; the
 // direct predicate reproduces the invalid historical work deterministically.
 await assert.rejects(q('select icash_seller_voice_permission_current(account_id,id) from icash_contact_permissions limit 1'),/Prior route unnecessarily revalidated/);
 await db.exec(migration);
 const actual=await v("select pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure)");
 assert.equal(actual,originalDefinition.replace(before,after),'only first insert source changes; callbacks and old ticket recovery stay exact');
 for(const plan of ['auto','force_generic_plan'])await isolated(async()=>{
  await q('set local plan_cache_mode='+plan);await run();
  assert.equal(await v('select count(*)::integer from icash_voice_jobs'),200,'historical routes never revalidate');
  await seed(400);await run();assert.equal(await count(400),1,'new eligible permission still queues');
  await q('update fixture_evidence set explode=true where id=fixture_id(400)');await run();assert.equal(await count(400),1);
 });
 for(const state of ['ready','issued','dispatching','held','cancelled','failed','complete'])await isolated(async()=>{
  await seed(400);await q('update fixture_evidence set explode=true where id=fixture_id(400)');
  await q("insert into icash_voice_jobs(account_id,permission_id,state) values(fixture_id(1),fixture_id(400),$1)",[state]);
  await run();assert.equal(await count(400),1,state+' retains first-route exclusion');
 });
 for(const [label,change] of [
  ['Pause','update icash_accounts set bot_paused=true'],
  ['disabled configuration','update icash_voice_configs set enabled=false'],
  ['revoked permission','update icash_contact_permissions set revoked_at=now() where id=fixture_id(400)'],
  ['expired permission',"update icash_contact_permissions set permission_until=now()-interval '1 second' where id=fixture_id(400)"],
  ['buyer permission',"update icash_contact_permissions set party='buyer' where id=fixture_id(400)"],
  ['incomplete screening',"update icash_screening_jobs set state='queued' where id=fixture_id(400)"],
  ['account mismatch','update icash_screening_jobs set account_id=fixture_id(2) where id=fixture_id(400)'],
  ['voice policy','update icash_accounts set voice_current=false'],
  ['contact evidence','update fixture_evidence set allowed=false where id=fixture_id(400)'],
  ['financial ineligibility',"update icash_screening_jobs set result='{}' where id=fixture_id(400)"]
 ])await isolated(async()=>{await seed(400);await db.exec(change);await run();assert.equal(await count(400),0,label);});
 await isolated(async()=>{await seed(400);await q("update icash_screening_jobs set result='{}' where id=fixture_id(400)");await q('update fixture_evidence set limited=true where id=fixture_id(400)');await run();assert.equal(await count(400),1,'limited seller contact retained');});
 await isolated(async()=>{await seed(400);await q('update icash_contact_permissions set dnc_clear=true where id=fixture_id(400)');await q('update fixture_evidence set allowed=false,explode=true where id=fixture_id(400)');await run();assert.equal(await count(400),1,'original DNC branch retained');});
 // Operational history requires exact account/screening/key and a first call,
 // independent of its saved state. Nonmatching routes must not suppress work.
 for(const [label,mutation,blocked] of [
  ['exact held route','',true],
  ['other account','update icash_voice_jobs set account_id=fixture_id(2) where operational_contact_id=fixture_id(400)',false],
  ['other source account','update icash_operational_contacts set account_id=fixture_id(2)',false],
  ['other screening','update icash_operational_contacts set screening_id=fixture_id(401)',false],
  ['other key',"update icash_operational_contacts set contact_key='other'",false],
  ['null key','update icash_operational_contacts set contact_key=null',false],
  ['callback only','update icash_voice_jobs set callback_id=fixture_id(402) where operational_contact_id=fixture_id(400)',false]
 ])await isolated(async()=>{
  await seed(400);await q('insert into icash_operational_contacts select id,account_id,screening_id,contact_key from icash_contact_permissions where id=fixture_id(400)');
  await q("insert into icash_voice_jobs(account_id,operational_contact_id,state) values(fixture_id(1),fixture_id(400),'held')");
  if(mutation)await db.exec(mutation);if(blocked)await q('update fixture_evidence set explode=true where id=fixture_id(400)');
  await run();assert.equal(await count(400),blocked?0:1,label);
 });
 // Eligibility stays before LIMIT100: many rejected new candidates cannot
 // crowd out later eligible accounts. No newly introduced early page limit.
 await isolated(async()=>{
  await db.exec('select fixture_seed(n) from generate_series(400,519)n;update fixture_evidence set allowed=false where id>=fixture_id(400);select fixture_seed(600,2);select fixture_seed(601,3);');
  await run();assert.equal(await count(600),1);assert.equal(await count(601),1);
 });
 await isolated(async()=>{await db.exec('select fixture_seed(n) from generate_series(400,519)n;');await run();assert.equal(await v('select count(*)::integer from icash_voice_jobs where permission_id>=fixture_id(400)'),100);await run();assert.equal(await v('select count(*)::integer from icash_voice_jobs where permission_id>=fixture_id(400)'),120);});
 assert.equal(await v('select md5(string_agg(to_jsonb(j)::text,\',\' order by id)) from icash_voice_jobs j'),saved,'saved jobs untouched');
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'icash_queue_voice_jobs_before_operational()','execute')",[role]),false);
 assert.equal(await v("select has_function_privilege('service_role','icash_queue_voice_jobs_before_operational()','execute')"),true);
 assert.equal(migration,read('supabase/migrations/20261103191000_legacy_voice_candidate_fence.sql'));
 await assert.rejects(db.exec(migration),/Legacy voice candidate fence prerequisite changed/);await q('rollback');
 console.log('Legacy voice fence: prior permission/operational history bypasses expensive evidence; all original guards, late eligible accounts, LIMIT100, callbacks, saved receipts and ACLs preserved.');
}finally{await db.close();}
