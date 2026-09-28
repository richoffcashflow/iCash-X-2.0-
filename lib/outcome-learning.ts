/** Evidence comes from private persisted records, never demo activity or client claims. */
export type LearningCohort={account_id:string;deal_id:string;mode:'test'|'live';strategy_key:string;market:string;channel:string;assigned_at:string};
export type LearningEvent={account_id:string;deal_id:string;event_key:string;operation_id:string;kind:'attempt'|'connected'|'response'|'qualified'|'offer'|'contract'|'closed'|'opt_out'|'cost';occurred_at:string;provider_cost_micros:number};
export const learningPolicy={maturityDays:90,minContacted:100,minContracts:5,minClosed:3,maxOptOutRate:0.05,maxSuggestedShift:0.1};
export function summarizeOutcomes(accountId:string,cohorts:LearningCohort[],events:LearningEvent[],now:number,policy=learningPolicy){
 if(!accountId || !Number.isFinite(now) || !Number.isSafeInteger(policy.maturityDays) || policy.maturityDays<1 || ![policy.minContacted,policy.minContracts,policy.minClosed].every(n=>Number.isSafeInteger(n)&&n>0) || ![policy.maxOptOutRate,policy.maxSuggestedShift].every(n=>Number.isFinite(n)&&n>=0&&n<=1))throw new Error('Invalid learning policy');
 if(cohorts.some(c=>c.account_id!==accountId)||events.some(e=>e.account_id!==accountId))throw new Error('Mixed tenant learning input');
 const groups=new Map<string,LearningCohort[]>();
 const ids=new Set<string>();
 for(const c of cohorts){
  if(ids.has(c.deal_id))throw new Error('Duplicate cohort assignment');ids.add(c.deal_id);
  const assigned=Date.parse(c.assigned_at);
  if(!Number.isFinite(assigned))throw new Error('Invalid cohort date');
  if(c.mode!=='live'||assigned>now)continue;
  const key=JSON.stringify([c.strategy_key,c.market,c.channel,new Date(assigned).toISOString().slice(0,7)]);groups.set(key,[...(groups.get(key)??[]),c]);
 }
 return [...groups].map(([key,cs])=>{
  const eligible=new Map(cs.map(c=>[c.deal_id,Date.parse(c.assigned_at)]));
  const seen=new Set<string>();const operations=new Set<string>();
  const es=events.filter(e=>{
   const at=Date.parse(e.occurred_at),assigned=eligible.get(e.deal_id);
   if(!Number.isFinite(at)||!Number.isSafeInteger(e.provider_cost_micros)||e.provider_cost_micros<0)throw new Error('Invalid outcome');
   if(assigned===undefined||at<assigned||at>now)return false;
   const op=JSON.stringify([e.operation_id,e.kind]);
   if(seen.has(e.event_key)||operations.has(op))return false;
   seen.add(e.event_key);operations.add(op);return true;
  });
  const attempted=es.filter(e=>e.kind==='attempt');
  const contacted=new Set(attempted.map(e=>e.deal_id));
  const count=(kind:LearningEvent['kind'])=>new Set(es.filter(e=>e.kind===kind&&contacted.has(e.deal_id)).map(e=>e.deal_id)).size;
  const responded=count('response'),qualified=count('qualified'),contracts=count('contract'),closed=count('closed'),optOuts=count('opt_out');
  const attempts=new Set(attempted.map(e=>e.operation_id));
  const connected=new Set(es.filter(e=>e.kind==='connected'&&attempts.has(e.operation_id)).map(e=>e.operation_id)).size;
  const costs=es.filter(e=>e.kind==='cost');const cost=costs.reduce((s,e)=>s+e.provider_cost_micros,0);
  if(!Number.isSafeInteger(cost))throw new Error('Cost overflow');
  const billed=new Set(costs.map(e=>e.operation_id));
  const attemptCostsComplete=[...attempts].every(id=>billed.has(id));
  const rate=(n:number,d:number)=>d?n/d:null;
  const mature=cs.every(c=>now-Date.parse(c.assigned_at)>=policy.maturityDays*86400000);
  const enough=contacted.size>=policy.minContacted&&contracts>=policy.minContracts&&closed>=policy.minClosed;
  const optOutRate=rate(optOuts,contacted.size);
  const recommendation=optOutRate!==null&&optOutRate>policy.maxOptOutRate?'review_outreach':mature&&enough&&attemptCostsComplete?'eligible_for_controlled_test':'collect_evidence';
  return {key,strategy:cs[0].strategy_key,market:cs[0].market,channel:cs[0].channel,contacted:contacted.size,attempts:attempts.size,connected,responded,qualified,offers:count('offer'),contracts,closed,optOuts,responseRate:rate(responded,contacted.size),connectionRate:rate(connected,attempts.size),contractRate:rate(contracts,contacted.size),closedDealRate:rate(closed,contacted.size),optOutRate,providerCostMicros:cost,attemptCostsComplete,costPerQualifiedMicros:rate(cost,qualified),costPerContractMicros:rate(cost,contracts),costPerClosedDealMicros:rate(cost,closed),mature,recommendation,maxSuggestedShift:recommendation==='eligible_for_controlled_test'?policy.maxSuggestedShift:0};
 });
}
