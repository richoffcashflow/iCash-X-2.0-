import {db} from '@/lib/stripe-test';
import {settingsSchema,type WebinarSettings} from '@/lib/webinar-policy';
import {metaPurchasePayload,type MetaIdentity,type MetaPurchase} from '@/lib/webinar-meta-policy';
export function metaReady(){return !!process.env.ICASH_META_ACCESS_TOKEN&&/^v\d+\.\d+$/.test(process.env.ICASH_META_GRAPH_VERSION||'')&&!!process.env.ICASH_APP_ORIGIN;}
export async function webinarSettings(){const [row]=await db<{config:WebinarSettings}[]>('icash_webinar_settings?id=eq.1&select=config');return settingsSchema.parse(row.config);}
export async function processWebinarMeta(){
 const settings=await webinarSettings();
 if(process.env.VERCEL_ENV!=='production'||!settings.meta.enabled||!settings.meta.pixelId||!metaReady())return {paused:true};
 await db('rpc/icash_webinar_sync_purchases','POST',{});
 const jobs=await db<(MetaPurchase&{attempts:number;payload:ReturnType<typeof metaPurchasePayload>|null})[]>('rpc/icash_webinar_claim_meta','POST',{});
 let sent=0,failed=0;
 for(const job of jobs){
  const filter=`icash_webinar_meta_events?event_id=eq.${encodeURIComponent(job.event_id)}`;
  try{
   const [[v],latest,[current],reviews]=await Promise.all([db<MetaIdentity[]>(`icash_webinar_visitors?id=eq.${job.visitor_id}&select=email,marketing_consent_at,measurement`),webinarSettings(),db<{state:string}[]>(`${filter}&select=state`),db<unknown[]>(`icash_billing_reviews?payment_id=eq.${encodeURIComponent(job.payment_id)}&select=payment_id&limit=1`)]);
   if(!v?.marketing_consent_at||!latest.meta.enabled||current?.state!=='sending'||reviews.length){
    await db(filter,'PATCH',{state:'canceled',payload:null});continue;
   }
   const payload=job.payload??metaPurchasePayload(job,v,process.env.ICASH_APP_ORIGIN!);
   if(!job.payload)await db(filter,'PATCH',{payload});
   const res=await fetch(`https://graph.facebook.com/${process.env.ICASH_META_GRAPH_VERSION}/${latest.meta.pixelId}/events`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),headers:{Authorization:`Bearer ${process.env.ICASH_META_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({data:[payload]})});
   const result=await res.json().catch(()=>null);
   if(!res.ok||result?.events_received!==1){
    await db(filter,'PATCH',{state:job.attempts>=5||res.status===400||res.status===401||res.status===403?'failed':'pending',due_at:new Date(Date.now()+60000*2**job.attempts).toISOString(),last_status:res.status});failed++;continue;
   }
   await db(filter,'PATCH',{state:'sent',sent_at:new Date().toISOString(),last_status:res.status});sent++;
  }catch{
   await db(filter,'PATCH',{state:job.attempts>=5?'failed':'pending',due_at:new Date(Date.now()+60000*2**job.attempts).toISOString()});failed++;
  }
 }
 return {sent,failed};
}
