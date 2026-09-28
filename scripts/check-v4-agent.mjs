// Owner-authorized private-agent compatibility check. Starts no calls and creates no access grants.
import {elevenRequest} from '../lib/elevenlabs.ts';
if(process.env.VERCEL_ENV!=='preview'||process.env.VERCEL_GIT_COMMIT_REF!=='elevenlabs-voice-verification')process.exit(0);
try{
 const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/icash_voice_test_config?id=eq.1&select=agent_id`,{headers:{apikey:process.env.SUPABASE_SECRET_KEY,Authorization:`Bearer ${process.env.SUPABASE_SECRET_KEY}`},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('CONFIG_UNAVAILABLE');const [config]=await r.json();if(!config?.agent_id)throw Error('PRIVATE_AGENT_MISSING');
 const path=`/v1/convai/agents/${encodeURIComponent(config.agent_id)}`;
 const before=await elevenRequest(path);
 if(before.name!=='iCash X — private voice verification'||!before.platform_settings?.auth?.enable_auth||before.conversation_config?.conversation?.max_duration_seconds!==180)throw Error('PRIVATE_AGENT_GUARDS_MISSING');
 const result=await fetch(`https://api.elevenlabs.io${path}`,{method:'PATCH',headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({conversation_config:{tts:{model_id:'eleven_v4_turbo',speed:1}}}),signal:AbortSignal.timeout(20000),redirect:'error'});
 let fields=[];
 if(result.status===422){const body=await result.json();if(Array.isArray(body.detail))fields=body.detail.map(e=>(e.loc??[]).filter(x=>typeof x==='string'&&/^[a-z_]+$/.test(x)).join('.')).slice(0,5);}
 const after=await elevenRequest(path);
 const model=after.conversation_config?.tts?.model_id;
 if(!after.platform_settings?.auth?.enable_auth||after.conversation_config?.conversation?.max_duration_seconds!==180||after.conversation_config?.tts?.voice_id!==before.conversation_config?.tts?.voice_id)throw Error('PRIVATE_AGENT_VERIFICATION_FAILED');
 console.log('ICASH_V4_AGENT_CHECK',JSON.stringify({status:result.status,validationFields:fields,activeModel:model,previousModel:before.conversation_config.tts.model_id,v4Enabled:result.ok&&model==='eleven_v4_turbo',unchanged:JSON.stringify(after.conversation_config.tts)===JSON.stringify(before.conversation_config.tts),callsStarted:0}));
 if(!result.ok&&![400,422].includes(result.status))throw Error(`V4_CHECK_HTTP_${result.status}`);
}catch(error){console.error('ICASH_V4_CHECK_FAILED',/^[A-Z_0-9]+$/.test(error.message)?error.message:'UNKNOWN_OUTCOME_NO_RETRY');process.exitCode=1;}
