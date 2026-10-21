import assert from 'node:assert/strict';
import {selectDiscoveryFilter,discoveryStrategies} from '../lib/discovery-filters.ts';
import {sharedLearningWinner,sharedLearningStats} from '../lib/shared-learning.ts';
import {nextBuyerSearch} from '../lib/buyer-discovery.ts';
const local=discoveryStrategies.map(strategy=>({strategy,nextPage:1,exhausted:false,pages:0,attempted:0,matureAttempts:0,pendingAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true,recentUnproductivePages:0}));
const evidence=(variant,positive)=>({variant,contributors:3,attempts:300,pending:0,positive,opted_out:0,contract_trials:0,contracts:0,closing_trials:0,closings:0,cost_cents:30000,costs_complete:true,updated_at:new Date().toISOString(),effective_attempts:300,effective_pending:0,effective_positive:positive,effective_opted_out:0,effective_contract_trials:0,effective_contracts:0,effective_closing_trials:0,effective_closings:0,effective_cost_cents:30000});
const shared=[evidence('baseline',25),evidence('vacant',150),evidence('absentee',40),evidence('repairs',20)];
assert.equal(selectDiscoveryFilter(local,1,shared).strategy,'vacant','New accounts benefit without first accumulating their own sample');
assert.equal(selectDiscoveryFilter(local,1,shared).providerPage,1,'Peer cursors never transfer');
assert.equal(selectDiscoveryFilter(local,3,shared).mode,'explore');assert.equal(selectDiscoveryFilter(local,4,shared).mode,'explore');
assert.notEqual(selectDiscoveryFilter(local.map(s=>s.strategy==='vacant'?{...s,exhausted:true}:s),1,shared).strategy,'vacant');
assert.notEqual(selectDiscoveryFilter(local.map(s=>s.strategy==='vacant'?{...s,recentUnproductivePages:3,pages:3}:s),1,shared).strategy,'vacant','Local duplicate waste still cools a globally successful arm');
assert.equal(selectDiscoveryFilter(local,1,shared.map(s=>({...s,costs_complete:false}))).mode,'explore');
assert.equal(selectDiscoveryFilter(local,1,shared.map(s=>({...s,contributors:2}))).mode,'explore');
assert.equal(sharedLearningStats([{...shared[0],effective_contracts:2,effective_contract_trials:1}]).length,0);
const contracts=shared.slice(0,2).map((s,i)=>({...s,contract_trials:300,contracts:i===0?60:10,effective_contract_trials:300,effective_contracts:i===0?60:10}));
assert.equal(sharedLearningWinner(contracts,['baseline','vacant']).variant,'baseline','Verified mature contracts take priority over reply volume');
assert.equal(selectDiscoveryFilter(local,1,contracts).strategy,'baseline');
assert.equal(sharedLearningWinner(shared.slice(0,2),['baseline','vacant'],true),null,'Recovery cannot promote on replies alone');
for(const first of ['recent_corporate','corporate_owners']){
 const second=first==='recent_corporate'?'corporate_owners':'recent_corporate';
 assert.deepEqual(nextBuyerSearch(undefined,5,first),{page:1,providerPage:1,strategy:first});
 assert.deepEqual(nextBuyerSearch({page:1,has_next_page:false,receipt:{learningVersion:'shared-v1',firstStrategy:first,strategy:first,providerPage:1}},5,first),{page:2,providerPage:1,strategy:second});
 assert.equal(nextBuyerSearch({page:2,has_next_page:false,receipt:{learningVersion:'shared-v1',firstStrategy:first,strategy:second,providerPage:1}},5,first),null);
 assert.throws(()=>nextBuyerSearch({page:1,has_next_page:true,receipt:{}},5,first),/REVIEW_REQUIRED/);
}
console.log('Shared learning policy: cold start, local gates, bounded exploration, missing evidence, outcome priority and stable buyer sequences passed.');
