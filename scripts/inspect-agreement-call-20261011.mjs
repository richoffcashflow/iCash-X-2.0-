// Read-only provider inspection for the owner's reported failed agreement call.
// Keep evidence in the existing service-only diagnostic table; never print it.
const accountId='48dfb798-8c1a-404f-88c0-c396cc067062';
const recordingId='ca24ba36-fbeb-4957-b1af-06e0019bad1b';
const conversationId='conv_7701m4pgnpqwekvaf0hs4kbxr5t6';
const provider='owner_agreement_call_20261011_2218';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main'||Date.now()>Date.parse('2026-10-13T00:00:00Z'))process.exit(0);
try{
 const env=process.env;
 if(!env.SUPABASE_URL||!env.SUPABASE_SECRET_KEY||!env.ELEVENLABS_API_KEY)throw Error('CONFIGURATION_REQUIRED');
 async function json(url,headers,method='GET',body){
  const r=await fetch(url,{method,headers:{...headers,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw Error('DIAGNOSTIC_HTTP_'+r.status);
  if(r.status===204||r.headers.get('content-length')==='0')return null;
  const text=await r.text();if(text.length>1048576)throw Error('DIAGNOSTIC_TOO_LARGE');return JSON.parse(text);
 }
 const db=(path,method,body)=>json(env.SUPABASE_URL+'/rest/v1/'+path,{apikey:env.SUPABASE_SECRET_KEY,Authorization:'Bearer '+env.SUPABASE_SECRET_KEY,Prefer:'resolution=ignore-duplicates'},method,body);
 if((await db('icash_integration_checks?provider=eq.'+provider+'&select=provider')).length)process.exit(0);
 const [row]=await db('icash_call_recordings?id=eq.'+recordingId+'&account_id=eq.'+accountId+'&select=id,conversation_id,agent_id,branch_id,version_id,call_sid,to_phone,from_phone');
 if(row?.id!==recordingId||row.conversation_id!==conversationId)throw Error('RECORDING_BINDING_REQUIRED');
 const get=path=>json('https://api.elevenlabs.io/v1/convai/'+path,{'xi-api-key':env.ELEVENLABS_API_KEY});
 const [c,a]=await Promise.all([get('conversations/'+conversationId),get('agents/'+row.agent_id+'?branch_id='+row.branch_id)]);
 const phone=c.metadata?.phone_call;
 if(c.conversation_id!==conversationId||c.agent_id!==row.agent_id||c.branch_id!==row.branch_id||c.version_id!==row.version_id||c.user_id!=='icash-recorded:'+row.id||phone?.call_sid!==row.call_sid||phone.direction!=='outbound'||phone.external_number!==row.to_phone||phone.agent_number!==row.from_phone)throw Error('PROVIDER_BINDING_REQUIRED');
 const secrets=[env.ELEVENLABS_API_KEY,env.SUPABASE_SECRET_KEY];
 const clean=value=>JSON.parse(JSON.stringify(value,(key,v)=>{
  if(/secret|authorization|headers|cookie|password|api_key|dynamic_variables|conversation_initiation_client_data/i.test(key))return '[redacted]';
  if(typeof v==='string'){for(const s of secrets)if(s)v=v.replaceAll(s,'[redacted]');v=v.replace(/Bearer\s+\S+/gi,'Bearer [redacted]');return v.slice(0,20000);}return v;
 }));
 const p=a.conversation_config?.agent?.prompt??{};
 const result=clean({readOnly:true,callsPlaced:0,messagesSent:0,recordingId,conversationId,status:c.status,terminationReason:c.metadata?.termination_reason,error:c.metadata?.error,warnings:c.metadata?.warnings,
  turns:(c.transcript??[]).slice(0,100).map(t=>({role:t.role,message:t.message,seconds:t.time_in_call_secs,toolCalls:t.tool_calls,toolResults:t.tool_results,feedback:t.feedback})),
  agent:{versionMatches:a.version_id===row.version_id,llm:p.llm,maxTokens:p.max_tokens,toolIds:p.tool_ids,toolChoice:p.tool_choice,workflow:a.workflow??null}});
 await db('icash_integration_checks?on_conflict=provider','POST',{provider,checked_at:new Date().toISOString(),result});
 console.log('Requested agreement call diagnostic saved. No calls or messages sent.');
}catch(error){console.log('Agreement call diagnostic unavailable:',error instanceof Error&&/^[A-Z_0-9]+$/.test(error.message)?error.message:'INSPECTION_FAILED');}
