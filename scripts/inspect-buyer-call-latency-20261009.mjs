// Read-only inspection of the owner's failed buyer callback. No calls or texts.
import {createRecordedReceptionProviders} from '../lib/recorded-reception-provider.ts';
import {receptionConversationMatches,receptionLiveConversationMatches,incomingCallIdentityMatches} from '../lib/recorded-reception.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
const accountId='48dfb798-8c1a-404f-88c0-c396cc067062';
const sessionId='d6913388-da56-4d46-862d-659ba980e2cd';
const conversationId='conv_6601m4h59akeezmrerfe91hzh227';
const callSid='CAdc77993e6b35e76f639bb5c83bb06306';
const provider='owner_buyer_call_20261009_2022_turn_metrics';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>Date.parse('2026-10-10T00:00:00Z'))process.exit(0);
try{
 const env=process.env;
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('CONFIGURATION_REQUIRED');
 async function db(path,method='GET',body){
  const response=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('DIAGNOSTIC_STORE_UNAVAILABLE');
  return response.status===204||response.headers.get('content-length')==='0'?null:JSON.parse((await boundedBytes(response,262144)).toString('utf8'));
 }
 const prior=await db('icash_integration_checks?provider=eq.'+provider+'&select=provider');
 if(prior.length)process.exit(0);
 const row=await db('rpc/icash_get_recorded_reception_session','POST',{p_id:sessionId,p_account:accountId,p_operation:null});
 if(row?.id!==sessionId||row.account_id!==accountId||row.call_sid!==callSid||row.conversation_id!==conversationId)throw Error('CALL_BINDING_REQUIRED');
 const api=createRecordedReceptionProviders(env);
 const [conversation,call,agent]=await Promise.all([api.conversation(conversationId),api.getCall(callSid),api.agent(row.configuration)]);
 // This diagnostic deliberately records absent initiation fields. The canonical
 // provider session, agent/version, user and carrier identities must still match.
 // This does not relax production settlement or grant any action authority.
 if(!receptionLiveConversationMatches(row,conversation)||!incomingCallIdentityMatches(row,call))throw Error('PROVIDER_BINDING_REQUIRED');
 const redact=value=>JSON.parse(JSON.stringify(value,(key,value)=>{
  if(/secret|token|authorization|headers|cookie|password|api_key/i.test(key))return '[redacted]';
  if(typeof value==='string'){
   for(const secret of [env.ELEVENLABS_API_KEY,env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY])if(secret)value=value.replaceAll(secret,'[redacted]');
   return value.slice(0,8000);
  }
  return value;
 }));
 const turns=Array.isArray(conversation.transcript)?conversation.transcript.slice(0,60).map(t=>({role:t.role,message:t.message,time:t.time_in_call_secs,interrupted:t.interrupted,toolCalls:t.tool_calls,toolResults:t.tool_results,feedback:t.feedback,metrics:t.conversation_turn_metrics,triggeredGuardrails:t.triggered_guardrails,llmUsage:t.llm_usage,source:t.source_medium,originalMessage:t.original_message,agentMetadata:t.agent_metadata,keys:Object.keys(t)})):[];
 const metadata=conversation.metadata??{};
 const result=redact({accountId,sessionId,conversationId,callSid,status:conversation.status,fullBinding:receptionConversationMatches(row,conversation),initiation:conversation.conversation_initiation_client_data,
  metadata,conversationKeys:Object.keys(conversation),terminationReason:metadata.termination_reason,error:metadata.error,warnings:metadata.warnings,guardrails:metadata.guardrails,analysis:conversation.analysis,turns,
  agent:{firstMessage:agent.conversation_config?.agent?.first_message,dynamicVariables:agent.conversation_config?.agent?.dynamic_variables,conversation:agent.conversation_config?.conversation,turn:agent.conversation_config?.turn,llm:agent.conversation_config?.agent?.prompt?.llm},
  carrier:{status:call.status,duration:call.duration,startTime:call.start_time,endTime:call.end_time}});
 await db('icash_integration_checks?on_conflict=provider','POST',{provider,checked_at:new Date().toISOString(),result});
 console.log('Owner buyer callback diagnostic saved. No call placed.');
}catch{console.log('Owner buyer callback diagnostic unavailable.');}
