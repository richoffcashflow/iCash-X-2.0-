import {summarizeBuyerFunnel} from './buyer-funnel-evidence.ts';
import type {LearningReportRecords,ObservedEnvelope} from './deal-learning-report.ts';

export type CohortText={id:string;account_id:string;thread_id:string;direction:string;state:string;provider_id:string|null;created_at:string};
export type CohortThread={id:string;account_id:string;deal_id:string;party:string};
export type CohortSupplement={complete:boolean;offers:{dealId:string;at:string;quoted:boolean;accepted:boolean;deliveredAt:string|null}[];
 costs:{dealId:string;startedAt:string;windowDays:number;costs:{complete?:boolean;costCents?:number;providerCostsComplete?:boolean}}[]};
const inWindow=(at:string,from:number,to:number)=>Number.isFinite(Date.parse(at))&&Date.parse(at)>=from&&Date.parse(at)<=to;

/** One denominator per reached deal, held fixed through a full observation
 * window. No comparing independently sampled calls, replies and signatures. */
export function dealCohortStarts(records:LearningReportRecords,texts:CohortText[],threads:CohortThread[],now:number){
 const starts=new Map<string,number>(),spend=new Map(records.spend.map(s=>[s.operation_key,s]));
 const deals=new Map(records.deals.filter(d=>d.practice!=='true').map(d=>[d.id,d]));
 const add=(deal:string,at:string|null)=>{const t=Date.parse(at??'');if(deals.has(deal)&&Number.isFinite(t)&&t<=now)starts.set(deal,Math.min(t,starts.get(deal)??Infinity));};
 for(const c of records.calls){const s=spend.get(c.operation_key);if(c.party!=='seller'||!c.conversation_id||!s||!['dispatched','settled'].includes(s.state))continue;
  const matches=[...deals.values()].filter(d=>d.screening_id===c.screening_id);if(matches.length===1)add(matches[0].id,s.dispatched_at);
 }
 const byThread=new Map(threads.filter(t=>t.party==='seller').map(t=>[t.id,t]));
 for(const m of texts){const t=byThread.get(m.thread_id),s=spend.get('text:'+m.id);
  if(t&&m.direction==='outgoing'&&['accepted','delivered'].includes(m.state)&&m.provider_id&&s&&['dispatched','settled'].includes(s.state))add(t.deal_id,s.dispatched_at);
 }
 return [...starts].map(([dealId,at])=>({dealId,startedAt:new Date(at).toISOString()}));
}

