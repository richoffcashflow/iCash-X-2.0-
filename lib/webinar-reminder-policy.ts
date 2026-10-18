export const reminderCookie='icash_webinar_reminder';
export const reminderHintCookie='icash_webinar_reminder_visit';
export const reminderWindowSeconds=7*86400;
export function reminderRequestAllowed(req:Request){
 const h=req.headers;
 if(h.get('sec-gpc')==='1'||h.get('x-icash-measurement')==='deny')return false;
 if(/prefetch|prerender/i.test(`${h.get('purpose')||''} ${h.get('sec-purpose')||''}`)||h.has('next-router-prefetch'))return false;
 // Raw opens are never reported as people. Common preview/security agents also
 // receive no attribution cookie, even if they later execute page JavaScript.
 return !/bot\b|crawler|spider|preview|facebookexternalhit|facebot|slack|discord|whatsapp|telegrambot|skypeuripreview|safelinks|proofpoint|mimecast|barracuda|headless|lighthouse/i.test(h.get('user-agent')||'');
}
export function reminderPage(path:string,search:string){
 if(new URLSearchParams(search).has('preview'))return false;
 return path==='/webinar'||/^\/live\/\d{6,12}$/.test(path)||path==='/webinar/checkout'||path==='/webinar/upgrade'||path==='/';
}
export type ReminderMetrics={channel:'all'|'email'|'sms';deliveredMessages:number;deliveredPeople:number;queuedMessages:number;linkOpens:number;clickedPeople:number;returnedPeople:number;checkoutPeople:number;purchases:number;buyers:number;membershipPurchases:number;vipPurchases:number;revenueCents:number};
export type ReminderJobMetrics={jobId:string;linkOpens:number;confirmedVisits:number;returned:boolean;purchases:number;revenueCents:number};
export type ReminderResults={trackingSince:string;overall:ReminderMetrics;channels:ReminderMetrics[];jobs:ReminderJobMetrics[]};
