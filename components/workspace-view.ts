/** Presentation-only grouping over authenticated records. Never predicts deal progress. */
export type WorkspaceFilter = 'all' | 'attention' | 'active' | 'history';
export type WorkspaceProperty = {id:string;completed_at:string;result:{property:{address:string;propertyId:string;legalDescription?:string|null};financialCheck:{status:string;reason:string};preliminarySellerCeilingCents:number|null}};
export type WorkspaceDeal = {id:string;screening_id:string;stage:string};
export type WorkspaceEvidence = {
 propertyAttentionIds?:string[];
 deals:WorkspaceDeal[];
 handoffs:{screening_id:string;state:string}[];
 textAttention?:{screening_id:string}[];
 callRequests?:{screening_id:string;state:string}[];
 signing:{deal_id:string;state:string;test_mode:boolean}[];
};
export function needsAttention(id:string, work:WorkspaceEvidence) {
 const deal=work.deals.find(d=>d.screening_id===id);
 return !!work.propertyAttentionIds?.includes(id)||!!work.textAttention?.some(a=>a.screening_id===id)
  ||work.handoffs.some(h=>h.screening_id===id&&h.state==='open')
  ||!!work.callRequests?.some(c=>c.screening_id===id&&c.state==='needs_review')
  ||work.signing.some(s=>s.deal_id===deal?.id&&s.state==='customer_signature_needed');
}
export function propertyGroup(id:string,work:WorkspaceEvidence):Exclude<WorkspaceFilter,'all'> {
 if(needsAttention(id,work))return 'attention';
 return work.deals.some(d=>d.screening_id===id&&['closed','canceled'].includes(d.stage))?'history':'active';
}
export function filterProperties<T extends WorkspaceProperty>(properties:T[],work:WorkspaceEvidence,filter:WorkspaceFilter,query=''):T[] {
 const needle=query.trim().toLocaleLowerCase();
 return properties.filter(p=>(filter==='all'||propertyGroup(p.id,work)===filter)&&(!needle||p.result.property.address.toLocaleLowerCase().includes(needle)));
}
export function messageSpeaker(direction:string,party?:string) {
 return direction==='outgoing'?'From your bot number':party==='buyer'?'Buyer':party==='seller'?'Seller':'Contact';
}
export function safeLocalTime(value:string,timezone?:string) {
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Time unavailable';
 try{return date.toLocaleString(undefined,timezone?{timeZone:timezone}:undefined);}catch{return date.toLocaleString();}
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
