import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',sha='a'.repeat(40),nextSha='b'.repeat(40);
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,bucket=(text,mod)=>parseInt(createHash('md5').update(text).digest('hex').slice(0,8),16)%mod;
const accountFor=(domain,context,control=false)=>Array.from({length:100},(_,i)=>uuid(i+1)).find(a=>(bucket(a+domain+context+'evidence-v2-control',100)<20)===control);
let subjectSequence=0;
try{
 await db.exec(read('tests/fixtures/learning-refresh-concurrency.sql'));
 await db.exec(read('config/learning-refresh-concurrency.sql'));
 await db.exec(read('tests/fixtures/learning-operations-monitor.sql'));
 await db.exec(read('config/learning-operations-review.sql'));
 await db.exec(`create schema icash_learning_policy_private;
 create table icash_learning_policy_private.settings(id int primary key,enabled boolean,policy_version text,release_sha text,activated_at timestamptz,evidence_after timestamptz);
 insert into icash_learning_policy_private.settings values(1,false,'evidence-v2',null,null,now()-interval '5 days');
 create table icash_learning_policy_private.sms_settings(id int primary key,enabled boolean);insert into icash_learning_policy_private.sms_settings values(1,false);
 create table icash_learning_policy_private.decisions(id bigint generated always as identity primary key,domain text,context text,market text,policy_version text,decision jsonb,stats jsonb,choices text[],require_contracts boolean,evidence_hash text,created_at timestamptz default now());
 create table icash_operating_budget(id int primary key);insert into icash_operating_budget values(1);
 create table icash_learning_assignments(account_id uuid,domain text,subject text,context text,market text,variant text,mode text,learning_decision_id bigint,learning_policy_version text,learning_selection_mode text,primary key(account_id,domain,subject));
 create table icash_seller_opener_assignments(thread_id uuid primary key,account_id uuid,body text,learning_context text,variant text,learning_decision_id bigint,learning_policy_version text,learning_selection_mode text);
 create table fixture_policy_stats(domain text,context text,market text,stats jsonb,primary key(domain,context,market));
 create function public.icash_shared_learning_stats(d text,c text,m text) returns jsonb language sql stable as $$select coalesce((select stats from public.fixture_policy_stats where (domain,context,market)=(d,c,m)),'[]'::jsonb)$$;
 create table fixture_sms_plans(account_id uuid,thread_id uuid,plan jsonb,primary key(account_id,thread_id));
 create function public.icash_seller_sms_learning_plan(a uuid,t uuid) returns jsonb language sql stable as $$select plan from public.fixture_sms_plans where account_id=a and thread_id=t$$;`);
 await db.exec(read('config/learning-policy-lifecycle.sql'));
 assert.equal(read('config/learning-policy-lifecycle.sql'),read('supabase/migrations/20261109184429_learning_policy_lifecycle.sql'));
 const activate=(release=sha)=>v('select icash_activate_learning_policy($1,$2,true)',[owner,release]);
 const release=async(releaseSha,run)=>q("insert into icash_learning_private.policy_releases(release_sha,ci_run_id,ci_run_attempt,repository,workflow,branch,event,conclusion,completed_at) values($1,$2,1,'richoffcashflow/iCash-X-2.0-','.github/workflows/reliability.yml','main','push','success',now()-interval '4 days')",[releaseSha,run]);
 await assert.rejects(activate(),/Canonical successful release required/);await release(sha,123);
 await assert.rejects(activate(),/invalidation required/);await q('update icash_learning_policy_private.settings set evidence_after=now()');await activate();
 await assert.rejects(q('update icash_learning_private.policy_releases set ci_run_id=124'),/immutable/);
 const decision=async(domain='seller_calls',context='reviewed',market='*',status='shared')=>{
  const result={status,winner:status==='shared'?'a':null,objective:'positive',reason:status==='shared'?'verified_cost_comparison':status==='safety_hold'?'opt_out_guard':'cost_evidence_incomplete',allowedChoices:status==='safety_hold'?[]:['a','b']};
  const id=await v("insert into icash_learning_policy_private.decisions(domain,context,market,policy_version,decision,stats,choices,require_contracts,evidence_hash) values($1,$2,$3,'evidence-v2',$4,'[]',array['a','b'],false,random()::text) returning id",[domain,context,market,result]);
  return {id,domain,context,market,result};
 };
 // Independently reproduce the deployed generic allocator hashes. Altered modes
 // and chosen variants must fail even when the caller cites a real decision ID.
 const assignment=async(d,mode='shared',overrides={})=>{
  const account=accountFor(d.domain,d.context,mode==='control');let subject,n;
  do{subject='fixture:'+ ++subjectSequence;n=bucket(account+d.domain+subject+'evidence-v2',10000);}while(mode==='shared'&&n%5>=3||mode==='explore'&&d.result.status==='shared'&&n%5<3);
  const variant=mode==='shared'?'a':d.result.status==='shared'&&mode==='explore'?'b':['a','b'][n%2];
  return {account,subject,variant,mode,...overrides};
 };
 const insertAssignment=async(d,input)=>q("insert into icash_learning_assignments values($1,$2,$3,$4,$5,$6,$7,$8,'evidence-v2',$9)",[input.account,d.domain,input.subject,d.context,d.market,input.variant,input.mode==='shared'?'shared':'explore',d.id,input.mode]);
 const assign=async(d,mode='shared')=>{const input=await assignment(d,mode);await insertAssignment(d,input);return input;};
 const review=()=>v('select icash_review_policy_cohorts()');
 const advance=id=>v('select icash_advance_policy_proposal($1)',[id]);
 const candidate=async d=>{await review();await q("update icash_learning_private.improvement_proposals set status='candidate' where policy_domain=$1 and policy_context=$2 and policy_market=$3 and release_sha=$4",[d.domain,d.context,d.market,sha]);return v("select id from icash_learning_private.improvement_proposals where policy_domain=$1 and policy_context=$2 and policy_market=$3 and release_sha=$4",[d.domain,d.context,d.market,sha]);};
 const status=id=>v('select status from icash_learning_private.improvement_proposals where id=$1',[id]);
 const a=await decision();const first=await assign(a);
 await assert.rejects(insertAssignment(a,await assignment(a,'shared',{variant:'b'})),/Allocation|allocation|canonical|Canonical/);
 await assert.rejects(insertAssignment(a,await assignment(a,'shared',{mode:'control'})),/Allocation|allocation|canonical|Canonical/);
 await assert.rejects(insertAssignment({...a,market:'90210'},await assignment(a)),/cohort mismatch/);
 await q("insert into fixture_policy_stats values('seller_calls','reviewed','*','[{\"changed\":true}]')");
 await assert.rejects(insertAssignment(a,await assignment(a)),/evidence changed/);await q('delete from fixture_policy_stats');
 await assert.rejects(q("update icash_learning_assignments set learning_selection_mode='explore' where subject=$1",[first.subject]),/immutable/);
 const foreign=await decision('buyer_search','order-v1','90210');await assign(foreign);
 const sms=await decision('seller_sms','identity-v5','*'),thread=uuid(901),account=uuid(902);
 // An already-compiled legacy queue can finish after the prospective migration.
 // Its v4 assignment/body remain historical and cannot mint a v5 application.
 const legacyThread=uuid(900),priorApplications=await v('select count(*)::int from icash_learning_private.policy_applications');
 await q("insert into icash_seller_opener_assignments values($1,$2,'Legacy template','identity-v4','identity-v4',null,null,null)",[legacyThread,account]);
 await q("update icash_seller_opener_assignments set body='Original expanded legacy copy' where thread_id=$1",[legacyThread]);
 assert.equal(await v('select count(*)::int from icash_learning_private.policy_applications'),priorApplications,'Legacy queue completion is not a policy application');
 await assert.rejects(q("update icash_seller_opener_assignments set learning_context='identity-v5',learning_decision_id=$2,learning_policy_version='evidence-v2',learning_selection_mode='shared' where thread_id=$1",[legacyThread,sms.id]),/Historical allocation cannot be relabelled/);
 await q('insert into fixture_sms_plans values($1,$2,$3)',[account,thread,{variant:'a',mode:'shared',body:'Reviewed fixture copy',stats:[],decision:sms.result}]);
 await assert.rejects(q("insert into icash_seller_opener_assignments values($1,$2,'Wrong expanded copy','identity-v5','a',$3,'evidence-v2','shared')",[thread,account,sms.id]),/Seller SMS allocation mismatch/);
 await q("insert into icash_seller_opener_assignments values($1,$2,'Reviewed fixture copy','identity-v5','a',$3,'evidence-v2','shared')",[thread,account,sms.id]);
 assert.equal(await v('select count(*)::int from icash_learning_private.policy_applications'),3);
 assert.equal((await review()).reviewed,3);assert.equal((await review()).reviewed,0,'Hourly cadence per cohort');
 for(let i=0;i<2;i++){
  await q("update icash_learning_private.policy_cohorts set last_reviewed_at=now()-interval '61 minutes'");
  await q("update icash_learning_private.improvement_proposals set first_observed_at=now()-interval '3 hours',last_observed_at=now()-interval '61 minutes' where category='learning_policy'");await review();
 }
 let ps=(await q("select id,cohort_key,policy_domain,policy_market,status from icash_learning_private.improvement_proposals where category='learning_policy' order by id")).rows;
 assert.equal(ps.length,3);assert.equal(new Set(ps.map(p=>p.cohort_key)).size,3);assert(ps.every(p=>p.status==='limited_experiment'),'Fresh activation cannot instantly promote from the same allocation');
 await q("update icash_learning_policy_private.settings set activated_at=now()-interval '73 hours'");
 for(const p of ps)await advance(p.id);
 assert((await q("select status from icash_learning_private.improvement_proposals where category='learning_policy'")).rows.every(p=>p.status==='promoted'));
 assert.equal(await v("select count(*)::int from icash_learning_private.proposal_events where evidence->>'businessSuccess'='true'"),0,'Observational policy adoption is not causal business success');
 const primary=ps.find(p=>p.policy_domain==='seller_calls').id,other=ps.find(p=>p.policy_market==='90210').id;
 const before=await v('select count(*)::int from icash_learning_private.validation_receipts');await advance(primary);assert.equal(await v('select count(*)::int from icash_learning_private.validation_receipts'),before);
 // The 40% challenger remains normal exploration while its canonical decision is shared.
 await assign(a,'explore');await advance(primary);assert.equal(await status(primary),'promoted');
 // A later account-control selection cannot hide a real applied cohort fallback.
 const fallback=await decision('seller_calls','reviewed','*','explore');await assign(fallback,'explore');await assign(fallback,'control');await advance(primary);
 assert.equal(await status(primary),'rolled_back');assert.equal(await status(other),'promoted');
 assert.equal(await v("select receipt->>'reason' from icash_learning_private.validation_receipts where proposal_id=$1 and stage='rolled_back'",[primary]),'cost_evidence_incomplete');
 // A stale shared application is not sufficient after a newer safety decision.
 const held=await decision('buyer_search','order-v1','10002');await assign(held);const heldProposal=await candidate(held);await advance(heldProposal);await advance(heldProposal);
 const holdDecision=await decision('buyer_search','order-v1','10002','safety_hold');await advance(heldProposal);assert.equal(await status(heldProposal),'limited_experiment','Newer safety decision blocks old-application promotion');
 const holdAccount=accountFor('buyer_search','order-v1');await q('insert into icash_accounts(id) values($1)',[holdAccount]);
 await assert.rejects(v('select icash_record_learning_policy_hold($1,$2,$3)',[held.id,holdAccount,'unsupported-hold']),/Canonical policy hold required/);
 const hold=()=>v('select icash_record_learning_policy_hold($1,$2,$3)',[holdDecision.id,holdAccount,'held-subject']);const holdId=await hold();assert(holdId);assert.equal(await hold(),holdId,'Actual hold observation is idempotent');await advance(heldProposal);assert.equal(await status(heldProposal),'rolled_back');
 assert.equal(await v("select receipt->>'reason' from icash_learning_private.validation_receipts where proposal_id=$1 and stage='rolled_back'",[heldProposal]),'opt_out_guard');
 // No application: CI by itself cannot establish an active limited experiment.
 const missing=await decision('buyer_search','order-v1','10001'),pending=await candidate(missing);await advance(pending);await advance(pending);assert.equal(await status(pending),'offline_validated');
 // A new verified release gets a successor; immutable old evidence remains valid history.
 const cutover=await decision('buyer_search','order-v1','10003');await assign(cutover);const oldProposal=await candidate(cutover);await advance(oldProposal);assert.equal(await status(oldProposal),'offline_validated');
 await release(nextSha,124);await q('update icash_learning_policy_private.settings set enabled=false,evidence_after=now()');await activate(nextSha);
 const newDecision=await decision('buyer_search','order-v1','10003');await assign(newDecision);await q("update icash_learning_private.policy_cohorts set last_reviewed_at=now()-interval '61 minutes'");await review();
 const versions=(await q("select id,version,release_sha,status from icash_learning_private.improvement_proposals where policy_market='10003' order by version")).rows;
 assert.equal(versions.length,2);assert.equal(versions[0].release_sha,sha);assert.equal(versions[0].status,'offline_validated');assert.equal(versions[1].release_sha,nextSha);assert(versions[1].version>versions[0].version);
 await q("update icash_learning_private.improvement_proposals set status='candidate' where id=$1",[versions[1].id]);await advance(versions[1].id);await advance(versions[1].id);assert.equal(await status(versions[1].id),'limited_experiment','New release has its own CI lineage');
 // A single failing cohort cannot roll back peer reviews or starve later pages.
 for(let n=11000;n<11025;n++)await decision('buyer_search','order-v1',String(n));
 await db.exec(`create function fixture_proposal_error() returns trigger language plpgsql as $$begin if new.policy_market='11000' then raise exception 'private fixture detail must not be retained' using errcode='22023';end if;return new;end$$;
 create trigger fixture_proposal_error before insert on icash_learning_private.improvement_proposals for each row execute function fixture_proposal_error();`);
 let batch=await review();assert.equal(batch.reviewed,19);assert.equal(batch.errors,1);batch=await review();assert.equal(batch.reviewed,5);assert.equal(batch.errors,0);assert.equal((await review()).reviewed,0);
 assert.equal(await v("select last_error_code from icash_learning_private.policy_cohorts where market='11000'"),'22023');
 assert.equal(await v("select count(*)::int from icash_learning_private.improvement_proposals where policy_market>='11000' and policy_market<'11025'"),24);
 for(const role of ['anon','authenticated','service_role'])for(const table of ['policy_releases','policy_applications','validation_receipts'])assert.equal(await v(`select has_table_privilege('${role}','icash_learning_private.${table}','insert')`),false);
 await assert.rejects(v('select icash_activate_learning_policy($1,$2,true)',[uuid(1),sha]),/Owner required/);
 console.log('Policy lifecycle: deterministic application proof, cohort isolation, canonical release, 72-hour adoption, honest outcome labels, challenger/control handling, newer holds and release successors passed.');
}finally{await db.close();}
