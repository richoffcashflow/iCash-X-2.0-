import assert from 'node:assert/strict';
import {evaluateMarket,allocateMarkets} from '../lib/market-brain.ts';
import {launchMarketCandidates} from '../config/launch-market-candidates.ts';
const now=Date.now(),m={marketId:'fixture',zip:'75201',verified:true,settlementType:'suburban',jurisdictionApprovedUntil:now+10000,channelReady:true,dataRightsUntil:now+10000,updatedAt:now,accounts:0,capacity:5000,availableOwners:5000,attempts:1000,connected:400,contacted:500,responded:200,qualified:80,contracts:10,closed:4,optOuts:1,costMicros:1000000000,costsComplete:true,mature:true,tenantCount:5};
assert.equal(launchMarketCandidates.length,50);assert.equal(new Set(launchMarketCandidates.map(x=>x.id)).size,50);assert(launchMarketCandidates.every(x=>!x.enabled));
assert.equal(evaluateMarket(m,now).status,'measured');assert.equal(evaluateMarket({...m,closed:0,contracts:0},now).status,'trial');assert.equal(evaluateMarket({...m,accounts:5000},now).reason,'capacity');assert.equal(evaluateMarket({...m,optOuts:50},now).reason,'outreach_review');assert.equal(evaluateMarket({...m,tenantCount:1},now).status,'trial');
const p=allocateMarkets([{...m,marketId:'a'},{...m,marketId:'a',zip:'75202'},{...m,marketId:'b',mature:false}],1000,now);assert.equal(p.allocations.filter(x=>x.marketId==='a').reduce((a,x)=>a+x.accounts,0),100);assert.equal(p.assigned,200);assert.equal(p.waitlisted,800);assert.equal(p.dispatchAuthorized,false);
assert.equal(allocateMarkets([{...m,mature:false}],1000,now).assigned,100);assert.throws(()=>allocateMarkets([m,m],100,now));
console.log('Market evidence, privacy threshold, cold-start trials, per-market capacity and waitlist checks passed');

assert.equal(evaluateMarket({...m,settlementType:'rural'},now).reason,'geography_review');assert.equal(evaluateMarket({...m,jurisdictionApprovedUntil:0},now).reason,'jurisdiction_review');
