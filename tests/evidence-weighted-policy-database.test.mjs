import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {sharedLearningDecision,learningBounds,assignSharedLearning,SharedLearningSafetyHold} from '../lib/shared-learning.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const choices=['cash_interest','flexible_timing'];
const arm=(variant,positive=150)=>({variant,contributors:3,attempts:300,pending:0,positive,opted_out:0,contract_trials:0,contracts:0,closing_trials:0,closings:0,cost_cents:30000,costs_complete:true,updated_at:'2026-11-04T00:00:00Z',effective_attempts:300,effective_pending:0,effective_positive:positive,effective_opted_out:0,effective_contract_trials:0,effective_contracts:0,effective_closing_trials:0,effective_closings:0,effective_cost_cents:30000});
const good=[arm(choices[0],150),arm(choices[1],30)],change=(rows,i,patch)=>rows.map((r,n)=>n===i?{...r,...patch}:r);
let parityCases=0;
const parity=async(stats,options=choices,contracts=false)=>{
 const expected=sharedLearningDecision(stats,options,contracts);
 assert.deepEqual(await v('select icash_learning_decision_v2($1,$2,$3)',[JSON.stringify(stats),options,contracts]),expected,JSON.stringify({stats,options,contracts}));
 parityCases++;return expected;
};
try{
 await db.exec('create role anon;create role authenticated;create role service_role;');
 await db.exec(read('tests/fixtures/shared-learning-schema.sql'));
 await db.exec(read('supabase/migrations/20261021185044_platform_shared_learning_schema.sql'));
 const before=JSON.parse(read('tests/fixtures/evidence-policy-live-prerequisites.json'));
 for(const f of before){await db.exec(f.definition);assert.equal(await v('select md5(pg_get_functiondef(oid)) from pg_proc where proname=$1',[f.proname]),f.hash);}
 await db.exec(`revoke all on function icash_assign_shared_learning(uuid,text,text,text,text),icash_shared_learning_stats(text,text,text),icash_shared_learning_winner(text,text,text,text[]) from public,anon,authenticated;
 grant execute on function icash_assign_shared_learning(uuid,text,text,text,text),icash_shared_learning_stats(text,text,text),icash_shared_learning_winner(text,text,text,text[]) to service_role;
 insert into icash_accounts(id,owner_user_id) values('${id(1)}','${id(1)}');
 insert into icash_learning_assignments(account_id,domain,subject,context,market,variant,mode) values('${id(1)}','seller_calls','old','reviewed','*','flexible_timing','explore');`);
 const historical=await v("select to_jsonb(a) from icash_learning_assignments a where subject='old'");
 const patch=read('config/evidence-weighted-learning-policy.sql');assert.equal(patch,read('supabase/migrations/20261104052433_evidence_weighted_learning_policy.sql'));
 await db.exec(patch);
 assert.equal(await v('select enabled from icash_learning_policy_private.settings'),false,'Installation does not enable learned allocation');
 for(const role of ['anon','authenticated']){
  assert.equal(await v('select has_schema_privilege($1,\'icash_learning_policy_private\',\'usage\')',[role]),false);
  assert.equal(await v('select has_function_privilege($1,\'icash_learning_decision_v2(jsonb,text[],boolean)\',\'execute\')',[role]),false);
  assert.equal(await v('select has_function_privilege($1,\'icash_assign_shared_learning(uuid,text,text,text,text)\',\'execute\')',[role]),false);
 }
 assert.equal(await v("select has_table_privilege('service_role','icash_learning_policy_private.decisions','update')"),false,'Decision evidence is append-only through its recorder');
 assert.equal(await v("select has_table_privilege('service_role','icash_learning_policy_private.decisions','delete')"),false);
 for(const operation of ['delete','truncate'])assert.equal(await v("select has_table_privilege('service_role','icash_learning_assignments',$1)",[operation]),false,'Service cannot erase historical allocation evidence');
 await db.exec('set role service_role;');
 try{await assert.rejects(q("delete from public.icash_learning_assignments where subject='old'"),/permission denied/);await assert.rejects(q('truncate public.icash_learning_assignments'),/permission denied/);}finally{await db.exec('reset role;');}

 assert.equal((await parity(good)).winner,choices[0]);
 for(const stats of [null,{},[],[good[0]],[good[0],good[0]],good.map(s=>({...s,extra:'ignored'}))])await parity(stats);
 for(const options of [[],['cash_interest'],['cash_interest','cash_interest'],[''],Array.from({length:21},(_,i)=>'v'+i)])await parity(good,options);
 assert.equal((await parity([good[0]],[choices[0]])).status,'explore','One reviewed choice can be explored without claiming a comparison');
 for(const patch of [{contributors:2},{costs_complete:false},{effective_cost_cents:0},{pending:201,effective_pending:201,positive:10,effective_positive:10},{positive:9,effective_positive:9},{effective_positive:0.5},{effective_attempts:300.25},{cost_cents:-1},{attempts:0.5},{effective_attempts:Number.MAX_SAFE_INTEGER+1},{effective_positive:301},{positive:301},{effective_pending:301},{pending:301},{effective_opted_out:301},{effective_pending:200,effective_positive:150},{pending:200,positive:150}])await parity(change(good,0,patch));
 const pending=good.map(s=>({...s,attempts:s.attempts+1000,pending:1000,effective_attempts:s.effective_attempts+1000,effective_pending:1000}));
 assert.deepEqual(await parity(pending),await parity(good),'Unresolved attempts cannot increase reward or change selection');
 assert.equal((await parity(good,choices,true)).reason,'verified_contracts_required');
 const contracts=good.map((s,i)=>({...s,contract_trials:300,contracts:i?5:50,effective_contract_trials:300,effective_contracts:i?5:50}));
 assert.equal((await parity(contracts)).objective,'contracts');
 const matureClosings=contracts.map(s=>({...s,closing_trials:300,effective_closing_trials:300}));
 assert.equal((await parity(matureClosings)).reason,'insufficient_positive_outcomes','Mature unsuccessful closings cannot fall back to a better-looking proxy');
 assert.equal((await parity(matureClosings)).objective,'closings');
 const unsafe=good.map(s=>({...s,opted_out:30,effective_opted_out:30}));
 assert.deepEqual((await parity(unsafe)).allowedChoices,[]);
 assert.equal((await parity([unsafe[0]],[choices[0]])).status,'safety_hold','A sole unsafe arm is held rather than explored');
 assert.deepEqual((await parity(change(good,1,{opted_out:30,effective_opted_out:30}))).allowedChoices,[choices[0]]);
 const huge=good.map((s,i)=>({...s,attempts:Number.MAX_SAFE_INTEGER,positive:i?100:1000000,effective_attempts:Number.MAX_SAFE_INTEGER,effective_positive:i?100:1000000}));await parity(huge);
 let random=1234567;const next=()=>{random=(1664525*random+1013904223)>>>0;return random;};
 for(let i=0;i<80;i++){
  const rows=choices.map(c=>{const s=arm(c),n=100+next()%1900,w=next()%(n+1),pending=next()%100;return {...s,attempts:n+pending,pending,positive:w,effective_attempts:n+pending,effective_pending:pending,effective_positive:w,cost_cents:100+next()%100000,effective_cost_cents:100+next()%100000};});
  await parity(rows);
 }
 for(const [wins,trials] of [[0,0],[0,100],[100,100],[26,200],[1.25,3.5],[Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER],[-1,100],[101,100]]){
  const actual=await v('select icash_learning_bounds_v2($1,$2)',[wins,trials]),expected=learningBounds(wins,trials);
  assert(Math.abs(actual.lower-expected.lower)<1e-12&&Math.abs(actual.upper-expected.upper)<1e-12,'SQL/TS bounds agree at finite and weighted extremes');
 }
 for(const special of ['NaN','Infinity','-Infinity'])assert.deepEqual(await v('select icash_learning_bounds_v2($1::numeric,100)',[special]),{lower:0,upper:1},'Non-finite direct SQL input fails closed');

 // Exercise actual aggregate reading and assignment, not an injected decision.
 await db.exec(`insert into icash_accounts(id,owner_user_id) select md5('policy-account-'||a)::uuid,md5('policy-account-'||a)::uuid from generate_series(1,100) a;
 insert into icash_learning_rollups(account_id,domain,context,market,variant,attempts,positive,cost_cents,costs_complete)
 select md5('policy-account-'||a)::uuid,'seller_calls','reviewed','*',variant,100,case variant when 'cash_interest' then 80 else 10 end,1000,true
 from generate_series(1,3) a cross join (values('cash_interest'),('flexible_timing')) variants(variant);`);
 const stats=()=>v("select icash_shared_learning_stats('seller_calls','reviewed','*')");
 assert.equal((await stats()).length,2);
 assert((await stats()).every(s=>s.costs_complete===false),'First-call costs cannot certify complete contact or deal yield');
 assert.equal(sharedLearningDecision(await stats(),choices).reason,'cost_evidence_incomplete');
 const beforeExcluded=await stats();
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2),($3,$3),($4,null)',[id(200),'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',id(201),id(202)]);
 await q("insert into icash_funding_orders(id,account_id,mode,state) values($1,$2,'test','paid')",[id(203),id(201)]);
 await q(`insert into icash_learning_rollups(account_id,domain,context,market,variant,attempts,positive,cost_cents,costs_complete)
 select a,'seller_calls','reviewed','*','flexible_timing',100000,100000,1000,true from unnest($1::uuid[]) a`,[[id(200),id(201),id(202)]]);
 assert.deepEqual(await stats(),beforeExcluded,'Owner/demo, test-only funding and unknown-owner rows do not teach peers');
 await q("insert into icash_funding_orders(id,account_id,mode,state) values($1,$2,'live','paid')",[id(204),id(201)]);
 assert.equal((await stats()).find(s=>s.variant==='flexible_timing').contributors,4,'A genuine live-funded account is not permanently excluded by older test funding');
 await q('delete from icash_learning_rollups where account_id=any($1::uuid[])',[[id(200),id(201),id(202)]]);
 await assert.rejects(v("select icash_record_learning_decision('seller_calls','reviewed','*',$1,$2,false)",[good,choices]),/canonical observations/,'Callers cannot manufacture observations for a canonical allocation');
 await assert.rejects(v("select icash_record_learning_decision('seller_calls','reviewed','*',$1,$2,false)",[await stats(),['unreviewed']]),/Unreviewed/);
 await assert.rejects(v("select icash_record_learning_decision('seller_calls','reviewed','*',$1,$2,true)",[await stats(),choices]),/Unreviewed/);

 assert.equal(await v("select icash_shared_learning_winner('seller_calls','reviewed','*',$1)",[choices]),null,'Global gate remains off despite qualified evidence');
 const assign=(subject,account=id(1),context='reviewed')=>v("select icash_assign_shared_learning($1,'seller_calls',$2,$3,'*')",[account,subject,context]);
 assert.equal((await assign('disabled-new')).mode,'explore');
 assert.deepEqual(await assign('old'),{variant:'flexible_timing',version:'shared-v1',mode:'explore'});
 assert.deepEqual(await v("select to_jsonb(a)-array['learning_decision_id','learning_policy_version','learning_selection_mode'] from icash_learning_assignments a where subject='old'"),historical,'Original assignment identity is preserved');
 await assert.rejects(q("update icash_learning_assignments set learning_decision_id=(select min(id) from icash_learning_policy_private.decisions),learning_policy_version='evidence-v2',learning_selection_mode='shared' where subject='old'"),/Historical learning assignment/);
 assert.equal(await assign('old',id(1),'limited'),null,'Existing subject cannot be moved into a different context');
 await db.exec("update icash_learning_policy_private.settings set enabled=true,release_sha=repeat('a',40),activated_at=now();");
 assert.equal(await v("select icash_shared_learning_winner('seller_calls','reviewed','*',$1)",[choices]),null,'Enabled policy still refuses the known partial cost scope');
 // The real source above must remain collecting. Isolate a synthetic certified
 // full-cost source boundary to exercise prospective allocation/control mechanics
 // without pretending the current first-call reader has complete costs.
 const actualStatsDefinition=await v("select pg_get_functiondef('icash_shared_learning_stats(text,text,text)'::regprocedure)");
 await db.exec(`alter function icash_shared_learning_stats(text,text,text) rename to icash_fixture_actual_stats;
 create function icash_shared_learning_stats(text,text,text) returns jsonb language sql stable as $$
 select coalesce(jsonb_agg(jsonb_set(s,'{costs_complete}','true'::jsonb)),'[]') from jsonb_array_elements(public.icash_fixture_actual_stats($1,$2,$3)) s$$;`);
 assert.equal(await v("select icash_shared_learning_winner('seller_calls','reviewed','*',$1)",[choices]),choices[0]);
 const first=await assign('stable-new');
 const evidenceId=await v("select learning_decision_id from icash_learning_assignments where subject='stable-new'");
 const decisionBefore=await v('select to_jsonb(d) from icash_learning_policy_private.decisions d where id=$1',[evidenceId]);
 assert.equal(await v("select icash_record_learning_decision('seller_calls','reviewed','*',$1,$2,false)",[await stats(),choices]),evidenceId,'Identical evidence reuses its immutable decision receipt');
 await db.exec(`select icash_assign_shared_learning(md5('policy-account-'||a)::uuid,'seller_calls','new-'||n,'reviewed','*') from generate_series(1,100) a cross join generate_series(1,50) n;`);
 const groups=(await q(`select learning_selection_mode mode,count(*)::int n,count(distinct account_id)::int accounts,
  count(*) filter(where variant='cash_interest')::int winners from icash_learning_assignments where subject like 'new-%' group by learning_selection_mode`)).rows;
 const control=groups.find(g=>g.mode==='control'),learned=groups.find(g=>g.mode==='shared'),explore=groups.find(g=>g.mode==='explore');
 assert(control.accounts>=10&&control.accounts<=30&&control.n===control.accounts*50,'The stable comparison cohort remains account-bound across subjects');
 assert(control.winners/control.n>0.4&&control.winners/control.n<0.6,'Control assignments remain balanced exploration');
 assert.equal(learned.winners,learned.n);assert.equal(explore.winners,0,'Non-control exploratory slots retain the challenger');
 assert(learned.n/(learned.n+explore.n)>0.55&&learned.n/(learned.n+explore.n)<0.65,'Learned allocation stays near its bounded60% policy over5000prospective assignments');
 await assert.rejects(q("update icash_learning_assignments set variant='changed' where subject='stable-new'"),/immutable/);
 await db.exec("update icash_learning_rollups set positive=case variant when 'cash_interest' then 10 else 80 end;");
 assert.deepEqual(await assign('stable-new'),first,'Reversed evidence cannot rotate an assigned conversation');
 assert.deepEqual(await v('select to_jsonb(d) from icash_learning_policy_private.decisions d where id=$1',[evidenceId]),decisionBefore);
 await q('insert into icash_live_conversations(id,account_id,screening_id) values($1,$2,$3)',[id(2),id(1),id(3)]);
 assert.equal(await assign(id(3)+':already-called'),null,'Historical conversations are not retroactively assigned');
 await q('insert into icash_deal_files(id,account_id) values($1,$2)',[id(4),id(1)]);
 await q('insert into icash_buyer_search_receipts(deal_id,revision,page) values($1,$2,1)',[id(4),id(5)]);
 assert.equal(await v("select icash_assign_shared_learning($1,'buyer_search',$2,'order-v1','75217')",[id(1),id(4)+':'+id(5)]),null,'Existing buyer cursor cannot be relabelled');
 await assert.rejects(assign('unreviewed',id(1),'arbitrary'),/Unreviewed learning policy/);
 await db.exec("update icash_learning_rollups set opted_out=10;");
 await db.exec(`create table fixture_hold_receipts(decision_id bigint,account_id uuid,subject text);
 create function icash_record_learning_policy_hold(bigint,uuid,text) returns void language sql as $$insert into public.fixture_hold_receipts values($1,$2,$3)$$;`);
 const held=await assign('all-unsafe');assert.deepEqual(held,{held:true,reason:'learning_safety_hold'});
 assert.deepEqual((await q('select account_id,subject from fixture_hold_receipts')).rows,[{account_id:id(1),subject:'all-unsafe'}],'Only actual held allocation records the exact source receipt');
 assert.equal(await v('select count(*)::int from icash_operation_spend'),0,'Learning decisions never reserve or create paid work');
 assert.equal(await v("select count(*)::int from icash_learning_assignments where subject='all-unsafe'"),0,'A safety hold creates no assignment');
 const input={account:id(1),domain:'seller_calls',subject:'held',context:'reviewed',market:'*'};
 await assert.rejects(assignSharedLearning(async()=>held,input),SharedLearningSafetyHold,'Application cannot mistake an explicit safety hold for historical baseline fallback');
 assert.equal(await assignSharedLearning(async()=>null,input),null,'Historical absence keeps its separate existing behavior');
 await db.exec(actualStatsDefinition);
 const emptyReceipt=()=>v("select icash_record_learning_decision('seller_sms','identity-v5','*','[]',array['identity_cash_v5'],false)");
 const beforeEpoch=await emptyReceipt();assert.equal(await emptyReceipt(),beforeEpoch,'Identical empty-cohort snapshots deduplicate within their epoch');
 await db.exec("update icash_learning_policy_private.settings set evidence_after=evidence_after+interval '1 microsecond';");
 const afterEpoch=await emptyReceipt();assert.notEqual(afterEpoch,beforeEpoch,'Same-hour cutover cannot reuse a prior evidence generation');
 await db.exec("update icash_learning_policy_private.settings set release_sha=repeat('b',40);");
 assert.notEqual(await emptyReceipt(),afterEpoch,'Same-hour release changes cannot reuse previous-release decisions');
 await db.exec("update icash_learning_rollups set updated_at=now()-interval '7 hours';");assert.deepEqual(await stats(),[],'Stale observations cannot promote');
 await db.exec("update icash_learning_rollups set updated_at=now();update icash_learning_policy_private.settings set evidence_after=now()+interval '1 minute';");assert.deepEqual(await stats(),[],'Pre-correction cached aggregates remain unavailable until refreshed');
 console.log(`PASS evidence-v2: ${parityCases} SQL/TS scenarios, real source gates, synthetic full-cost allocation,5000prospective assignments, stable control/history, immutable receipts, safety holds and private permissions.`);
}catch(e){console.error(e.message,e.where??'');process.exitCode=1;}finally{await db.close();}
