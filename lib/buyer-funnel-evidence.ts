type Owned={account_id:string;id:string;deal_id:string;created_at:string};
export type BuyerFunnelClosing=Owned&{reply_id:string;kind:string;effective_date:string|null;amount_cents?:number|null;confirmed_by:string|null;confirmation_source:string};
export type BuyerFunnelReply={id:string;deal_id:string;sender_verified:boolean;received_at:string};
export type BuyerFunnelDeposit=Owned&{envelope_id:string;terms_hash:string;amount_cents:number;confirmed_by:string;method:string};
export type BuyerFunnelProceeds=Owned&{closing_update_id:string;amount_cents:number;received_date:string;confirmed_by:string};
export type BuyerFunnelJourney=Owned&{wants_assignment:boolean;accepted_price_cents:number|null;funds_ready:boolean|null;authorized:boolean|null;updated_at:string};
export type VerifiedFunnelSigning={id:string;deal_id:string;kind:string;terms_hash:string;deposit_cents?:number|null;updated_at:string};
export type BuyerFunnelRecords={closings?:BuyerFunnelClosing[];titleReplies?:BuyerFunnelReply[];deposits?:BuyerFunnelDeposit[];proceeds?:BuyerFunnelProceeds[];journeys?:BuyerFunnelJourney[]};
const instant=(value:string,now:number)=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=now;
const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0;
function date(value:string|null,latest:string){
 if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
 const parsed=Date.parse(value+'T00:00:00Z');
 return Number.isFinite(parsed)&&new Date(parsed).toISOString().slice(0,10)===value&&value<=latest;
}
function unique<T extends {id:string}>(rows:T[]){
 const found=new Map<string,T>();
 for(const row of rows){if(!row.id)throw Error('Missing evidence key');const prior=found.get(row.id);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw Error('Conflicting evidence');found.set(row.id,row);}
 return [...found.values()];
}
/** Read-only observations. Every monetary milestone is bound to its own receipt. */
export function summarizeBuyerFunnel(dealIds:Set<string>,signings:VerifiedFunnelSigning[],records:BuyerFunnelRecords,now:number){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 const signed=new Map(signings.map(e=>[e.id,e]));
 const hasSigned=(deal:string,kind:string,at:string)=>signings.some(e=>e.deal_id===deal&&e.kind===kind&&Date.parse(e.updated_at)<=Date.parse(at));
 const replies=new Map(unique(records.titleReplies??[]).map(r=>[r.id,r]));
 const kinds=['title_opened','deposit_received','closing_scheduled','closed','funds_disbursed'];
 const validUpdates=new Map<string,BuyerFunnelClosing>();
 let unverifiedClosingRecords=0,unverifiedDepositReceipts=0,unverifiedProceedsReceipts=0;
 for(const c of unique(records.closings??[])){
  if(!dealIds.has(c.deal_id)||!kinds.includes(c.kind))continue;
  const reply=replies.get(c.reply_id);
  if(!hasSigned(c.deal_id,'purchase',c.created_at)||!instant(c.created_at,now)||!reply?.sender_verified||reply.deal_id!==c.deal_id
   ||!instant(reply.received_at,now)||Date.parse(reply.received_at)>Date.parse(c.created_at)||!c.confirmed_by&&c.confirmation_source!=='verified_title_format'
   ||(['deposit_received','closed','funds_disbursed'].includes(c.kind)&&!hasSigned(c.deal_id,'assignment',c.created_at))
   ||(['deposit_received','funds_disbursed'].includes(c.kind)&&!positive(c.amount_cents))
   ||(['closed','funds_disbursed'].includes(c.kind)&&!date(c.effective_date,today))
   ||(c.kind==='closing_scheduled'&&!date(c.effective_date,'9999-12-31'))){unverifiedClosingRecords++;continue;}
  validUpdates.set(c.id,c);
 }
 const count=(kind:string)=>new Set([...validUpdates.values()].filter(c=>c.kind===kind).map(c=>c.deal_id)).size;
 const deposits=new Set<string>(),received=new Set<string>(),requested=new Set<string>(),details=new Set<string>();
 for(const r of unique(records.deposits??[])){
  if(!dealIds.has(r.deal_id))continue;
  const e=signed.get(r.envelope_id);
  if(!e||e.kind!=='assignment'||e.deal_id!==r.deal_id||!r.terms_hash||r.terms_hash!==e.terms_hash
   ||!hasSigned(r.deal_id,'purchase',r.created_at)||Date.parse(e.updated_at)>Date.parse(r.created_at)||!instant(r.created_at,now)
   ||!r.confirmed_by?.trim()||!['check','wire','cash_app','zelle','verified_closer'].includes(r.method)
   ||!positive(r.amount_cents)||r.amount_cents>500000||r.amount_cents!==e.deposit_cents){unverifiedDepositReceipts++;continue;}
  deposits.add(r.deal_id);
 }
 let receivedProceedsCents=0;
 for(const r of unique(records.proceeds??[])){
  if(!dealIds.has(r.deal_id))continue;
  const c=validUpdates.get(r.closing_update_id);
  if(!c||c.kind!=='funds_disbursed'||c.deal_id!==r.deal_id||!positive(r.amount_cents)||r.amount_cents!==c.amount_cents
   ||!r.confirmed_by?.trim()||!instant(r.created_at,now)||Date.parse(c.created_at)>Date.parse(r.created_at)||!date(r.received_date,today)
   ||!c.effective_date||r.received_date<c.effective_date
   ||![...validUpdates.values()].some(closed=>closed.kind==='closed'&&closed.deal_id===r.deal_id&&Date.parse(closed.created_at)<=Date.parse(r.created_at)&&closed.effective_date!<=r.received_date)
   ||received.has(r.deal_id)){unverifiedProceedsReceipts++;continue;}
  received.add(r.deal_id);receivedProceedsCents+=r.amount_cents;
  if(!Number.isSafeInteger(receivedProceedsCents))throw Error('Proceeds overflow');
 }
 for(const j of unique(records.journeys??[])){
  if(!dealIds.has(j.deal_id)||!j.wants_assignment||!instant(j.created_at,now)||!instant(j.updated_at,now)||Date.parse(j.updated_at)<Date.parse(j.created_at)||!hasSigned(j.deal_id,'purchase',j.created_at))continue;
  requested.add(j.deal_id);
  if(positive(j.accepted_price_cents)&&j.funds_ready===true&&j.authorized===true)details.add(j.deal_id);
 }
 const titleAvailable=!!records.closings&&!!records.titleReplies;
 return {buyerRequestDeals:records.journeys?requested.size:null,buyerDetailsSubmittedDeals:records.journeys?details.size:null,
  clearedDepositDeals:records.deposits?deposits.size:null,titleOpenedDeals:titleAvailable?count('title_opened'):null,
  titleReportedDepositDeals:titleAvailable?count('deposit_received'):null,closingScheduledDeals:titleAvailable?count('closing_scheduled'):null,
  closedDeals:titleAvailable?count('closed'):null,titleReportedDisbursementDeals:titleAvailable?count('funds_disbursed'):null,
  proceedsReceivedDeals:titleAvailable&&records.proceeds?received.size:null,receivedProceedsCents:titleAvailable&&records.proceeds?receivedProceedsCents:null,
  unverifiedClosingRecords,unverifiedDepositReceipts,unverifiedProceedsReceipts};
}
