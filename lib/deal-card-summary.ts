/** Only persisted production signatures and closing stages advance a deal card. */
export function dealCardSummary(
 deal:{id:string;stage:string;terms:{priceCents:number|null}}|undefined,
 envelopes:{deal_id:string;kind:string;state:string;test_mode:boolean}[]
){
 if(!deal)return null;
 const signed=(kind:string)=>envelopes.some(e=>e.deal_id===deal.id&&e.kind===kind&&e.state==='completed'&&!e.test_mode);
 const purchase=signed('purchase'),assignment=purchase&&signed('assignment');
 const closed=deal.stage==='closed',cancelled=['canceled','cancelled'].includes(deal.stage),title=['title_open','closing','closed'].includes(deal.stage);
 const pending=deal.stage==='cancellation_pending';
 const status=pending?'Cancellation pending':cancelled?'Deal stopped':closed?'Closed':title?'Closing':assignment?'Buyer secured':purchase?'Under contract':'Preparing contract';
 const nextAction=pending?'Finish cancellation review. Automatic work is paused.':cancelled?'Review any remaining contract obligations.':closed?'Review your closing statement and final documents.':title?'Confirm title requirements, signatures and funding.':assignment?'Confirm the buyer’s deposit and open title.':purchase?'Prepare the buyer package and review interested buyers.':'Confirm the seller’s terms and prepare the agreement.';
 const done=[purchase,assignment,title,closed],current=pending||cancelled||closed?-1:done.findIndex(value=>!value);
 return {contractSigned:purchase,status,nextAction,priceCents:purchase&&Number.isSafeInteger(deal.terms.priceCents)&&deal.terms.priceCents!>=0?deal.terms.priceCents:null,
 steps:['Contract','Buyer','Title','Closed'].map((label,index)=>({label,done:done[index],current:index===current}))};
}