export function summarizeDealCohorts(records:LearningReportRecords,verifiedSignings:ObservedEnvelope[],texts:CohortText[],threads:CohortThread[],supplement:CohortSupplement|null,now:number,complete:boolean){
 const starts=dealCohortStarts(records,texts,threads,now),byThread=new Map(threads.filter(t=>t.party==='seller').map(t=>[t.id,t.deal_id]));
 return [30,60].map(windowDays=>{
  const mature=starts.filter(s=>Date.parse(s.startedAt)+windowDays*86400000<=now);
  const totals={sellerReplied:0,offerRecorded:0,offerDelivered:0,offerAccepted:0,purchaseSigned:0,buyerRequested:0,assignmentSigned:0,depositCleared:0,titleOpened:0,closed:0,proceedsReceived:0,receivedProceedsCents:0};
  let costCents=0,costsComplete=complete&&supplement?.complete===true&&mature.length>0;
  for(const lead of mature){
   const from=Date.parse(lead.startedAt),to=from+windowDays*86400000;
   const signings=verifiedSignings.filter(e=>e.deal_id===lead.dealId&&inWindow(e.updated_at,from,to));
   const scoped={...records,
    closings:records.closings?.filter(r=>inWindow(r.created_at,from,to)),
    deposits:records.deposits?.filter(r=>inWindow(r.created_at,from,to)),
    proceeds:records.proceeds?.filter(r=>inWindow(r.created_at,from,to)),
    journeys:records.journeys?.filter(r=>inWindow(r.created_at,from,to)&&inWindow(r.updated_at,from,to)),
   };
   const funnel=summarizeBuyerFunnel(new Set([lead.dealId]),signings,scoped,to);
   if(texts.some(m=>byThread.get(m.thread_id)===lead.dealId&&m.direction==='incoming'&&m.state==='received'&&inWindow(m.created_at,from,to))
    ||records.calls.some(c=>c.party==='seller'&&c.screening_id===records.deals.find(d=>d.id===lead.dealId)?.screening_id&&c.contact_evidence==='human_response'&&c.completed_at&&inWindow(c.completed_at,from,to)
      &&records.spend.some(s=>s.operation_key===c.operation_key&&['dispatched','settled'].includes(s.state)&&s.dispatched_at&&inWindow(s.dispatched_at,from,to))))totals.sellerReplied++;
   const offers=(supplement?.offers??[]).filter(o=>o.dealId===lead.dealId&&inWindow(o.at,from,to));
   if(offers.some(o=>o.quoted))totals.offerRecorded++;
   if(offers.some(o=>o.deliveredAt&&inWindow(o.deliveredAt,from,to)))totals.offerDelivered++;
   if(offers.some(o=>o.accepted))totals.offerAccepted++;
   if(signings.some(e=>e.kind==='purchase'))totals.purchaseSigned++;
   if(signings.some(e=>e.kind==='assignment'))totals.assignmentSigned++;
   totals.buyerRequested+=funnel.buyerRequestDeals??0;totals.depositCleared+=funnel.clearedDepositDeals??0;
   totals.titleOpened+=funnel.titleOpenedDeals??0;totals.closed+=funnel.closedDeals??0;totals.proceedsReceived+=funnel.proceedsReceivedDeals??0;
   totals.receivedProceedsCents+=funnel.receivedProceedsCents??0;
   const cost=supplement?.costs.find(c=>c.dealId===lead.dealId&&Date.parse(c.startedAt)===from&&c.windowDays===windowDays)?.costs;
   if(cost?.complete===true&&Number.isSafeInteger(cost.costCents)&&cost.costCents!>=0)costCents+=cost.costCents!;else costsComplete=false;
  }
  if(!Number.isSafeInteger(costCents)||!Number.isSafeInteger(totals.receivedProceedsCents))throw Error('Cohort money overflow');
  const downstreamComplete=!!records.journeys&&!!records.deposits&&!!records.closings&&!!records.titleReplies&&!!records.proceeds;
  const allSourcesComplete=complete&&supplement?.complete===true&&downstreamComplete;
  return {scope:'same_reached_deals',windowDays,matureLeads:mature.length,immatureLeads:starts.length-mature.length,complete:allSourcesComplete,
   ...totals,
   offerRecorded:supplement?totals.offerRecorded:null,offerDelivered:supplement?totals.offerDelivered:null,offerAccepted:supplement?totals.offerAccepted:null,
   buyerRequested:records.journeys?totals.buyerRequested:null,depositCleared:records.deposits?totals.depositCleared:null,
   titleOpened:records.closings&&records.titleReplies?totals.titleOpened:null,closed:records.closings&&records.titleReplies?totals.closed:null,
   proceedsReceived:records.closings&&records.titleReplies&&records.proceeds?totals.proceedsReceived:null,
   receivedProceedsCents:records.closings&&records.titleReplies&&records.proceeds?totals.receivedProceedsCents:null,
   offerEvidenceComplete:supplement?.complete===true,qualificationObserved:null,voiceOfferDeliveryObserved:null,
   costCents:costsComplete?costCents:null,costsComplete,costPerClosedDealCents:allSourcesComplete&&costsComplete&&totals.closed>0?Math.round(costCents/totals.closed):null,
   automaticPromotion:false,comparisonWinner:null,
   limitations:['Only actual dispatched, source-bound seller contact starts this cohort.','Unknown qualification and spoken-offer delivery stay unknown.','A buyer request, signature, cleared deposit, title closing and received proceeds are separate evidence.','Late-updated signing records may omit an earlier milestone; no backdated evidence is invented.','This is an observed cohort, not a controlled experiment or profit estimate.']};
 });
}
