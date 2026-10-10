import {canSaveSharedIntegrationCheck} from './integration-check-write-policy.mjs';
// Deployment preflight: bounded provider GETs only. Never dials, sends, purchases,
// changes routing, enables a release, or exposes credentials/provider payloads.
import {pathToFileURL} from 'node:url';
import {readOwnerForwarding} from '../lib/owner-forwarding-readiness.ts';
import {readRecordedReceptionReadiness} from '../lib/recorded-reception-readiness.ts';
import {readRecordedOutboundReadiness} from '../lib/recorded-outbound-readiness.ts';
import {readVoiceUsagePolicies} from '../lib/voice-usage-service.ts';
import {observeLegacyReceptionCosts} from '../lib/legacy-reception-cost-observation.ts';
import {readRecordingReview,recordingAgentMatches,object,sha} from '../lib/required-call-recording.ts';
import {automaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {receptionReviewReport} from './reception-review-report.mjs';

export async function checkTelephonyConnection(env=process.env,fetcher=fetch,onOutboundAgent){
 const reads=await Promise.allSettled([
  readOwnerForwarding(env,fetcher),
  readRecordedReceptionReadiness(env,{fetcher}),
  readRecordedOutboundReadiness(env,{fetcher,onAgent:onOutboundAgent}),
  observeLegacyReceptionCosts(env,fetcher),
 ]);
 const value=(i)=>reads[i].status==='fulfilled'?reads[i].value:null;
 const forwarding=value(0),incoming=value(1),outgoing=value(2);
 return {
  checkedAt:new Date().toISOString(),mode:'read_only',callsPlaced:0,messagesSent:0,
  release:{inbound:env.ICASH_RECORDED_RECEPTION_READY==='true',outbound:env.ICASH_RECORDED_OUTBOUND_READY==='true',sms:env.ICASH_SMS_WORK_READY==='true'||env.ICASH_LIVE_WORK_READY==='true'},
  forwarding:forwarding?{status:'checked',enabled:forwarding.enabled,providerStatus:forwarding.providerStatus,routeConfigured:forwarding.routeConfigured}:{status:'unavailable',routeConfigured:false},
  incoming:incoming??{status:'unavailable',branches:[],phone:{status:'unavailable',bindingVerified:false,route:'unknown'}},
  outgoing:outgoing??{status:'unavailable',providerChecksPass:false},
  legacyCosts:value(3)??[],
  billingPolicies:readVoiceUsagePolicies(env.VOICE_USAGE_POLICIES_JSON,env.VOICE_USAGE_POLICY_ACTIVATIONS_JSON).filter(p=>typeof p.version==='string'&&p.version.startsWith('required-audio-30d-speech-v1:')).map(p=>({
   rateId:p.rateId,version:p.version,enabled:p.enabled===true,operation:p.operation,validUntil:p.validUntil,
   componentCount:Object.keys(p.components??{}).length,
   carrierAccountMatches:p.components?.twilio?.twilioAccountSid===env.TWILIO_ACCOUNT_SID,
   carrierAgentMatches:p.components?.twilio?.agentId===outgoing?.agentId,
   carrierFromMatches:p.components?.twilio?.from===env.CONTIGUITY_FROM,
   carrierKind:p.components?.twilio?.kind==='outbound_carrier_estimate',
   recordingAddons:p.components?.other?.kind==='recording_addon_estimate',
  })),
  liveCallVerification:'not_tested',
 };
}

// Private, immutable review evidence. Never rewrites an approval, provider or job.
export async function saveOutboundReviewReport(result,agent,env=process.env,fetcher=fetch){
 const r=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON),out=result.outgoing;
 if(!canSaveSharedIntegrationCheck(env)||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!r||!agent||out.checks?.activeReviewMatches!==false||!out.observedConfigHash)return false;
 const a=object(agent),prompt=object(object(object(a.conversation_config).agent).prompt).prompt;
 const report={status:'needs_review',agentId:r.agentId,branchId:r.branchId,versionId:r.versionId,sourceConfigHash:r.configHash,observedHash:out.observedConfigHash,
  checks:out.checks,structuralChecksPass:recordingAgentMatches({...r,configHash:out.observedConfigHash},a),
  sellerPromptMatches:r.offerPolicy==='automatic_offer_v9'&&prompt===automaticOfferReceptionPrompt,
  promptHash:typeof prompt==='string'?sha(prompt):null,
  configuration:receptionReviewReport(a,[env.ELEVENLABS_API_KEY,env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY]),providerWrites:false,calls:false};
 const response=await fetcher(env.SUPABASE_URL+'/rest/v1/icash_integration_checks?on_conflict=provider',{method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({provider:'outbound_config_review_20261010_'+out.observedConfigHash.slice(0,12),checked_at:result.checkedAt,result:report}),redirect:'error',signal:AbortSignal.timeout(10000)});
 return response.ok;
}

export async function saveTelephonyCheck(result,env=process.env,fetcher=fetch){
 if(!canSaveSharedIntegrationCheck(env)||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)return false;
 const response=await fetcher(`${env.SUPABASE_URL}/rest/v1/icash_integration_checks?on_conflict=provider`,{
  method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},
  body:JSON.stringify({provider:'telephony_launch',checked_at:result.checkedAt,result}),redirect:'error',signal:AbortSignal.timeout(10000),
 });
 return response.ok;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let agent;
  const result=await checkTelephonyConnection(process.env,fetch,value=>{agent=value;});
  const saved=await saveTelephonyCheck(result).catch(()=>false);
  const reviewSaved=await saveOutboundReviewReport(result,agent).catch(()=>false);
  if(reviewSaved)console.log('Outbound configuration mismatch saved for private review. No approval or provider changed.');
  console.log(`Telephony: forwarding=${result.forwarding.routeConfigured}; inbound=${result.incoming.status}; outbound=${result.outgoing.status}; diagnostic_saved=${saved}. No calls or messages sent.`);
 }catch{console.log('Telephony: diagnostic unavailable. No calls or messages sent.');}
}
