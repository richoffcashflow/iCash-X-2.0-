// Deployment preflight: bounded provider GETs only. Never dials, sends, purchases,
// changes routing, enables a release, or exposes credentials/provider payloads.
import {pathToFileURL} from 'node:url';
import {readOwnerForwarding} from '../lib/owner-forwarding-readiness.ts';
import {readRecordedReceptionReadiness} from '../lib/recorded-reception-readiness.ts';
import {readRecordedOutboundReadiness} from '../lib/recorded-outbound-readiness.ts';

export async function checkTelephonyConnection(env=process.env,fetcher=fetch){
 const reads=await Promise.allSettled([
  readOwnerForwarding(env,fetcher),
  readRecordedReceptionReadiness(env,{fetcher}),
  readRecordedOutboundReadiness(env,{fetcher}),
 ]);
 const value=(i)=>reads[i].status==='fulfilled'?reads[i].value:null;
 const forwarding=value(0),incoming=value(1),outgoing=value(2);
 return {
  checkedAt:new Date().toISOString(),mode:'read_only',callsPlaced:0,messagesSent:0,
  release:{inbound:env.ICASH_RECORDED_RECEPTION_READY==='true',outbound:env.ICASH_RECORDED_OUTBOUND_READY==='true',sms:env.ICASH_SMS_WORK_READY==='true'||env.ICASH_LIVE_WORK_READY==='true'},
  forwarding:forwarding?{status:'checked',enabled:forwarding.enabled,providerStatus:forwarding.providerStatus,routeConfigured:forwarding.routeConfigured}:{status:'unavailable',routeConfigured:false},
  incoming:incoming??{status:'unavailable',branches:[],phone:{status:'unavailable',bindingVerified:false,route:'unknown'}},
  outgoing:outgoing??{status:'unavailable',providerChecksPass:false},
  liveCallVerification:'not_tested',
 };
}

export async function saveTelephonyCheck(result,env=process.env,fetcher=fetch){
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return false;
 const response=await fetcher(`${env.SUPABASE_URL}/rest/v1/icash_integration_checks?on_conflict=provider`,{
  method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},
  body:JSON.stringify({provider:'telephony_launch',checked_at:result.checkedAt,result}),redirect:'error',signal:AbortSignal.timeout(10000),
 });
 return response.ok;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const result=await checkTelephonyConnection();
  const saved=await saveTelephonyCheck(result).catch(()=>false);
  console.log(`Telephony: forwarding=${result.forwarding.routeConfigured}; inbound=${result.incoming.status}; outbound=${result.outgoing.status}; diagnostic_saved=${saved}. No calls or messages sent.`);
 }catch{console.log('Telephony: diagnostic unavailable. No calls or messages sent.');}
}
