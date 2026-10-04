import {createHash} from 'node:crypto';
export const marketingConsentVersion='webinar-meta-2026-10-04';
export type MetaPurchase={event_id:string;payment_id:string;session_id:string;visitor_id:string;value_cents:number;occurred_at:string};
export type MetaIdentity={email:string|null;marketing_consent_at:string|null;measurement:Record<string,string>};
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export function metaPurchasePayload(event:MetaPurchase,visitor:MetaIdentity,origin:string){
 if(!visitor.marketing_consent_at||Date.parse(visitor.marketing_consent_at)>Date.parse(event.occurred_at)||!Number.isSafeInteger(event.value_cents)||event.value_cents<=0)throw Error('Unconsented or invalid purchase');
 const url=new URL('/webinar',origin);if(url.protocol!=='https:')throw Error('HTTPS origin required');
 const m=visitor.measurement,userData:Record<string,unknown>={external_id:[hash(event.visitor_id)]};
 if(visitor.email)userData.em=[hash(visitor.email.trim().toLowerCase())];
 for(const key of ['fbc','fbp','client_ip_address','client_user_agent'])if(m[key])userData[key]=m[key];
 return {event_name:'Purchase',event_id:event.event_id,event_time:Math.floor(Date.parse(event.occurred_at)/1000),action_source:'website',event_source_url:url.href,user_data:userData,custom_data:{currency:'USD',value:event.value_cents/100,order_id:event.payment_id}};
}
export function browserPurchase(event:MetaPurchase){return {eventName:'Purchase',eventId:event.event_id,data:{value:event.value_cents/100,currency:'USD'}};}
