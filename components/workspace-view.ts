/** Presentation-only grouping over authenticated records. Never predicts deal progress. */
import {journeyNextAction} from '../lib/deal-journey-progress.ts';
export type WorkspaceFilter = 'all' | 'attention' | 'active' | 'waiting' | 'history';
export type WorkspaceProperty = {engagement?:{responded:boolean;interested:boolean;optedOut:boolean};id:string;completed_at:string;result:{property:{address:string;propertyId:string;legalDescription?:string|null;images?:unknown;bedrooms?:number|null;bathrooms?:number|null;livingAreaSqft?:number|null;yearBuilt?:number|null};financialCheck:{status:string;reason:string};preliminarySellerCeilingCents:number|null}};
export type WorkspaceDeal = {id:string;screening_id:string;stage:string};
export type WorkspaceEvidence = {
 proceedsReceivedDealIds?:string[];
 journeys?:import('../lib/deal-journey-progress.ts').JourneyProgress[];
 closingTasks?:{screening_id:string}[];
 closingReview?:{screening_id:string;review_reason?:string}[];
 propertyAttentionIds?:string[];
 viewingRequests?:{screening_id:string}[];
 deals:WorkspaceDeal[];
 handoffs:{screening_id:string;state:string}[];
 sellerRecovery?:{screening_id:string}[];
 textAttention?:{screening_id:string}[];
 callRequests?:{screening_id:string;state:string}[];
 signing:{deal_id:string;state:string;test_mode:boolean}[];
};
export function needsAttention(id:string, work:WorkspaceEvidence) {
 const deal=work.deals.find(d=>d.screening_id===id);
 return deal?.stage==='cancellation_pending'||!!work.closingTasks?.some(t=>t.screening_id===id)||!!work.closingReview?.some(c=>c.screening_id===id)||!!work.sellerRecovery?.some(g=>g.screening_id===id)||!!work.viewingRequests?.some(v=>v.screening_id===id)||!!work.propertyAttentionIds?.includes(id)||!!work.textAttention?.some(a=>a.screening_id===id)
  ||work.handoffs.some(h=>h.screening_id===id&&h.state!=='resolved')
  ||!!work.callRequests?.some(c=>c.screening_id===id&&c.state==='needs_review')
  ||work.signing.some(s=>s.deal_id===deal?.id&&s.state==='customer_signature_needed');
}
export function propertyGroup(id:string,work:WorkspaceEvidence):Exclude<WorkspaceFilter,'all'> {
 if(needsAttention(id,work))return 'attention';
 const deal=work.deals.find(d=>d.screening_id===id);
 if(deal?.stage==='closed'&&work.proceedsReceivedDealIds&&!work.proceedsReceivedDealIds.includes(deal.id))return 'waiting';
 if(deal&&['closed','canceled','cancelled'].includes(deal.stage))return 'history';
 const j=work.journeys?.find(j=>j.screening_id===id&&j.state!=='closed');
 if(j){const next=journeyNextAction(j);return next.waitingOn==='You'?'attention':next.waitingOn==='Bot'?'active':'waiting';}
 return 'active';
}
export function filterProperties<T extends WorkspaceProperty>(properties:T[],work:WorkspaceEvidence,filter:WorkspaceFilter,query=''):T[] {
 const needle=query.trim().toLocaleLowerCase();
 return properties.filter(p=>(filter==='all'||propertyGroup(p.id,work)===filter)&&(!needle||p.result.property.address.toLocaleLowerCase().includes(needle)));
}
export function messageSpeaker(direction:string,party?:string,author?:'bot'|'you'|'contact') {
 return direction==='outgoing'?(author==='bot'?'AI bot':author==='you'?'You':'From your bot number'):party==='buyer'?'Buyer':party==='seller'?'Seller':'Contact';
}
export function safeLocalTime(value:string,timezone?:string) {
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Time unavailable';
 try{return date.toLocaleString('en-US',{hour12:true,...(timezone?{timeZone:timezone}:{})});}catch{return date.toLocaleString('en-US',{hour12:true});}
}
/** A contract's calendar date must not shift a day with the viewer's timezone. */
export function safeCalendarDate(value:string) {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return 'Date unavailable';
 const date=new Date(`${value}T12:00:00Z`);
 if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)return 'Date unavailable';
 return date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
}

/** Split only recorded address text; never infer missing city/state or rewrite proper names. */
export function propertyAddressLines(address:string) {
 const parts=address.split(',').map(part=>part.trim());
 if(parts.length<2||parts.some(part=>!part))return {street:address,location:''};
 const locationStart=parts.length>2?parts.length-2:1;
 return {street:parts.slice(0,locationStart).join(', '),location:parts.slice(locationStart).join(', ')};
}
export function propertyResearchDate(value:string) {
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):null;
}
