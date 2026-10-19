import {runScreeningJob} from './screening-job.ts';
import {readVoiceOutreachContext,withinOutreachHours,type VoiceOutreachContext} from './outreach-hours.ts';
export type VoicePermission={phone:string;timezone:string;local_start_hour:number;local_end_hour:number;permission_until:string;dnc_checked_at:string|null;dnc_clear:boolean;revoked_at:string|null;sellerConsentVerified?:boolean;sellerCallbackVerified?:boolean};
export function contactEligibility(p:VoicePermission,now=Date.now(),outreach?:VoiceOutreachContext){
 if(!/^\+1[2-9][0-9]{9}$/.test(p.phone)||p.revoked_at||!Number.isFinite(Date.parse(p.permission_until))||Date.parse(p.permission_until)<=now||(!p.sellerConsentVerified&&(!p.dnc_clear||!p.dnc_checked_at||!Number.isFinite(Date.parse(p.dnc_checked_at))||Date.parse(p.dnc_checked_at)>now||now-Date.parse(p.dnc_checked_at)>30*86400000)))return {ready:false as const,reason:'contact_operating_checks_required'};
 // The current policy comes from server-bound context. Keep historical contact
 // windows intact; neither consent nor an old/client callback flag bypasses it.
 const context=readVoiceOutreachContext(outreach);
 if(!context)return {ready:false as const,reason:'contact_hours_required'};
 if(!withinOutreachHours(context,now))return {ready:false as const,reason:'outside_contact_hours'};
 return {ready:true as const};
}
// Search real instants so DST changes and fractional-hour timezones are respected.
export function nextContactWindow(p:VoicePermission,now=Date.now(),outreach?:VoiceOutreachContext):string|null{
 const current=contactEligibility(p,now,outreach);
 if(current.ready)return new Date(now).toISOString();
 if(current.reason!=='outside_contact_hours')return null;
 const context=readVoiceOutreachContext(outreach)!;
 for(let at=Math.ceil(now/60000)*60000;at<=now+48*3600000;at+=60000){
  if(withinOutreachHours(context,at))return contactEligibility(p,at,context).ready?new Date(at).toISOString():null;
 }
 return null;
}
export function callEligibility(p:VoicePermission,snapshot:unknown,now=Date.now(),outreach?:VoiceOutreachContext){
 const contact=contactEligibility(p,now,outreach);if(!contact.ready)return contact;
 try{const screening=runScreeningJob(snapshot,now);if(screening.financialCheck.status!=='eligible')return {ready:false as const,reason:'financial_hold'};return {ready:true as const,screening};}catch{return {ready:false as const,reason:'fresh_screening_required'};}
}
export function verifiedOfferCeiling(preliminary:number|null,authority:{max_offer_cents:number;expires_at:string}|undefined,now=Date.now()){
 return preliminary!==null&&Number.isSafeInteger(preliminary)&&preliminary>0&&authority&&Number.isSafeInteger(authority.max_offer_cents)&&authority.max_offer_cents>0&&Date.parse(authority.expires_at)>now?Math.min(preliminary,authority.max_offer_cents):null;
}
