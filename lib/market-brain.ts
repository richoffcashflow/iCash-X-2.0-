/** Aggregate operational metrics only. No tenant identities or seller contact details. */
export type MarketEvidence={marketId:string;zip:string;verified:boolean;settlementType:'urban'|'suburban'|'rural'|'unknown';jurisdictionApprovedUntil:number;channelReady:boolean;dataRightsUntil:number;updatedAt:number;accounts:number;capacity:number;availableOwners:number;attempts:number;connected:number;contacted:number;responded:number;qualified:number;contracts:number;closed:number;optOuts:number;costMicros:number;costsComplete:boolean;mature:boolean;tenantCount:number};
export const marketBrainPolicy={version:'1',launchMarketLimit:50,minAttempts:100,minContracts:5,minClosed:3,minAggregateTenants:5,maxOptOutRate:.05,evidenceMaxAgeMs:86400000,explorationShare:.1,maxMarketShare:.1};
function lowerBound(success:number,total:number){if(!total)return 0;const z=1.96,p=success/total;return (p+z*z/(2*total)-z*Math.sqrt((p*(1-p)+z*z/(4*total))/total))/(1+z*z/total);}
export function evaluateMarket(m:MarketEvidence,now=Date.now()){
 const counts=[m.accounts,m.capacity,m.availableOwners,m.attempts,m.connected,m.contacted,m.responded,m.qualified,m.contracts,m.closed,m.optOuts,m.costMicros,m.tenantCount];
 if(!Number.isFinite(now)||counts.some(n=>!Number.isSafeInteger(n)||n<0)||!Number.isFinite(m.updatedAt)||!Number.isFinite(m.dataRightsUntil)||!/^\d{5}$/.test(m.zip)||!m.marketId||m.connected>m.attempts||m.contacted>m.attempts||[m.responded,m.qualified,m.contracts,m.closed,m.optOuts].some(n=>n>m.contacted)||m.closed>m.contracts)throw new Error('Invalid market evidence');
 const rates={answer:m.attempts?m.connected/m.attempts:null,response:m.contacted?m.responded/m.contacted:null,contract:m.contacted?m.contracts/m.contacted:null,closed:m.contacted?m.closed/m.contacted:null};
 const hold=!m.verified?'market_review':!['urban','suburban'].includes(m.settlementType)?'geography_review':!Number.isFinite(m.jurisdictionApprovedUntil)||m.jurisdictionApprovedUntil<=now?'jurisdiction_review':!m.channelReady?'channel_not_ready':m.dataRightsUntil<=now?'data_rights':m.updatedAt>now||now-m.updatedAt>marketBrainPolicy.evidenceMaxAgeMs?'stale_evidence':m.accounts>=m.capacity?'capacity':m.availableOwners===0?'inventory':m.contacted>0&&m.optOuts/m.contacted>marketBrainPolicy.maxOptOutRate?'outreach_review':null;
 const proven=m.mature&&m.costsComplete&&m.costMicros>0&&m.attempts>=marketBrainPolicy.minAttempts&&m.contracts>=marketBrainPolicy.minContracts&&m.closed>=marketBrainPolicy.minClosed&&m.tenantCount>=marketBrainPolicy.minAggregateTenants;
 // Conservative outcome yield per $ of observed cost; answers alone cannot make a winner.
 const quality=.7*lowerBound(m.closed,m.contacted)+.25*lowerBound(m.contracts,m.contacted)+.05*lowerBound(m.qualified,m.contacted);
 const costPerContact=m.contacted?m.costMicros/1e6/m.contacted:0;
 const score=proven&&costPerContact>0?quality/costPerContact:0;
 return {marketId:m.marketId,zip:m.zip,rates,score,status:hold?'held' as const:proven?'measured' as const:'trial' as const,reason:hold,slots:Math.max(0,Math.min(m.capacity-m.accounts,m.availableOwners)),costPerContractMicros:m.costsComplete&&m.contracts?m.costMicros/m.contracts:null,costPerClosedMicros:m.costsComplete&&m.closed?m.costMicros/m.closed:null};
}
/** Planning only. Never dispatches paid work or treats allocations as vendor authorization. */
export function allocateMarkets(markets:MarketEvidence[],requestedAccounts:number,now=Date.now()){
 if(!Number.isSafeInteger(requestedAccounts)||requestedAccounts<0)throw new Error('Invalid capacity request');
 const keys=new Set<string>();for(const m of markets){const k=m.marketId+':'+m.zip;if(keys.has(k))throw new Error('Duplicate market ZIP');keys.add(k);}
 const ranked=markets.map(m=>evaluateMarket(m,now)).filter(m=>m.status!=='held').sort((a,b)=>b.score-a.score||a.marketId.localeCompare(b.marketId)||a.zip.localeCompare(b.zip));
 const selectedIds=[...new Set(ranked.map(m=>m.marketId))].slice(0,marketBrainPolicy.launchMarketLimit);
 const eligible=ranked.filter(m=>selectedIds.includes(m.marketId));
 const measured=eligible.filter(m=>m.status==='measured'),trial=eligible.filter(m=>m.status==='trial');
 const allocations:{marketId:string;zip:string;accounts:number;mode:'measured'|'trial'}[]=[];const used=new Map<string,number>();
 const cap=Math.max(1,Math.floor(requestedAccounts*marketBrainPolicy.maxMarketShare));
 // Cold start: only a bounded trial cohort, not the full requested population.
 const trialBudget=Math.floor(requestedAccounts*marketBrainPolicy.explorationShare);
 function assign(rows:typeof eligible,budget:number){let count=0;for(const m of rows){const n=Math.min(m.slots,cap-(used.get(m.marketId)??0),budget-count);if(n<=0)continue;allocations.push({marketId:m.marketId,zip:m.zip,accounts:n,mode:m.status as 'measured'|'trial'});used.set(m.marketId,(used.get(m.marketId)??0)+n);count+=n;if(count>=budget)break;}return count;}
 const trials=assign(trial,trialBudget);const assigned=trials+assign(measured,requestedAccounts-trials);
 return {policyVersion:marketBrainPolicy.version,allocations,assigned,waitlisted:requestedAccounts-assigned,dispatchAuthorized:false as const};
}
