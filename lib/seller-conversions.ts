import {createHash} from 'node:crypto';
import type {SellerDb} from './seller-pipeline.ts';
type Event={id:string;leadId:string;token:string;name:string;occurredAt:string;phone:string;actionSource?:'chat'|'phone_call'|'system_generated'};
export function sellerMetaEvent(e:Event,now=Date.now()){
 const time=Date.parse(e.occurredAt);
 if(!['CompleteRegistration','Lead','Contact','SubmitApplication'].includes(e.name)||!/^\+1[2-9]\d{2}[2-9]\d{6}$/.test(e.phone)||!Number.isFinite(time)||time>now||time<now-7*86400000)throw Error('Event outside delivery window');
 const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
 return {event_name:e.name,event_time:Math.floor(time/1000),event_id:`keypath:${e.id}`,action_source:e.name==='Contact'?(e.actionSource==='chat'?'chat':'phone_call'):'system_generated',user_data:{ph:[hash(e.phone.slice(1))],external_id:[hash(e.leadId)]}};
}
/** Stable IDs survive retries. No raw address, financial estimate or transcript is exported. */
export async function deliverSellerEvent(db:SellerDb,env:NodeJS.ProcessEnv,transport:typeof fetch=fetch){
 const dataset=env.META_SELLER_DATASET_ID,token=env.META_SELLER_ACCESS_TOKEN,version=env.META_GRAPH_VERSION;
 if(env.META_SELLER_EVENTS_ENABLED!=='true'||!dataset||!/^\d{5,30}$/.test(dataset)||!token||!version||!/^v\d{1,3}\.0$/.test(version))return {status:'measurement_setup_required'};
 const event=await db<Event|null>('rpc/icash_claim_seller_event','POST',{});if(!event)return {status:'idle'};
 let delivered=false;
 try{
  const payload=sellerMetaEvent(event);
  const response=await transport(`https://graph.facebook.com/${version}/${dataset}/events`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({data:[payload]}),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(response.ok){const result=await response.json();delivered=result.events_received===1;}
 }catch{/* Stable event ID allows an idempotent provider retry; expired events go to review. */}
 await db('rpc/icash_finish_seller_event','POST',{p_id:event.id,p_token:event.token,p_delivered:delivered});
 return {status:delivered?'delivered':'pending_or_review'};
}
