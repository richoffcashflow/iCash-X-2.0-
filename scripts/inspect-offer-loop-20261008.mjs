// Fixed, read-only provider inspection requested by the owner for this failed call.
// Evidence stays in the existing service-only diagnostics table, never build logs.
import {createRecordedReceptionProviders} from '../lib/recorded-reception-provider.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
const accountId='48dfb798-8c1a-404f-88c0-c396cc067062';
const sessionId='29c89081-c64f-46e2-8acc-bf87726f1776';
const conversationId='conv_4601m4epktn1f3xbk6pzmv0x1rhr';
const callSid='CA3b78b3d7ffce017d88d60170b1a7cba8';
const provider='owner_call_20261008_2127_agreement';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'
  ||Date.now()>Date.parse('2026-10-09T17:30:00Z'))process.exit(0);
try{
 const env=process.env;
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY)throw Error('CONFIGURATION_REQUIRED');
 async function db(path,method='GET',body){
  const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=merge-duplicates'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('DIAGNOSTIC_STORE_UNAVAILABLE');
  return r.status===204||r.headers.get('content-length')==='0'?null:JSON.parse((await boundedBytes(r,262144)).toString('utf8'));
 }
 const prior=await db('icash_integration_checks?provider=eq.'+provider+'&select=provider');
 if(prior.length){console.log('Owner call diagnostic: already saved.');process.exit(0);}
 const [row]=await db('icash_call_recordings?id=eq.'+sessionId+'&account_id=eq.'+accountId+'&select=id,account_id,call_sid,conversation_id,agent_id,branch_id,version_id,from_phone,to_phone');
 if(row?.id!==sessionId||row.account_id!==accountId||row.call_sid!==callSid||row.conversation_id!==conversationId)throw Error('CALL_BINDING_REQUIRED');
 const api=createRecordedReceptionProviders(env);
 const [conversation,call]=await Promise.all([api.conversation(conversationId),api.getCall(callSid)]);
 const phone=conversation.metadata?.phone_call;
 if(conversation.conversation_id!==conversationId||conversation.agent_id!==row.agent_id||conversation.branch_id!==row.branch_id||conversation.version_id!==row.version_id||conversation.user_id!=='icash-recorded:'+row.id||phone?.call_sid!==callSid||phone?.external_number!==row.to_phone||phone?.agent_number!==row.from_phone||call.sid!==callSid||call.account_sid!==env.TWILIO_ACCOUNT_SID)throw Error('PROVIDER_BINDING_REQUIRED');
 const redact=(value)=>JSON.parse(JSON.stringify(value,(key,value)=>{
  if(/secret|token|authorization|headers|cookie|password|api_key/i.test(key))return '[redacted]';
  if(typeof value==='string'){
   for(const secret of [env.ELEVENLABS_API_KEY,env.TWILIO_AUTH_TOKEN,env.SUPABASE_SECRET_KEY])if(secret)value=value.replaceAll(secret,'[redacted]');
   return value.slice(0,8000);
  }
  return value;
 }));
 const turns=Array.isArray(conversation.transcript)?conversation.transcript.slice(0,160).map(t=>({role:t.role,message:t.message,time:t.time_in_call_secs,interrupted:t.interrupted,toolCalls:t.tool_calls,toolResults:t.tool_results,feedback:t.feedback})):[];
 const metadata=conversation.metadata??{};
 const result=redact({accountId,sessionId,conversationId,callSid,status:conversation.status,
  terminationReason:metadata.termination_reason,error:metadata.error,warnings:metadata.warnings,
  guardrails:metadata.guardrails,analysis:conversation.analysis,turns,
  carrier:{status:call.status,duration:call.duration,startTime:call.start_time,endTime:call.end_time},
  branchId:row.branch_id,versionId:row.version_id});
 await db('icash_integration_checks?on_conflict=provider','POST',{provider,checked_at:new Date().toISOString(),result});
 console.log('Owner call diagnostic: saved for the exact requested call. No call placed.');
}catch{console.log('Owner call diagnostic: inspection unavailable.');}
