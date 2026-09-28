// One-shot owner-authorized acceptance check. Run only on the verification preview branch.
// No telephone API, real seller data, customer balances, or customer analytics are involved.
import {elevenRequest,voiceTestAgent} from '../lib/elevenlabs.ts';
import {voiceResult} from '../lib/voice-result.ts';
import {mkdir,writeFile} from 'node:fs/promises';
async function db(path,method='GET',body){
 const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`,{method,headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000),redirect:'error'});
 if(!r.ok)throw Error(`VOICE_DATABASE_${r.status}`);return r.json();
}
const report={sellerCallingEnabled:false,customerCreditsUsed:0,syntheticInput:true,microphoneVerified:false};
if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='elevenlabs-voice-verification')process.exit(0);
try{
 let [cfg]=await db('icash_voice_test_config?id=eq.1');
 if(!cfg.agent_id){
  const claimed=await db('icash_voice_test_config?id=eq.1&provisioning_claimed=eq.false','PATCH',{provisioning_claimed:true});
  if(!claimed.length)throw Error('VOICE_PROVISIONING_REVIEW_REQUIRED');
  report.stage='read_voices';
  const voices=await elevenRequest('/v1/voices');
  const voice=voices.voices?.find(v=>v.category==='premade'&&v.name==='Adam')??voices.voices?.find(v=>v.category==='premade');
  if(!voice)throw Error('VOICE_PREMADE_VOICE_MISSING');
  report.stage='create_private_agent';
  const agent=await elevenRequest('/v1/convai/agents/create',voiceTestAgent(voice.voice_id));
  if(!agent.agent_id)throw Error('VOICE_AGENT_ID_MISSING');
  [cfg]=await db('icash_voice_test_config?id=eq.1','PATCH',{agent_id:agent.agent_id,enabled:true});
 }
 report.stage='verify_private_agent';
 const agent=await elevenRequest(`/v1/convai/agents/${cfg.agent_id}`);
 if(!agent.platform_settings?.auth?.enable_auth||agent.conversation_config?.conversation?.max_duration_seconds!==180)throw Error('VOICE_AGENT_GUARDS_MISSING');
 report.privateAgentReady=true;
 // The impossible-to-guess preimage of this marker is not a usable API access token.
 const hash='0'.repeat(64);
 let [existing]=await db(`icash_voice_test_sessions?token_hash=eq.${hash}&limit=1`);
 if(!existing){
  await db('icash_voice_test_access','POST',{token_hash:hash,max_sessions:1,expires_at:new Date(Date.now()+86400000).toISOString()});
  const sid=await db('rpc/icash_reserve_voice_test','POST',{p_hash:hash});
  const {signed_url}=await elevenRequest(`/v1/convai/conversation/get-signed-url?agent_id=${cfg.agent_id}&include_conversation_id=true`);
  let convId='',audioChunks=0,agentTurns=0;
  const next=new Date(Date.now()+86400000);
  const date=new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'long',day:'numeric'}).format(next);
  await new Promise((resolve,reject)=>{
   const socket=new WebSocket(signed_url);let completed=false;const timers=[];
   const finish=(error)=>{if(completed)return;completed=true;timers.forEach(clearTimeout);socket.close();error?reject(error):resolve();};
   timers.push(setTimeout(()=>finish(Error('VOICE_SMOKE_TIMEOUT')),60000));
   socket.onopen=()=>socket.send(JSON.stringify({type:'conversation_initiation_client_data',user_id:'icash-private-synthetic-test'}));
   socket.onerror=()=>finish(Error('VOICE_SMOKE_CONNECTION_FAILED'));
   socket.onclose=()=>{if(!completed)finish(Error('VOICE_SMOKE_CLOSED_EARLY'));};
   socket.onmessage=event=>{
    let data;try{data=JSON.parse(event.data);}catch{return;}
    if(data.type==='ping')socket.send(JSON.stringify({type:'pong',event_id:data.ping_event.event_id}));
    if(data.type==='conversation_initiation_metadata')convId=data.conversation_initiation_metadata_event?.conversation_id??'';
    if(data.type==='audio')audioChunks++;
    if(data.type==='agent_response'){
     agentTurns++;
     if(agentTurns===1)timers.push(setTimeout(()=>socket.send(JSON.stringify({type:'user_message',text:`I own the practice property with my spouse and we both agree to sell. It needs a roof. I am asking 120 thousand dollars. Please save a practice callback for ${date} at 2 PM in America Chicago, Central time.`})),3000));
     else if(agentTurns===2)timers.push(setTimeout(()=>socket.send(JSON.stringify({type:'user_message',text:`Yes, I confirm ${date} at 2 PM Central time in America Chicago. That exact date and time is correct. I understand it is only a practice callback. Thank you.`})),3000));
     else if(agentTurns>=3)timers.push(setTimeout(()=>finish(),5000));
    }
   };
  });
  if(!convId||!audioChunks)throw Error('VOICE_AUDIO_OR_CONVERSATION_MISSING');
  await db(`icash_voice_test_sessions?id=eq.${sid}`,'PATCH',{conversation_id:convId,state:'issued'});
  existing={id:sid,conversation_id:convId,state:'issued'};
  report.audioChunksReceived=audioChunks;report.agentTurns=agentTurns;
 }
 if(existing.state==='reserved'&&!existing.conversation_id){
  // Reconcile the one isolated test after a socket timeout. Never start another conversation on an unknown outcome.
  const page=await elevenRequest(`/v1/convai/conversations?agent_id=${cfg.agent_id}&page_size=10`);
  const candidates=(page.conversations??[]).filter(c=>c.agent_id===cfg.agent_id&&c.start_time_unix_secs*1000>=Date.parse(existing.created_at)-10000&&c.start_time_unix_secs*1000<=Date.parse(existing.created_at)+180000);
  report.recoveryCandidates=candidates.length;
  if(candidates.length===1){
   const c=await elevenRequest(`/v1/convai/conversations/${candidates[0].conversation_id}`);
   if(c.agent_id!==cfg.agent_id)throw Error('VOICE_ID_MISMATCH');
   await db(`icash_voice_test_sessions?id=eq.${existing.id}&state=eq.reserved`,'PATCH',{conversation_id:c.conversation_id,state:'issued'});
   existing={...existing,conversation_id:c.conversation_id,state:'issued'};
   report.agentMessages=c.transcript?.filter(t=>t.role==='agent').length??0;
   report.userMessages=c.transcript?.filter(t=>t.role==='user').length??0;
   report.providerStatus=c.status;
  }
 }
 if(existing.state==='complete'){report.savedResult=existing.result;}
 else if(existing.conversation_id){
  for(let i=0;i<8;i++){
   const c=await elevenRequest(`/v1/convai/conversations/${existing.conversation_id}`);
   const result=voiceResult(c,{conversationId:existing.conversation_id,agentId:cfg.agent_id});
   if(result){await db(`icash_voice_test_sessions?id=eq.${existing.id}&state=eq.issued`,'PATCH',{state:'complete',result,completed_at:new Date().toISOString(),callback_status:result.callbackStatus,callback_due_at:result.dueAt});report.savedResult=result;break;}
   await new Promise(resolve=>setTimeout(resolve,4000));
  }
 }
 // Publish only synthetic test summary and boolean assertions. Never tokens, agent IDs, real contacts, or provider raw errors.
 const result=report.savedResult;delete report.savedResult;
 report.summarySaved=!!result?.summary;report.callbackStatus=result?.callbackStatus??'processing';report.callbackDueAt=result?.dueAt??null;
 report.providerCreditUnits=result?.providerCreditUnits??null;report.providerCostUsd=result?.providerCostUsd??null;
 report.testSessionStored=!!existing?.id;
}catch(e){report.error=/^VOICE_[A-Z0-9_]+$/.test(e?.message??'')?e.message:'VOICE_VERIFICATION_FAILED';}
await mkdir('public',{recursive:true});await writeFile('public/voice-verification.json',JSON.stringify(report));
console.log('ICASH_VOICE_VERIFICATION',JSON.stringify(report));
