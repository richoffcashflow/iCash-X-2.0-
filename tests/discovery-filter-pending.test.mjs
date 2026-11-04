import assert from 'node:assert/strict';
import {discoveryStrategies,selectDiscoveryFilter,discoveryInterestScore} from '../lib/discovery-filters.ts';
import {learningTrials} from '../lib/shared-learning.ts';
const local=discoveryStrategies.map(strategy=>({strategy,nextPage:1,exhausted:false,pages:2,attempted:0,pendingAttempts:0,recentUnproductivePages:0,matureAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true}));
const arm=(variant,positive)=>({variant,contributors:4,attempts:100,pending:0,positive,opted_out:0,contract_trials:0,contracts:0,closing_trials:0,closings:0,cost_cents:10000,costs_complete:true,updated_at:new Date().toISOString(),effective_attempts:100,effective_pending:0,effective_positive:positive,effective_opted_out:0,effective_contract_trials:0,effective_contracts:0,effective_closing_trials:0,effective_closings:0,effective_cost_cents:10000});
const pending=(s,n)=>({...s,attempts:s.attempts+n,pending:s.pending+n,effective_attempts:s.effective_attempts+n,effective_pending:s.effective_pending+n});
const selected=arms=>selectDiscoveryFilter(local,5,arms);
for(const objective of ['positive','contracts','closings']){
 const evidence=[arm('baseline',80),arm('vacant',20),arm('absentee',10),arm('repairs',5)];
 if(objective!=='positive')for(const s of evidence){
  s.contract_trials=s.effective_contract_trials=100;s.contracts=s.effective_contracts=s.positive;
  if(objective==='closings'){s.closing_trials=s.effective_closing_trials=100;s.closings=s.effective_closings=s.positive;}
 }
 assert.equal(selected(evidence).strategy,'baseline');
 const waiting=evidence.map(s=>s.variant==='vacant'?pending(s,1000):s);
 assert.equal(learningTrials(waiting[1],objective),learningTrials(evidence[1],objective),'Pending attempts do not alter the objective trial denominator');
 assert.equal(selected(waiting).mode,'learned');
 assert.equal(selected(waiting).strategy,'baseline',`${objective}: unresolved attempts cannot inflate the confidence-adjusted reward numerator`);
 assert.equal(selected(waiting.map(s=>({...s,costs_complete:false}))).mode,'explore','Unknown costs still prevent shared audience promotion');
}
const tied=discoveryStrategies.map(s=>arm(s,50));
assert.equal(selected(tied).mode,'explore','An inconclusive shared comparison cannot fall through to the old shared yield heuristic');
const unsafe=tied.map(s=>s.variant==='vacant'?{...s,opted_out:10,effective_opted_out:10}:s);
for(let sequence=1;sequence<=20;sequence++)assert.notEqual(selectDiscoveryFilter(local,sequence,unsafe)?.strategy,'vacant','Unsafe shared audience remains excluded from exploratory slots');
assert.equal(selected(tied.map(s=>({...s,opted_out:10,effective_opted_out:10}))),null,'All shared audiences held means no new research selection');
const mature=local.map(s=>({...s,attempted:300,matureAttempts:300,interested:s.strategy==='baseline'?180:30,costCents:30000}));
assert.equal(selectDiscoveryFilter(mature,5).strategy,'baseline');
assert.equal(Array.from({length:50},(_,i)=>selectDiscoveryFilter(mature,i+1)).filter(p=>p.strategy==='baseline').length,30,'A local winner receives exactly three of five slots, excluding challenger allocation');
const cooled=mature.map(s=>s.strategy==='repairs'?{...s,recentUnproductivePages:3}:s);
const cooledPlans=Array.from({length:50},(_,i)=>selectDiscoveryFilter(cooled,i+1));
assert.equal(cooledPlans.filter(p=>p.strategy==='baseline').length,30);
assert.equal(cooledPlans.filter(p=>p.strategy==='repairs').length,10,'Existing one-in-five cooled audience probes remain bounded');
const sharedPlans=Array.from({length:50},(_,i)=>selectDiscoveryFilter(local,i+1,[arm('baseline',80),arm('vacant',20),arm('absentee',10),arm('repairs',5)]));
assert.equal(sharedPlans.filter(p=>p.strategy==='baseline').length,30,'A shared winner cannot leak into exploratory challenger slots');
const localPending=mature.map(s=>s.strategy==='vacant'?{...s,attempted:1300,pendingAttempts:1000}:s);
assert.equal(discoveryInterestScore(localPending[1]),discoveryInterestScore(mature[1]),'Pending local trials do not add resolved interest yield');
assert.equal(selectDiscoveryFilter(localPending,5).strategy,'baseline');
assert.equal(selectDiscoveryFilter(mature.map(s=>({...s,attempted:99,matureAttempts:99,interested:s.strategy==='baseline'?80:5})),5).mode,'explore','Local allocation requires 100 resolved trials per compared audience');
assert.equal(selectDiscoveryFilter(mature.map(s=>({...s,interested:s.strategy==='baseline'?9:5,costCents:s.strategy==='baseline'?1000:30000})),5).mode,'explore','Nine cheap local interests cannot bypass the ten-positive requirement');
assert.equal(selectDiscoveryFilter(mature.map(s=>({...s,interested:150})),5).mode,'explore','Overlapping local confidence bounds retain exploration');
console.log('Shared audience scoring: pending attempts cannot reverse positive, contract or closing allocation; original cost gating remains.');
