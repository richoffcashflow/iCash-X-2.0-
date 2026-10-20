import {metaId} from './meta-instant-leads.ts';
import type {SellerDb} from './seller-pipeline.ts';
type StageEvent={id:string;token:string;leadId:string;name:string;occurredAt:string};
/** CRM stage feedback carries the original Meta lead ID, never property data,
 * transcripts, a speculative price, or a delivery receipt labelled a response. */
export function instantCrmEvent(event:StageEvent,now=Date.now()){
 metaId.parse(event.leadId);const occurred=Date.parse(event.occurredAt);
 if(!['InstantFormReceived','SellerResponded','PropertyAddressConfirmed','CashOfferReady'].includes(event.name)||!Number.isFinite(occurred)||occurred>now||occurred<now-7*86400000)throw Error('META_EVENT_WINDOW');
 return {event_name:event.name,event_time:Math.floor(occurred/1000),event_id:'instant-lead:'+event.id,action_source:'system_generated',user_data:{lead_id:event.leadId},custom_data:{event_source:'crm',lead_event_source:'iCash X'}};
}
export async function deliverInstantCrmEvent(db:SellerDb,env:NodeJS.ProcessEnv,transport:typeof fetch=fetch){
 const dataset=env.META_SELLER_DATASET_ID,key=env.META_SELLER_ACCESS_TOKEN||env.META_CAPI_ACCESS_TOKEN,version=env.META_GRAPH_VERSION;
 if(env.META_INSTANT_LEADS_ENABLED!=='true'||env.META_INSTANT_CRM_EVENTS_ENABLED!=='true'||env.VERCEL_ENV&&env.VERCEL_ENV!=='production'||!key||!/^\d{5,30}$/.test(dataset??'')||!/^v\d{1,3}\.0$/.test(version??''))return {status:'measurement_setup_required'};
 const event=await db<StageEvent|null>('rpc/icash_meta_claim_event','POST',{});if(!event)return {status:'idle'};
 let delivered=false;
 try{
  const result=await transport(`https://graph.facebook.com/${version}/${dataset}/events`,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({data:[instantCrmEvent(event)]}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(10000)});
  const body=await result.json();delivered=result.ok&&body.events_received===1;
  if(!delivered)console.warn('instant_meta_delivery_failed',{httpStatus:result.status,code:Number(body.error?.code)||null,subcode:Number(body.error?.error_subcode)||null});
 }catch{/* Same stable ID on retry. */}
 await db(`icash_meta_lead_events?id=eq.${event.id}&claim_token=eq.${event.token}`,'PATCH',{state:delivered?'delivered':'pending',...(delivered?{delivered_at:new Date().toISOString()}:{})});
 return {status:delivered?'delivered':'pending'};
}
