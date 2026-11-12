import {dispatchReliabilityAlerts} from '../lib/reliability-alerts-service.ts';
import {externalReliabilityRuntime} from '../lib/reliability-monitor-runtime.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
import {healthyProductionResponse,PRODUCTION_HEALTH_URL} from '../scripts/check-production-health.mjs';

export const MONITOR_PROVIDER='external_reliability_monitor_v1';
const rpcNames=new Set(['icash_refresh_reliability_incident','icash_claim_reliability_notification_v2','icash_finish_reliability_notification','icash_reliability_status']);
const email=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i;
const receipt=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export function monitorDatabase(env,transport=fetch){
 if(!externalReliabilityRuntime(env)||!env.SUPABASE_SECRET_KEY)throw Error('MONITOR_CONFIGURATION_INVALID');
 return async(path,method='POST',body={})=>{
  if(method!=='POST'||!rpcNames.has(path.replace(/^rpc\//,''))||!path.startsWith('rpc/'))throw Error('MONITOR_OPERATION_NOT_ALLOWED');
  const response=await transport(new URL('/rest/v1/'+path,env.SUPABASE_URL),{method,redirect:'error',cache:'no-store',
   headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(5000)});
  if(!response.ok){await response.body?.cancel();throw Error('MONITOR_DATABASE_UNAVAILABLE');}
  const text=await response.text();return text?JSON.parse(text):null;
 };
}

/** One probe and one incident pass per minute, independently of the web cron
 * and paid worker. This process cannot claim or dispatch any customer job. */
export function createExternalMonitor({env=process.env,transport=fetch,now=Date.now,log=()=>{},dispatch=dispatchReliabilityAlerts}={}){
 const db=monitorDatabase(env,transport);
 if(env.ICASH_RELIABILITY_EMAIL_ENABLED!=='true'||!env.RESEND_API_KEY||env.ICASH_RELIABILITY_FROM_EMAIL!=='noreply@geticashx.com')throw Error('MONITOR_ALERTS_UNCONFIGURED');
 let pending=false,nextAt=0,lastCompletedAt=0,owner=null,ownerCheckedAt=0,nextOwnerAt=0,failures=0,lastEmergencyHour=null;
 let last={status:'starting',application:'unverified',alerts:'unverified',telemetry:'unverified'};
 async function publicHealth(){
  try{
   const response=await transport(PRODUCTION_HEALTH_URL,{method:'GET',redirect:'error',cache:'no-store',headers:{Accept:'application/json','Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
   const value=await response.json(),time=Date.parse(value?.checkedAt);
   if(healthyProductionResponse(response.status,value,now()))return 'ok';
   const fresh=Number.isFinite(time)&&now()-time<=60000&&time-now()<=30000;
   return response.status===503&&value?.status==='degraded'&&fresh&&value?.checks?.database==='ok'&&value?.checks?.authentication==='ok'&&['degraded','unavailable'].includes(value?.checks?.workflows)?'workflows_degraded':'unavailable';
  }catch{return 'unavailable';}
 }
 async function verifyOwner(){
  if(now()<nextOwnerAt)return;nextOwnerAt=now()+300000;
  try{
   const response=await transport(new URL('/auth/v1/admin/users/'+ownerInboundTarget.ownerUserId,env.SUPABASE_URL),{headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});
   if(response.status===404){owner=null;ownerCheckedAt=0;await response.body?.cancel();return;}
   if(!response.ok){await response.body?.cancel();return;}
   const value=await response.json(),confirmed=Date.parse(value?.email_confirmed_at);
   if(value?.id!==ownerInboundTarget.ownerUserId||typeof value.email!=='string'||value.email.length>254||!email.test(value.email)||!Number.isFinite(confirmed)||confirmed>now()||value.deleted_at||value.banned_until&&Date.parse(value.banned_until)>now()){
    owner=null;ownerCheckedAt=0;return;
   }
   owner=value.email;ownerCheckedAt=now();
  }catch{/* A bounded cached verified owner permits an alert during auth outages. */}
 }
 async function emergency(){
  const hour=Math.floor(now()/3600000);
  if(failures<3||!owner||now()-ownerCheckedAt>6*3600000||now()<ownerCheckedAt||lastEmergencyHour===hour)return 'not_due';
  lastEmergencyHour=hour; // Consume before transport; uncertain sends are not replayed.
  const period=new Date(hour*3600000).toISOString();
  const payload={from:'iCash X <noreply@geticashx.com>',to:[owner],subject:'iCash X · external monitor needs attention',
   text:`The independent monitor observed repeated application or incident-observation failures during the hour beginning ${period}. Current customer impact and recovery are unverified. Inspect the production services and original receipts before repeating any operation. This is a bounded outage alert, not a claim that all accounts are stopped.\n\nhttps://www.geticashx.com/admin`};
  try{
   const response=await transport('https://api.resend.com/emails',{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`icash-external-monitor-${hour}`},body:JSON.stringify(payload),signal:AbortSignal.timeout(8000)});
   if(!response.ok){await response.body?.cancel();return 'needs_review';}
   return receipt.test((await response.json())?.id??'')?'accepted':'needs_review';
  }catch{return 'needs_review';}
 }
 async function tick(){
  if(pending||now()<nextAt)return false;
  pending=true;nextAt=now()+60000;
  try{
   const [application,alertResult]=await Promise.all([publicHealth(),dispatch({db,env,transport}).catch(()=> 'unavailable'),verifyOwner()]);
   const alerts=['accepted','idle','needs_review','recipient_unverified','unconfigured','disabled','skipped'].includes(alertResult)?alertResult:'unavailable';
   failures=application==='unavailable'||alerts==='unavailable'?failures+1:0;
   const fallback=await emergency();
   const observedAt=new Date(now()).toISOString();
   last={status:application==='ok'&&['accepted','idle'].includes(alerts)?'ok':'degraded',application,alerts,emergency:fallback,observedAt,releaseSha:env.RAILWAY_GIT_COMMIT_SHA,intervalMs:60000};
   try{
    const response=await transport(new URL('/rest/v1/icash_integration_checks?on_conflict=provider',env.SUPABASE_URL),{method:'POST',redirect:'error',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({provider:MONITOR_PROVIDER,checked_at:observedAt,result:last}),signal:AbortSignal.timeout(5000)});
    last={...last,telemetry:response.ok?'saved':'unavailable'};await response.body?.cancel();
   }catch{last={...last,telemetry:'unavailable'};}
   lastCompletedAt=now();log({event:'icash_external_monitor',...last});return true;
  }finally{pending=false;}
 }
 return {tick,health:()=>({...last,observerStatus:lastCompletedAt&&now()-lastCompletedAt<180000?'running':'starting_or_stale',lastCompletedAt:lastCompletedAt?new Date(lastCompletedAt).toISOString():null})};
}
