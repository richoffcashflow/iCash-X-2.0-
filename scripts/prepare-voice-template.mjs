// Production deployment preparation. GETs plus a guarded template-hash update;
// never places a call, changes phone routing, or enables a provider capability.
import {pathToFileURL} from 'node:url';
import {readRecordingReview} from '../lib/required-call-recording.ts';
import {readRecordedOutboundReadiness} from '../lib/recorded-outbound-readiness.ts';
export async function prepareVoiceTemplate(env=process.env,fetcher=fetch,inspect=readRecordedOutboundReadiness){
 if(env.VERCEL_ENV!=='production'||env.ICASH_RECORDED_OUTBOUND_READY!=='true')return {status:'not_requested'};
 const review=readRecordingReview(env.RECORDED_OUTBOUND_REVIEW_JSON);
 if(!review||!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('VOICE_TEMPLATE_CONFIGURATION_REQUIRED');
 const base=env.SUPABASE_URL+'/rest/v1/icash_voice_production_template?id=eq.1';
 const request=async(method='GET',hash)=>{
  const r=await fetcher(base+(hash?'&agent_id=eq.'+encodeURIComponent(review.agentId)+'&agent_config_hash=eq.'+hash:''),{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'return=representation'},...(hash?{body:JSON.stringify({agent_config_hash:review.configHash})}:{}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok||r.redirected)throw Error('VOICE_TEMPLATE_READBACK_REQUIRED');
  const rows=await r.json();if(!Array.isArray(rows)||rows.length!==1)throw Error('UNIQUE_VOICE_TEMPLATE_REQUIRED');return rows[0];
 };
 const before=await request();
 const matches=t=>t.enabled&&t.agent_id===review.agentId&&t.max_duration_seconds===review.maxTotalSeconds&&Array.isArray(t.required_tool_ids)&&JSON.stringify([...t.required_tool_ids].sort())===JSON.stringify([...review.toolIds].sort());
 if(!matches(before))throw Error('VOICE_TEMPLATE_CAPABILITY_REVIEW_REQUIRED');
 if(before.agent_config_hash===review.configHash)return {status:'current'};
 const observed=await inspect(env,{fetcher});
 if(!observed.providerChecksPass||observed.observedConfigHash!==review.configHash||observed.observedVersionId!==review.versionId)throw Error('VOICE_TEMPLATE_PROVIDER_REVIEW_REQUIRED');
 const after=await request('PATCH',before.agent_config_hash);
 if(!matches(after)||after.agent_config_hash!==review.configHash)throw Error('VOICE_TEMPLATE_UPDATE_UNCONFIRMED');
 return {status:'synchronized'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{console.log('New-account voice template:',JSON.stringify(await prepareVoiceTemplate()));}
 catch(e){console.error('New-account voice template:',e instanceof Error&&/^[A-Z_]+$/.test(e.message)?e.message:'VERIFICATION_FAILED');process.exitCode=1;}
}
