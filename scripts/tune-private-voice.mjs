// Explicit maintenance only: existing private test agent; no conversations or telephone calls.
import {elevenRequest,voiceTestAgent} from '../lib/elevenlabs.ts';
if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='elevenlabs-voice-verification')process.exit(0);
try {
 const response=await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_voice_test_config?id=eq.1&select=agent_id`,{headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('CONFIG_UNAVAILABLE');
 const [config]=await response.json();
 if(!config?.agent_id)throw Error('PRIVATE_AGENT_MISSING');
 const path=`/v1/convai/agents/${encodeURIComponent(config.agent_id)}`;
 const before=await elevenRequest(path);
 if(before.name!=='iCash X — private voice verification'||!before.platform_settings?.auth?.enable_auth||before.conversation_config?.conversation?.max_duration_seconds!==180)throw Error('PRIVATE_AGENT_GUARDS_MISSING');
 const {voices}=await elevenRequest('/v1/voices');
 // Choose only a provider premade voice available to this account, never a customer's clone.
 const voice=['Chris','Eric'].map(name=>voices.find(v=>v.category==='premade'&&(v.name===name||v.name.startsWith(name+' ')))).find(Boolean);
 if(!voice){console.log('AVAILABLE_PREMADE_VOICES',JSON.stringify(voices.filter(v=>v.category==='premade').map(v=>({name:v.name,labels:v.labels}))));throw Error('CONVERSATIONAL_PREMADE_VOICE_UNAVAILABLE');}
 const desired=voiceTestAgent(voice.voice_id).conversation_config;
 const result=await fetch(`https://api.elevenlabs.io${path}`,{method:'PATCH',headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({conversation_config:{agent:desired.agent,tts:desired.tts,turn:desired.turn,conversation:desired.conversation}}),signal:AbortSignal.timeout(20000),redirect:'error'});
 if(!result.ok)throw Error(`VOICE_UPDATE_HTTP_${result.status}`);
 const after=await elevenRequest(path);
 if(after.conversation_config?.tts?.voice_id!==voice.voice_id||after.conversation_config?.tts?.model_id!==desired.tts.model_id||!after.platform_settings?.auth?.enable_auth||after.conversation_config?.conversation?.max_duration_seconds!==180)throw Error('VOICE_UPDATE_VERIFICATION_FAILED');
 if(after.conversation_config.turn?.turn_eagerness!=='eager'||after.conversation_config.turn?.speculative_turn!==desired.turn.speculative_turn||!after.conversation_config.conversation?.client_events?.includes('interruption')||after.conversation_config.agent?.prompt?.prompt!==desired.agent.prompt.prompt)throw Error('VOICE_BEHAVIOR_VERIFICATION_FAILED');
 console.log('ICASH_VOICE_TUNED',JSON.stringify({voice:voice.name,model:after.conversation_config.tts.model_id,turnEagerness:after.conversation_config.turn?.turn_eagerness,speculativeTurn:after.conversation_config.turn?.speculative_turn,interruptions:after.conversation_config.conversation?.client_events?.includes('interruption'),private:true,callsStarted:0}));
}catch(error){console.error('ICASH_VOICE_TUNE_FAILED',/^([A-Z_0-9]+)$/.test(error.message)?error.message:'UNKNOWN_OUTCOME_CHECK_AGENT_BEFORE_RETRY');process.exitCode=1;}
