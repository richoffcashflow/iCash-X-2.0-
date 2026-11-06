import type {OpportunityProgressData} from './opportunity-progress';

export type SellerEvidence = {
 screeningId:string; source:'text'|'call'|'reception'; sourceId:string; threadId:string|null; at:string; quote:string;
};
export type WorkValueReceipt = {
 spentCents:number; availableCents:number; heldCents:number; interested:number; evidence:SellerEvidence|null;
 lastWork:{kind:'work_settled'|'seller_interest'|'property_screened'|'seller_reply'|'call_completed'|'text_sent';at:string}|null;
 nextReply?:{reason:'visit_requested'|'price_reconciliation'|'awaiting_seller_reply'|'awaiting_dispatch'|'active_call_receipt_unresolved'|'callback_coordination';screeningId:string;threadId:string;checkAt:string|null}|null;
 callbackAt:string|null; contactWindowAt:string|null;
};
export type WeeklyWorkValue = {startAt:string;endAt:string;funded:number;interested:number;spentCents:number;asked:number};
const count=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
const time=(s:unknown):s is string=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const id=(s:unknown)=>typeof s==='string'&&/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(s);
const amounts=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'});
export const valueDollars=(cents:number)=>amounts.format(cents/100);
export function validWorkValue(value:unknown):value is WorkValueReceipt {
 if(!value||typeof value!=='object')return false;
 const r=value as WorkValueReceipt,e=r.evidence;
 return [r.spentCents,r.availableCents,r.heldCents,r.interested].every(count)
  &&(e===null||!!e&&r.interested>0&&id(e.screeningId)&&id(e.sourceId)&&time(e.at)&&typeof e.quote==='string'&&e.quote.length>0&&e.quote.length<=240
    &&(e.source==='text'?id(e.threadId):['call','reception'].includes(e.source)&&e.threadId===null))
  &&(r.lastWork===null||!!r.lastWork&&['work_settled','seller_interest','property_screened','seller_reply','call_completed','text_sent'].includes(r.lastWork.kind)&&time(r.lastWork.at))
  &&(r.nextReply==null||!!r.nextReply&&['visit_requested','price_reconciliation','awaiting_seller_reply','awaiting_dispatch','active_call_receipt_unresolved','callback_coordination'].includes(r.nextReply.reason)
    &&id(r.nextReply.screeningId)&&id(r.nextReply.threadId)&&(r.nextReply.checkAt===null||time(r.nextReply.checkAt)))
  &&(r.callbackAt===null||time(r.callbackAt))&&(r.contactWindowAt===null||time(r.contactWindowAt));
}
export function validWeeklyValue(value:unknown):value is WeeklyWorkValue {
 if(!value||typeof value!=='object')return false;
 const r=value as WeeklyWorkValue;
 return time(r.startAt)&&time(r.endAt)&&Date.parse(r.startAt)<Date.parse(r.endAt)
  &&[r.funded,r.interested,r.spentCents,r.asked].every(count)&&r.asked<=r.funded;
}
export function valueTime(at:string,timezone:string){
 return new Intl.DateTimeFormat('en-US',{timeZone:timezone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(at));
}
export function receiptNextStep(p:OpportunityProgressData,r:WorkValueReceipt){
 if(p.status==='paused')return 'Your bot is paused. Resume it when you’re ready.';
 if(p.status==='membership_required')return 'Restore your membership to resume automated work.';
 const holding=p.health?.status==='blocked'?(p.health.reason==='pending_work'?'Earlier work is awaiting confirmation.':'Automated work is delayed.')
  :p.status==='settling'?'Earlier work is awaiting confirmation before those credits are available.'
  :p.status==='budget_reached'?'New property research is waiting for available research credits.':'';
 const reply=r.nextReply;
 if(reply){
  const steps={visit_requested:'A seller requested a visit. The appointment still needs confirmation.',price_reconciliation:'A seller’s price needs review before the offer can move forward.',awaiting_seller_reply:'A reply was delivered. The next step is the seller’s response.',awaiting_dispatch:'A reply is ready for its final sending checks.',active_call_receipt_unresolved:'The seller follow-up is under review while the earlier call is confirmed.',callback_coordination:'A seller requested a callback. The time still needs confirmation.'};
  return [holding,steps[reply.reason],reply.checkAt?'Next check '+valueTime(reply.checkAt,p.timezone)+'.':''].filter(Boolean).join(' ');
 }
 if(r.callbackAt)return [holding,'A seller requested a callback for '+valueTime(r.callbackAt,p.timezone)+'.'].filter(Boolean).join(' ');
 if(holding)return holding+(p.health?.status==='blocked'?' A restart time is still unconfirmed.':'');
 if(r.contactWindowAt)return 'The next contact window for a queued seller call opens '+valueTime(r.contactWindowAt,p.timezone)+'.';
 if(!r.spentCents&&p.screened>0&&p.eligible===0)return 'None of the newly screened properties passed the financial checks in this period.';
 if(p.queued)return p.queued.toLocaleString()+' '+(p.queued===1?'property is':'properties are')+' queued for screening.';
 return 'The next action has no confirmed time yet.';
}
export function receiptLastWork(r:WorkValueReceipt,timezone:string){
 if(!r.lastWork)return 'A completed action hasn’t been confirmed yet.';
 const names={property_screened:'Property screened',seller_interest:'Seller expressed interest',work_settled:'Work usage settled',seller_reply:'Seller text received',call_completed:'Seller call completed',text_sent:'Seller text sent'};
 return names[r.lastWork.kind]+' · '+valueTime(r.lastWork.at,timezone);
}
export function supportValueSummary(p:OpportunityProgressData,r:WorkValueReceipt){
 const unit=(n:number,one:string,many:string)=>n+' '+(n===1?one:many);
 return 'Today ('+p.timezone+'), '+valueDollars(r.spentCents)+' in work credits used and '+valueDollars(r.availableCents)+' available now. '
  +unit(p.contacted,'property had outreach','properties had outreach')+', '+unit(p.responded,'had a seller response','had seller responses')+', and '
  +unit(r.interested,'seller expressed interest','sellers expressed interest')+'. '+receiptLastWork(r,p.timezone)+'. '+receiptNextStep(p,r);
}
