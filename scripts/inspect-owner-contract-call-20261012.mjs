// Read the owner's already completed failed call once. No calls, signing
// requests, messages or paid simulations; credentials stay inside production.
import {createRecordedReceptionProviders} from '../lib/recorded-reception-provider.ts';
import {boundedBytes} from '../lib/required-call-recording-provider.ts';
const account='48dfb798-8c1a-404f-88c0-c396cc067062';
const call='ffeef239-af04-46e2-88c9-e9f2c812f7d7';
const conversation='conv_5301m4s3jxkyevst1z0enmgkgqca';
const provider='owner_contract_call_20261012_2227';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>Date.parse('2026-10-13T22:00:00Z'))process.exit(0);
try{
 const env=process.env;
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.ELEVENLABS_API_KEY)throw Error('Configuration required');
 async function db(path,method='GET',body){
  const r=await fetch(env.SUPABASE_URL+'/rest/v1/'+path,{method,headers:{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('Diagnostic storage unavailable');
  const text=(await boundedBytes(r,262144)).toString('utf8');return text?JSON.parse(text):null;
 }
 if((await db('icash_integration_checks?provider=eq.'+provider+'&select=provider')).length)process.exit(0);
 const [saved]=await db(`icash_live_conversations?id=eq.${call}&account_id=eq.${account}&select=id,agent_id,conversation_id,state,completed_at`);
 if(saved?.conversation_id!==conversation||saved.state!=='complete'||!saved.completed_at)throw Error('Completed call binding required');
 const raw=await createRecordedReceptionProviders(env).conversation(conversation);
 if(raw.conversation_id!==conversation||raw.agent_id!==saved.agent_id)throw Error('Provider call binding required');
 const redact=value=>JSON.parse(JSON.stringify(value,(key,value)=>{
  if(/secret|token|authorization|headers|cookie|password|api_key|conversationHistory/i.test(key))return '[redacted]';
  if(typeof value==='string'){
   for(const secret of [env.ELEVENLABS_API_KEY,env.SUPABASE_SECRET_KEY])value=value.replaceAll(secret,'[redacted]');
   if(/^[\[{]/.test(value.trim()))try{return redact(JSON.parse(value));}catch{}
   return value.replace(/https?:\/\/[^\s"<>]+/g,'[url redacted]').slice(0,8000);
  }
  return value;
 }));
 const turns=Array.isArray(raw.transcript)?raw.transcript.slice(0,100).map(t=>({role:t.role,message:t.message,time:t.time_in_call_secs,toolCalls:t.tool_calls,toolResults:t.tool_results})):[];
 await db('icash_integration_checks?on_conflict=provider','POST',{provider,checked_at:new Date().toISOString(),result:redact({account,call,conversation,status:raw.status,turns})});
 console.log('Owner contract call inspection saved. No provider writes or new calls.');
}catch{console.log('Owner contract call inspection unavailable. No calls placed.');}
