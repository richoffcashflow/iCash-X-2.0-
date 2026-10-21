import assert from 'node:assert/strict';
import {discoveryStrategies,discoveryFilters,selectDiscoveryFilter,discoveryFilterVersion} from '../lib/discovery-filters.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
const stats=()=>discoveryStrategies.map(strategy=>({strategy,nextPage:1,exhausted:false,pages:0,matureAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true}));
let s=stats(),seen=[];
for(let sequence=1;sequence<=40;sequence++){
 const p=selectDiscoveryFilter(s,sequence);seen.push(p.strategy);assert.equal(p.mode,'explore');
 const arm=s.find(x=>x.strategy===p.strategy);assert.equal(p.providerPage,arm.nextPage);arm.nextPage++;arm.pages++;
}
assert.deepEqual(s.map(x=>x.pages),[10,10,10,10],'Cold start balances all four groups');
s=stats().map(x=>({...x,matureAttempts:30,interested:3,costCents:3000}));s[1].interested=9;
for(const sequence of [5,6,7]){const p=selectDiscoveryFilter(s,sequence);assert.equal(p.strategy,'vacant');assert.equal(p.mode,'learned');}
for(const sequence of [8,9])assert.equal(selectDiscoveryFilter(s,sequence).mode,'explore');
s[2].costsComplete=false;assert.equal(selectDiscoveryFilter(s,5).mode,'explore','Unsettled spend cannot select a winner');s[2].costsComplete=true;
s[2].matureAttempts=29;assert.equal(selectDiscoveryFilter(s,5).mode,'explore','Do not promote tiny samples');s[2].matureAttempts=30;
s[1].optedOut=30;assert.notEqual(selectDiscoveryFilter(s,5).strategy,'vacant','Opt-outs penalize the winner');
s=stats();s[0].exhausted=true;assert.notEqual(selectDiscoveryFilter(s,4).strategy,'baseline');
s.forEach(x=>x.exhausted=true);assert.equal(selectDiscoveryFilter(s,1),null);
for(const malformed of [null,[],stats().slice(1),[stats()[0],...stats().slice(0,3)],stats().map(x=>({...x,costCents:NaN})),stats().map(x=>({...x,interested:1}))])assert.throws(()=>selectDiscoveryFilter(malformed,1),/INVALID/);
for(const [strategy,extra] of [['baseline',null],['vacant','is_vacant_home'],['absentee','has_absentee_owners'],['repairs','estimated_repair_cost']]){
 const filters=discoveryFilters(strategy);assert.equal(filters[0].filter_id,'property_type');assert.equal(filters[1].value,70);assert.equal(filters.at(-1).filter_id,extra??'estimated_equity_percentage');
 const plan={version:discoveryFilterVersion,strategy,providerPage:7,mode:'explore'},calls=[];let saved;
 await discoverPage({zip:'75217',page:40,perPage:5,unitCostMicros:10000,quotedDataCostMicros:50000,filterPlan:plan},{
 request:async body=>{calls.push(body);return body.estimate_cost?{estimated_credits:{this_page:1,breakdown:{people:0}}}:{data:[],credits:{used:0,people:0},pagination:{has_next_page:true}};},reserveAndClaim:async()=>true,persist:async r=>{saved=r;}});
 assert.equal(calls[0].page,7,'Provider cursor is independent of operation sequence');assert.deepEqual({...calls[0],estimate_cost:false},calls[1]);assert.deepEqual(saved.filterPlan,plan);
}
console.log('Filter cohorts: balanced exploration, mature samples, cost/opt-out scoring, independent cursors and identical estimated/paid inputs passed.');
