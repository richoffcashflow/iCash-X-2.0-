import type {UsageLoopContext} from './usage-loop-context';

export type UsageLoopReason='start'|'refill'|'resume'|'progress'|'review'|'waiting'|'vip';
export type UsageLoopCard={
 key:string;title:string;detail:string;progress:string|null;button:string|null;
 action:'funding'|'resume'|'vip'|'work'|'none';amountCents?:number;reason:UsageLoopReason;
};
export type UsageLoopInput={
 balanceCents:number;paused:boolean;billingReview:boolean;identityReady:boolean;membershipActive:boolean;
 canFund:boolean;autoRechargeEnabled:boolean;recentPurchase:boolean;vip:boolean;vipAvailable:boolean;
 refill:{amountCents:number;lowBalanceCents:number;available?:boolean};
 evidence:UsageLoopContext;variant:'control'|'progress';
};
const cents=(value:number)=>Number.isSafeInteger(value)&&value>=0;
const dollars=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:value%100?2:0}).format(value/100);
export function usageProgressLine(progress:UsageLoopContext['progress']):string|null{
 if(!progress||!Number.isSafeInteger(progress.count)||progress.count<1)return null;
 const n=progress.count.toLocaleString();
 switch(progress.kind){
  case 'seller_reply':return `${n} seller ${progress.count===1?'reply':'replies'} received`;
  case 'buyer_reply':return `${n} buyer ${progress.count===1?'reply':'replies'} received`;
  case 'contract_signed':return `${n} purchase ${progress.count===1?'agreement':'agreements'} signed`;
  case 'research_complete':return `${n} ${progress.count===1?'property':'properties'} researched`;
  case 'closed':return `${n} ${progress.count===1?'closing':'closings'} confirmed`;
 }
}
/** Suggestions never reserve funds, resume work, authorize a payment or promise an outcome. */
export function usageLoopCard(input:UsageLoopInput):UsageLoopCard|null{
 const {evidence:e}=input;
 if(!cents(input.balanceCents)||!input.membershipActive||!input.identityReady||input.billingReview)return null;
 const progress=usageProgressLine(e.progress);
 const card=(reason:UsageLoopReason,title:string,detail:string,action:UsageLoopCard['action']='none',button:string|null=null,amountCents?:number):UsageLoopCard=>({
  key:`${reason}:${e.work?.kind??'none'}:${e.progress?.kind??'none'}:${e.progress?.lastAt??'none'}:${input.balanceCents===0?'empty':'funded'}`,
  reason,title,detail,action,button,progress,...(amountCents===undefined?{}:{amountCents}),
 });
 if(e.needsReview)return card('review','One step needs your attention.','Open Needs you to keep the property moving. Your saved work is still here.','work','Review next step');
 if(input.paused&&e.hasHistory)return card('resume','Your progress is saved.','Your bot is paused. Use Run bot above when you want to continue.');
 if(!e.ready)return progress?card('waiting','Your latest progress','Your saved results are available below. The next automatic task is still being checked.','work','View progress'):null;
 const firstStart=!e.hasHistory&&input.balanceCents===0;
 const estimate=e.work?.estimateCents;
 const hasEstimate=typeof estimate==='number'&&cents(estimate)&&estimate>0;
 const gap=hasEstimate?Math.max(0,estimate-input.balanceCents):null;
 const low=input.balanceCents<(input.refill.lowBalanceCents||500);
 // Never ask to fund a ready batch already covered by the balance. A recent
 // purchase or working auto-recharge must not immediately produce another ask.
 const refillNeeded=!!e.work&&e.work.count>0&&low&&(gap===null||gap>0);
 if((firstStart||refillNeeded)&&input.canFund&&!input.autoRechargeEnabled&&!input.recentPurchase&&input.refill.available!==false){
  const suggested=firstStart?1000:gap!==null?Math.max(1000,Math.ceil(gap/500)*500):input.refill.amountCents;
  if(!cents(suggested)||suggested<1000||suggested>100000)return null;
  const amount=dollars(suggested),work=e.work;
  const noun=work?.kind==='seller_followup'?'seller follow-ups':work?.kind==='buyer_outreach'?'buyer outreach':'property research';
  const estimateNote=hasEstimate?` The queued work is estimated at ${dollars(estimate)}; final usage can vary.`:'';
  return firstStart
   ?card('start',input.variant==='progress'?'Put your bot to work.':'Start your bot.',`Add ${amount} in credits to start eligible work.`, 'funding',`Add ${amount} & start`,suggested)
   :card('refill',input.variant==='progress'?`Your next ${noun} ${noun==='seller follow-ups'?'are':'is'} ready.`:'Credits for your next step.',`Add ${amount} in credits for the next eligible ${noun}.${estimateNote}`,'funding',`Review ${amount} refill`,suggested);
 }
 if(input.vipAvailable&&!input.vip&&!input.recentPurchase&&e.hasDeal&&input.balanceCents>0){
  return card('vip','Your deal is ready for the next step.','Explore the Platform Buyer Network and the features included with VIP.','vip','Explore VIP');
 }
 if(e.work&&e.work.count>0){
  const detail=e.work.kind==='seller_followup'?'Seller follow-ups are queued. Open your properties for the latest conversations.':e.work.kind==='buyer_outreach'?'Buyer outreach is queued. Open the property to follow responses.':'Property research is queued. Results will appear in your workspace.';
  return card('progress',progress?'Your work is moving forward.':'Your next step is lined up.',detail,'work','View progress');
 }
 if(progress)return card('progress','Your latest progress','Open your properties to see the results and the next step for each deal.','work','View progress');
 return card('waiting','Ready for the next opportunity.','Your bot is waiting for eligible work. New properties and replies will appear here.');
}
