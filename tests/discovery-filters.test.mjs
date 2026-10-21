import assert from 'node:assert/strict';
import {discoveryStrategies,discoveryFilters,selectDiscoveryFilter,discoveryFilterVersion,discoveryInterestScore} from '../lib/discovery-filters.ts';
import {discoverPage} from '../lib/discovery-pipeline.ts';
const stats=()=>discoveryStrategies.map(strategy=>({strategy,nextPage:1,exhausted:false,pages:0,attempted:0,pendingAttempts:0,recentUnproductivePages:0,matureAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true}));
let s=stats(),seen=[];
for(let sequence=1;sequence<=40;sequence++){
 const p=selectDiscoveryFilter(s,sequence);seen.push(p.strategy);assert.equal(p.mode,'explore');
 const arm=s.find(x=>x.strategy===p.strategy);assert.equal(p.providerPage,arm.nextPage);arm.nextPage++;arm.pages++;
}
assert.deepEqual(s.map(x=>x.pages),[10,10,10,10],'Cold start balances all four groups');
// Evidence arrives independently. A slow arm must not freeze useful learning.
s=stats().map(x=>({...x,pages:2,attempted:30,matureAttempts:30,interested:3,costCents:3000}));s[1].interested=9;
for(const sequence of [5,6,7]){const p=selectDiscoveryFilter(s,sequence);assert.equal(p.strategy,'vacant');assert.equal(p.mode,'learned');}
for(const sequence of [8,9])assert.equal(selectDiscoveryFilter(s,sequence).mode,'explore');
s[2].costsComplete=false;assert.equal(selectDiscoveryFilter(s,5).strategy,'vacant','Another arm cannot block a fully settled winner');
s[1].costsComplete=false;assert.notEqual(selectDiscoveryFilter(s,5).strategy,'vacant','Unknown winner costs cannot earn promotion');s[1].costsComplete=true;
s[1].optedOut=21;assert.notEqual(selectDiscoveryFilter(s,5).strategy,'vacant','Opt-outs penalize the winner');
s=stats().map(x=>({...x,pages:2}));Object.assign(s[1],{attempted:10,interested:3,pendingAttempts:7,costCents:1000});
for(const sequence of [5,6])assert.equal(selectDiscoveryFilter(s,sequence).mode,'learned','Confirmed same-day interest can earn limited promotion');
for(const sequence of [7,8,9])assert.equal(selectDiscoveryFilter(s,sequence).mode,'explore','Small samples retain 60% exploration');
s[1].interested=1;s[1].pendingAttempts=9;assert.equal(selectDiscoveryFilter(s,5).mode,'explore','One lucky reply cannot win');
s[1].interested=3;s[1].pendingAttempts=7;s[0].pages=0;assert.equal(selectDiscoveryFilter(s,5).strategy,'baseline','Every available arm receives an initial batch');
s=stats().map(x=>({...x,pages:2,attempted:40,matureAttempts:40,interested:5,costCents:4000}));s[1].costCents=2000;
assert.equal(selectDiscoveryFilter(s,5).strategy,'vacant','Equal interest at lower actual cost wins');
const cautious={...s[0],attempted:200,interested:26,optedOut:0,costCents:1000};
assert(Math.abs(discoveryInterestScore(cautious)*2000/200-0.09577)<0.00001,'Wilson endpoint matches the NIST worked example');
assert(discoveryInterestScore({...s[0],attempted:10,interested:3,costCents:1000})<discoveryInterestScore({...s[0],attempted:30,interested:9,costCents:3000}),'Evidence shrinkage prevents a small perfect-looking group from dominating');
// Repeated duplicate/no-owner searches earn periodic probes, not retirement.
s=stats().map(x=>({...x,pages:3}));s[1].recentUnproductivePages=3;
let cooled=0;
for(let sequence=1;sequence<=50;sequence++){
 const p=selectDiscoveryFilter(s,sequence);if(p.strategy==='vacant')cooled++;
 const arm=s.find(x=>x.strategy===p.strategy);arm.pages++;arm.nextPage++;
}
assert.equal(cooled,10,'Cooled groups share one in five probe slots');
s.forEach(x=>x.recentUnproductivePages=3);assert(selectDiscoveryFilter(s,3),'All cooled is still searchable');
s[1].recentUnproductivePages=0;assert.equal(selectDiscoveryFilter(s,3).strategy,'vacant','A productive probe immediately restores exploration');
s=stats();s[0].exhausted=true;assert.notEqual(selectDiscoveryFilter(s,4).strategy,'baseline');
s.forEach(x=>x.exhausted=true);assert.equal(selectDiscoveryFilter(s,1),null);
for(const malformed of [null,[],stats().slice(1),[stats()[0],...stats().slice(0,3)],stats().map(x=>({...x,costCents:NaN})),stats().map(x=>({...x,interested:1})),stats().map(x=>({...x,attempted:10,matureAttempts:8,pendingAttempts:3})),stats().map(x=>({...x,recentUnproductivePages:4})),stats().map(x=>({...x,attempted:10,pendingAttempts:8,interested:3}))])assert.throws(()=>selectDiscoveryFilter(malformed,1),/INVALID/);
for(const [strategy,extra] of [['baseline',null],['vacant','is_vacant_home'],['absentee','has_absentee_owners'],['repairs','estimated_repair_cost']]){
 const filters=discoveryFilters(strategy);assert.equal(filters[0].filter_id,'property_type');assert.equal(filters[1].value,70);assert.equal(filters.at(-1).filter_id,extra??'estimated_equity_percentage');
 const plan={version:discoveryFilterVersion,strategy,providerPage:7,mode:'explore'},calls=[];let saved;
 await discoverPage({zip:'75217',page:40,perPage:5,unitCostMicros:10000,quotedDataCostMicros:50000,filterPlan:plan},{
 request:async body=>{calls.push(body);return body.estimate_cost?{estimated_credits:{this_page:1,breakdown:{people:0}}}:{data:[],credits:{used:0,people:0},pagination:{has_next_page:true}};},reserveAndClaim:async()=>true,persist:async r=>{saved=r;}});
 assert.equal(calls[0].page,7,'Provider cursor is independent of operation sequence');assert.deepEqual({...calls[0],estimate_cost:false},calls[1]);assert.deepEqual(saved.filterPlan,plan);
}
console.log('Filter cohorts: balanced exploration, same-day learning, delayed outcomes, cost/opt-out scoring, bounded cooling, independent cursors and identical estimated/paid inputs passed.');
