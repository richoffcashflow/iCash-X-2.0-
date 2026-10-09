export type DealProgressEvidence={depositConfirmed:boolean;closingScheduledDate:string|null;paymentSent:boolean};
type EvidenceRow={account_id:string;deal_id:string;effective_date?:string|null};
export type DealProgressRows={id:string;deposit?:EvidenceRow[];scheduled?:EvidenceRow[];payment?:EvidenceRow[]};

/** Project only confirmations belonging to this account and this deal. */
export function recordedDealProgress(deal:DealProgressRows,accountId:string):DealProgressEvidence {
 const own=(row:EvidenceRow)=>row.account_id===accountId&&row.deal_id===deal.id;
 const date=deal.scheduled?.find(own)?.effective_date;
 const validDate=typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))&&new Date(date).toISOString().slice(0,10)===date;
 return {depositConfirmed:!!deal.deposit?.some(own),closingScheduledDate:validDate?date:null,paymentSent:!!deal.payment?.some(own)};
}

/** Only persisted production signatures and closing confirmations advance a deal card. */
export function dealCardSummary(
 deal:{id:string;stage:string;terms:{priceCents:number|null};progress?:DealProgressEvidence}|undefined,
 envelopes:{deal_id:string;kind:string;state:string;test_mode:boolean}[]
){
 if(!deal)return null;
 const signed=(kind:string)=>envelopes.some(e=>e.deal_id===deal.id&&e.kind===kind&&e.state==='completed'&&!e.test_mode);
 const purchase=signed('purchase'),assignment=purchase&&signed('assignment');
 const closed=deal.stage==='closed',cancelled=['canceled','cancelled'].includes(deal.stage),title=['title_open','closing','closed'].includes(deal.stage);
 const deposit=assignment&&deal.progress?.depositConfirmed===true;
 const scheduled=title?deal.progress?.closingScheduledDate:null,paymentSent=closed&&deal.progress?.paymentSent===true;
 const status=cancelled?'Deal stopped':paymentSent?'Title reports payment sent':closed?'Closed':scheduled?'Closing scheduled':deal.stage==='closing'?'Closing in progress':title?'Title opened':deposit?'Buyer deposit confirmed':assignment?'Awaiting buyer deposit':purchase?'Under contract':'Preparing contract';
 const nextAction=cancelled?'Review any remaining contract obligations.':paymentSent?'Confirm the payment reached your bank or that your check arrived.':closed?'Review your closing statement and final documents.':assignment&&!deposit?'Confirm the buyer’s cleared deposit in Viewing times & buyer deposit.':scheduled?`Confirm signing arrangements for ${new Date(scheduled+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'})}.`:title?'Confirm title requirements, signatures and funding.':deposit?'The buyer deposit is confirmed. Coordinate the title file and closing date.':purchase?'Prepare the buyer package and review interested buyers.':'Confirm the seller’s terms and prepare the agreement.';
 const done=[purchase,assignment&&deposit,title,closed],current=cancelled||closed?-1:done.findIndex(value=>!value);
 return {contractSigned:purchase,status,nextAction,priceCents:purchase&&Number.isSafeInteger(deal.terms.priceCents)&&deal.terms.priceCents!>=0?deal.terms.priceCents:null,
 steps:['Contract','Buyer','Title','Closed'].map((label,index)=>({label,done:done[index],current:index===current}))};
}
