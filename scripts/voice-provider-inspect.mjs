// One-time read-only inspection in an existing trusted server runtime.
// Never emits credentials, prompts, raw provider configuration or errors.
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export async function inspectVoiceProvider({agentId,phoneId,env=process.env,fetcher=fetch}={}){
 const result={readOnly:true,callsPlaced:0,verified:false};
 if(!/^agent_[a-zA-Z0-9]+$/.test(agentId??'')||!/^phnum_[a-zA-Z0-9]+$/.test(phoneId??''))return {...result,error:'INVALID_PROVIDER_IDS'};
 if(!env.ELEVENLABS_API_KEY)return {...result,error:'VOICE_PROVIDER_ENVIRONMENT_MISSING'};
 try{
  const get=async path=>{const r=await fetcher(`https://api.elevenlabs.io/v1/convai/${path}`,{method:'GET',headers:{'xi-api-key':env.ELEVENLABS_API_KEY},redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error();return r.json();};
  const [agent,phone]=await Promise.all([get(`agents/${agentId}`),get(`phone-numbers/${phoneId}`)]);
  const config=agent.conversation_config,cap=config?.conversation?.max_duration_seconds,voice=config?.tts?.voice_id,tools=config?.agent?.prompt?.tool_ids;
  if(!config||typeof config!=='object'||Array.isArray(config)||!Number.isInteger(cap)||cap<60||cap>900||typeof voice!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(voice)||!Array.isArray(tools)||tools.length<2||tools.length>100||!tools.every(t=>typeof t==='string'&&/^tool_[a-zA-Z0-9]+$/.test(t)))return {...result,error:'PROVIDER_CONFIGURATION_INVALID'};
  return {...result,verified:true,agentId,phoneId,conversationConfigHash:createHash('sha256').update(JSON.stringify(config)).digest('hex'),maxDurationSeconds:cap,voiceId:voice,toolIds:tools,phoneProviderTwilio:phone.provider==='twilio',callerIdMatches:/^\+[1-9]\d{7,14}$/.test(env.CONTIGUITY_FROM??'')&&phone.phone_number===env.CONTIGUITY_FROM,authenticationEnabled:agent.platform_settings?.auth?.enable_auth===true};
 }catch{return {...result,error:'PROVIDER_READ_FAILED'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const report=await inspectVoiceProvider({agentId:process.argv[2],phoneId:process.argv[3]});console.log('ICASH_VOICE_PROVIDER_INSPECTION',JSON.stringify(report));if(!report.verified)process.exitCode=1;}
