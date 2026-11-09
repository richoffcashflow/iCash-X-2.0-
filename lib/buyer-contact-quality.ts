/** Provider observations, not permission, verified funds or a current DNC check. */
export const emailVerificationStatuses=['undeliverable','deliverability_risk_low','deliverability_risk_medium','likely_deliverable_low','likely_deliverable_high','very_likely_deliverable'] as const;
export type EmailVerificationStatus=typeof emailVerificationStatuses[number];
export type BuyerPhoneObservation={number:string;doNotCall:boolean|null;matchConfidence:number|null;type:string|null};
export type BuyerEmailObservation={address:string;matchConfidence:number|null;verificationStatus:EmailVerificationStatus|null};
const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const confidence=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?value:null;
export function buyerContactObservations(phones:unknown,emails:unknown){
 const phoneObservations:BuyerPhoneObservation[]=Array.isArray(phones)?phones.slice(0,20).flatMap(value=>{
  const p=record(value);
  if(typeof p.number!=='string'||!p.number.trim()||p.number.length>30)return [];
  return [{number:p.number,doNotCall:typeof p.do_not_call==='boolean'?p.do_not_call:null,matchConfidence:confidence(p.match_confidence),type:typeof p.type==='string'&&['wireless','mobile','landline','voip','unknown'].includes(p.type)?p.type:null}];
 }):[];
 const emailObservations:BuyerEmailObservation[]=Array.isArray(emails)?emails.slice(0,20).flatMap(value=>{
  const e=record(value);
  if(typeof e.address!=='string'||!e.address.trim()||e.address.length>320)return [];
  return [{address:e.address,matchConfidence:confidence(e.match_confidence),verificationStatus:emailVerificationStatuses.includes(e.verification_status as EmailVerificationStatus)?e.verification_status as EmailVerificationStatus:null}];
 }):[];
 // Keep source ordering and every negative/unknown observation. Selection must
 // still use the independently reviewed contact and original contact checks.
 return {phones:phoneObservations,emails:emailObservations.map(e=>e.address),emailObservations};
}
