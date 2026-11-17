// Actual deployed policy functions over fictional data on disposable localhost.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {before,migration,setup,value,decision,snapshot} from '../tests/helpers/policy-review-lock-fixture.mjs';
import {assertDisposablePostgresTarget} from '../tests/helpers/disposable-postgres-target.mjs';
const {Client}=createRequire(import.meta.url)(process.env.ICASH_PG_MODULE||'pg'),clients=[];
const connect=async name=>{
 const c=new Client({host:'127.0.0.1',port:55443,user:'postgres',password:'isolated-fixture-only',database:'icash_reliability',application_name:'policy-lock-'+name,connectionTimeoutMillis:5000});
 clients.push(c);await c.connect();await assertDisposablePostgresTarget(c);
 await c.query("set statement_timeout='8s';set lock_timeout='3s';set timezone='UTC'");return c;
};
const account='00000000-0000-4000-8000-000000000001',release='a'.repeat(40);
try{
 const admin=await connect('admin'),review=await connect('review'),source=await connect('source'),other=await connect('other');
 const reset=async fixed=>{
  await admin.query('drop schema if exists icash_learning_policy_private cascade;drop schema if exists icash_learning_private cascade;drop schema if exists icash_reliability_private cascade;drop schema public cascade;create schema public;');
  await admin.query("do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;");
  await admin.query(setup.replace(/create role (anon|authenticated|service_role);/g,''));
  for(const f of before.functions)assert.equal(await value(admin,'select md5(pg_get_functiondef($1::regprocedure))',[f.signature]),f.hash);
  if(fixed)await admin.query('begin;'+migration+'commit;');
  await admin.query('insert into icash_accounts values($1)',[account]);
  await admin.query("insert into icash_learning_private.policy_releases(release_sha,ci_run_id,ci_run_attempt,repository,workflow,branch,event,conclusion,completed_at) values($1,123,1,'richoffcashflow/iCash-X-2.0-','.github/workflows/reliability.yml','main','push','success',now()-interval '4 hours')",[release]);
  await admin.query("update icash_learning_policy_private.settings set enabled=true,release_sha=$1,activated_at=now()-interval '2 hours',evidence_after=now()-interval '3 hours'",[release]);
 };
 // Review keeps its cursor transaction open through later maintenance. Each
 // foreground operation uses the unchanged real decision/application checks.
 for(const kind of ['decision','assignment','hold'])for(const fixed of [false,true]){
  await reset(fixed);
  const domain=kind==='decision'?'seller_sms':'seller_calls';
  const payload=kind==='hold'?{status:'safety_hold',allowedChoices:[]}:{status:'explore',allowedChoices:['a','b']};
  const id=await value(admin,"insert into icash_learning_policy_private.decisions(domain,context,market,policy_version,decision,stats,choices,require_contracts,evidence_hash) values($1,'cash-question-v6','*','evidence-v2',$2,'[]',array['a','b'],false,'first') returning id",[domain,payload]);
  const expected=await value(admin,'select icash_learning_private.expected_shared_allocation($1,$2,$3,$4,$5,true)',[account,domain,'subject','cash-question-v6',payload]);
  await review.query('begin');assert.equal((await value(review,'select icash_review_policy_cohorts()')).reviewed,1);
  await source.query("set statement_timeout='300ms'");
  const action=()=>kind==='decision'?value(source,decision()):kind==='hold'?value(source,'select icash_record_learning_policy_hold($1,$2,$3)',[id,account,'held-original']):value(source,"insert into icash_learning_assignments(account_id,domain,subject,context,market,variant,mode,learning_decision_id,learning_policy_version,learning_selection_mode) values($1,$2,'subject','cash-question-v6','*',$3,'explore',$4,'evidence-v2',$5) returning learning_decision_id",[account,domain,expected.variant,id,expected.mode]);
  if(fixed){
   assert(await action());
   if(kind==='decision')assert(BigInt(await value(source,"select latest_decision_id from icash_learning_private.policy_cohorts"))>BigInt(id));
   else assert.equal(await value(source,'select count(*)::int from icash_learning_private.policy_applications'),1);
  }else await assert.rejects(action(),e=>e.code==='57014');
  // Advisory ownership remains unchanged: another review never double-counts.
  assert.deepEqual(await value(other,'select icash_review_policy_cohorts()'),{reviewed:0});
  await review.query('commit');
  assert.deepEqual(await value(other,'select icash_review_policy_cohorts()'),{reviewed:0,errors:0});
  assert.equal(await value(admin,'select observations from icash_learning_private.improvement_proposals'),1);
  console.log(`${fixed?'PASS isolated':'REPRODUCED old timeout'}: ${kind} while reviewed transaction remains open`);
 }
 // Source writes to the same canonical header still serialize, preserving the
 // greatest decision ID. New cohort creation initializes exactly one cursor.
 await reset(true);await source.query("set statement_timeout='3s'");
 await review.query('begin');const first=await value(review,decision('new-cohort'));
 let done=false;const waiting=value(source,decision('new-cohort')).then(x=>{done=true;return x;});
 const sourcePid=await value(admin,"select pid from pg_stat_activity where application_name='policy-lock-source'");
 let blocked=false;for(let i=0;i<100;i++){if(await value(admin,"select wait_event_type='Lock' from pg_stat_activity where pid=$1",[sourcePid])){blocked=true;break}await new Promise(r=>setTimeout(r,10));}
 assert(blocked);assert.equal(done,false);await review.query('commit');const second=await waiting;
 assert(BigInt(second)>BigInt(first));assert.equal(await value(admin,'select count(*)::int from icash_learning_private.policy_cohort_reviews'),1);
 assert.equal(await value(admin,'select latest_decision_id from icash_learning_private.policy_cohorts'),second);
 // A genuinely locked review cursor is skipped without blocking another cohort.
 await value(admin,decision('other'));await review.query('begin;select 1 from icash_learning_private.policy_cohort_reviews where market=\'new-cohort\' for update');
 assert.deepEqual(await value(other,'select icash_review_policy_cohorts()'),{reviewed:1,errors:0});await review.query('rollback');
 assert.deepEqual(await value(other,'select icash_review_policy_cohorts()'),{reviewed:1,errors:0});
 // Busy live source prevents the migration immediately and leaves it intact.
 await reset(false);await value(admin,decision());const original=await value(admin,snapshot);
 await review.query('begin;select 1 from icash_learning_private.policy_cohorts for update');
 await assert.rejects(admin.query('begin;'+migration+'commit;'),e=>e.code==='55P03');await admin.query('rollback');
 assert.deepEqual(await value(admin,snapshot),original);assert.equal(await value(admin,"select to_regclass('icash_learning_private.policy_cohort_sources')"),null);
 await review.query('rollback');
 console.log('PASS native PostgreSQL: six before/after foreground interleavings, concurrent review suppression, canonical source serialization, one cursor per new cohort, busy-cursor fairness and atomic NOWAIT migration refusal.');
}finally{await Promise.allSettled(clients.map(c=>c.end()));}
