import {runScreeningJob} from './screening-job.ts';
export type VoicePermission={phone:string;timezone:string;local_start_hour:number;local_end_hour:number;permission_until:string;dnc_checked_at:string;dnc_clear:boolean;revoked_at:string|null};
export function callEligibility(p:VoicePermission,snapshot:unknown,now=Date.now()){
 if(!/^\+1[2-9][0-9]{9}$/.test(p.phone)||p.revoked_at||!p.dnc_clear||!Number.isFinite(Date.parse(p.permission_until))||Date.parse(p.permission_until)<=now||!Number.isFinite(Date.parse(p.dnc_checked_at))||Date.parse(p.dnc_checked_at)>now||now-Date.parse(p.dnc_checked_at)>30*86400000)return {ready:false as const,reason:'contact_permission_required'};
 if(!Number.isInteger(p.local_start_hour)||!Number.isInteger(p.local_end_hour)||p.local_start_hour<9||p.local_end_hour>20||p.local_start_hour>=p.local_end_hour)return {ready:false as const,reason:'contact_hours_required'};
 try{const h=Number(new Intl.DateTimeFormat('en-US',{timeZone:p.timezone,hour:'2-digit',hourCycle:'h23'}).format(new Date(now)));if(h<p.local_start_hour||h>=p.local_end_hour)return {ready:false as const,reason:'outside_contact_hours'};}catch{return {ready:false as const,reason:'contact_timezone_required'};}
 try{const screening=runScreeningJob(snapshot,now);if(screening.financialCheck.status!=='eligible')return {ready:false as const,reason:'financial_hold'};return {ready:true as const,screening};}catch{return {ready:false as const,reason:'fresh_screening_required'};}
}
export function verifiedOfferCeiling(preliminary:number|null,authority:{max_offer_cents:number;expires_at:string}|undefined,now=Date.now()){
 return preliminary!==null&&Number.isSafeInteger(preliminary)&&preliminary>0&&authority&&Number.isSafeInteger(authority.max_offer_cents)&&authority.max_offer_cents>0&&Date.parse(authority.expires_at)>now?Math.min(preliminary,authority.max_offer_cents):null;
}
