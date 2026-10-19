import {canSaveSharedIntegrationCheck} from './integration-check-write-policy.mjs';
// Deployment preflight: bounded provider GETs only. Never dials, sends, purchases,
// changes routing, enables a release, or exposes credentials/provider payloads.
import {pathToFileURL} from 'node:url';
import {readOwnerForwarding} from '../lib/owner-forwarding-readiness.ts';
import {readRecordedReceptionReadiness} from '../lib/recorded-reception-readiness.ts';
import {readActiveReceptionReadiness} from '../lib/active-reception-readiness.ts';
import {readRecordedOutboundReadiness} from '../lib/recorded-outbound-readiness.ts';
import {readVoiceUsagePolicies} from '../lib/voice-usage-service.ts';
import {observeLegacyReceptionCosts} from '../lib/legacy-reception-cost-observation.ts';
import {readRecordingReview,recordingAgentMatches,object,sha,canonical} from '../lib/required-call-recording.ts';
import {automaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {receptionReviewReport} from './reception-review-report.mjs';

export async function checkTelephonyConnection(env=process.env,fetcher=fetch,onOutboundAgent,onIncomingAgent){
 const reads=await Promise.allSettled([
  readOwnerForwarding(env,fetcher),
  readRecordedReceptionReadiness(env,{fetcher}),
  readRecordedOutboundReadiness(env,{fetcher,onAgent:onOutboundAgent}),
  observeLegacyReceptionCosts(env,fetcher),
  readActiveReceptionReadiness(env,fetcher,onIncomingAgent),
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
  activeIncoming:value(4)??{status:'unavailable',providerChecksPass:false},
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

// Capture an unexplained active-template mismatch for private review. This
// cannot authorize a configuration or change the exact runtime admission gate.
export async function saveActiveIncomingReviewReport(result,agent,config,env=process.env,fetcher=fetch){
 const out=result.activeIncoming,a=object(agent),c=object(config);
 if(!canSaveSharedIntegrationCheck(env)||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY
  ||out?.status!=='checked'||out.hashMatch!=='none'||!agent||!config
  ||!/^[a-f0-9]{64}$/.test(out.observedHash??'')||!/^[a-f0-9]{64}$/.test(out.approvedHash??'')
  ||out.configId!==c.id||out.approvedHash!==c.config_hash||a.agent_id!==c.agent_id
  ||out.branchId!==a.branch_id||out.branchId!==c.branch_id
  ||out.versionId!==a.version_id||out.versionId!==c.reviewed_version_id)return false;
 const snapshot={main_branch_id:a.main_branch_id,agent_id:a.agent_id,branch_id:a.branch_id,version_id:a.version_id,conversation_config:a.conversation_config,platform_settings:a.platform_settings,workflow:a.workflow??null,procedures:a.procedures??null};
 if(sha(JSON.stringify(canonical(snapshot)))!==out.observedHash)return false;
 const report={status:'needs_review',sourceConfigId:c.id,sourceConfigHash:c.config_hash,observedHash:out.observedHash,
  agentId:c.agent_id,branchId:c.branch_id,versionId:c.reviewed_version_id,checks:out.checks,
  configuration:receptionReviewReport(a,[env.ELEVENLABS_API_KEY,env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY]),
  providerWrites:false,calls:false,approvalChanged:false};
 const response=await fetcher(env.SUPABASE_URL+'/rest/v1/icash_integration_checks?on_conflict=provider',{method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({provider:'active_incoming_config_review_'+out.observedHash.slice(0,12),checked_at:result.checkedAt,result:report}),redirect:'error',signal:AbortSignal.timeout(10000)});
 return response.ok;
}

// Immutable, service-only cost-rule evidence. Refuse the snapshot if redaction
// would change it; never store credentials or alter a billing approval here.
export async function saveVoiceUsagePolicyReview(env=process.env,fetcher=fetch){
 if(!canSaveSharedIntegrationCheck(env)||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.VOICE_USAGE_POLICIES_JSON)return false;
 const policies=JSON.parse(env.VOICE_USAGE_POLICIES_JSON);
 if(!Array.isArray(policies)||!policies.length||policies.length>100)return false;
 const serialized=JSON.stringify(policies);
 const safe=receptionReviewReport({conversation_config:{policies}},[env.ELEVENLABS_API_KEY,env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY]).conversation_config.policies;
 if(JSON.stringify(safe)!==serialized)return false;
 const policyHash=sha(serialized);
 const response=await fetcher(env.SUPABASE_URL+'/rest/v1/icash_integration_checks?on_conflict=provider',{method:'POST',headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({provider:'voice_usage_policy_review_'+policyHash.slice(0,12),checked_at:new Date().toISOString(),result:{policies,policyHash,providerWrites:false,charges:false}}),redirect:'error',signal:AbortSignal.timeout(10000)});
 return response.ok;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  let agent,incomingAgent,incomingConfig;
  const result=await checkTelephonyConnection(process.env,fetch,value=>{agent=value;},(value,config)=>{incomingAgent=value;incomingConfig=config;});
  const saved=await saveTelephonyCheck(result).catch(()=>false);
  const reviewSaved=await saveOutboundReviewReport(result,agent).catch(()=>false);
  const incomingReviewSaved=await saveActiveIncomingReviewReport(result,incomingAgent,incomingConfig).catch(()=>false);
  await saveVoiceUsagePolicyReview().catch(()=>false);
  if(reviewSaved)console.log('Outbound configuration mismatch saved for private review. No approval or provider changed.');
  if(incomingReviewSaved)console.log('Active incoming configuration mismatch saved for private review. No approval or provider changed.');
  console.log(`Telephony: forwarding=${result.forwarding.routeConfigured}; inbound=${result.incoming.status}; outbound=${result.outgoing.status}; diagnostic_saved=${saved}. No calls or messages sent.`);
 }catch{console.log('Telephony: diagnostic unavailable. No calls or messages sent.');}
}
