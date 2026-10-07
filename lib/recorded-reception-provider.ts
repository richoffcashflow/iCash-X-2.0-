import {receptionContextPrompt,receptionContextVariables} from './reception-property-context.ts';
import {boundedBytes,createRecordingProviders,type RecordingEnv} from './required-call-recording-provider.ts';
import {object,sid} from './required-call-recording.ts';
import {recordedReceptionUrl,receptionStopToken,type RecordedReceptionRow,type RecordedReceptionConfig} from './recorded-reception.ts';
import {propertyReceptionEnabled,propertyReceptionVariables} from './reception-property-context.ts';

/** Canonical transport only. Exposes no arbitrary URL/provider write primitive. */
export function createRecordedReceptionProviders(env:RecordingEnv,fetcher:typeof fetch=fetch,signal?:AbortSignal){
 const core=createRecordingProviders(env,fetcher,signal),origin='https://api.us.elevenlabs.io';
 async function eleven(path:string,body?:unknown){
  if(!env.ELEVENLABS_API_KEY)throw Error('PROVIDER_CONFIGURATION_REQUIRED');const url=origin+path;
  const r=await fetcher(url,{method:body===undefined?'GET':'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',cache:'no-store',credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  if(!r.ok||r.redirected||r.url&&r.url!==url)throw Error('PROVIDER_UNAVAILABLE');return (await boundedBytes(r,262144)).toString('utf8');
 }
 const agentPath=(id:string)=>{if(!/^agent_[A-Za-z0-9]+$/.test(id))throw Error('AGENT_REQUIRED');return '/v1/convai/agents/'+id;};
 return {
  getCall:core.getCall,start:core.start,stop:core.stop,end:core.end,getRecording:core.getRecording,listRecordings:core.listRecordings,deleteRecording:core.deleteRecording,media:core.media,
  async boundCall(r:RecordedReceptionRow){
   if(!sid(r.call_sid,'CA')||r.provider_account_sid!==env.TWILIO_ACCOUNT_SID||![60,600].includes(r.max_total_seconds))throw Error('CALL_BINDING_REQUIRED');
   const url=`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Calls/${r.call_sid}.json`;
   const response=await fetcher(url,{method:'POST',headers:{Authorization:'Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({TimeLimit:String(r.max_total_seconds),StatusCallback:recordedReceptionUrl+'/terminal?id='+r.id,StatusCallbackMethod:'POST'}),redirect:'error',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
   if(response.redirected||response.url&&response.url!==url)throw Error('CALL_BOUND_UNCONFIRMED');
   if(!response.ok){
    // Only numeric carrier diagnostics. Never log credentials, phones, or raw bodies.
    let code=0;try{const body=object(JSON.parse((await boundedBytes(response,32768)).toString('utf8')));if(Number.isSafeInteger(body.code))code=Number(body.code);}catch{}
    throw Error('CALL_BOUND_HTTP_'+response.status+'_CODE_'+code);
   }
   return object(JSON.parse((await boundedBytes(response,32768)).toString('utf8')));
  },
  agent:async(c:RecordedReceptionConfig)=>object(JSON.parse(await eleven(agentPath(c.agent_id)+'?branch_id='+encodeURIComponent(c.branch_id)))),
  branches:async(c:RecordedReceptionConfig)=>object(JSON.parse(await eleven(agentPath(c.agent_id)+'/branches?include_archived=true&limit=100'))),
  workspace:async()=>object(JSON.parse(await eleven('/v1/convai/settings'))),
  tool:async(id:string)=>{if(!/^tool_[A-Za-z0-9]+$/.test(id))throw Error('TOOL_REQUIRED');return object(JSON.parse(await eleven('/v1/convai/tools/'+id)));},
  conversations:async(r:RecordedReceptionRow)=>object(JSON.parse(await eleven('/v1/convai/conversations?'+new URLSearchParams({agent_id:r.agent_id,user_id:'icash-recorded-reception:'+r.id,page_size:'2'})))),
  conversation:async(id:string)=>{if(!/^conv_[A-Za-z0-9]+$/.test(id))throw Error('CONVERSATION_REQUIRED');return object(JSON.parse(await eleven('/v1/convai/conversations/'+id)));},
  register:async(r:RecordedReceptionRow,remaining:number,propertyContext:unknown=null)=>{
   if(!Number.isInteger(remaining)||remaining<1||remaining>r.max_total_seconds||!r.recording_sid||!r.consent_at)throw Error('CONSENT_AND_BOUND_REQUIRED');
   const raw=await eleven('/v1/convai/twilio/register-call',{agent_id:r.agent_id,from_number:r.from_phone,to_number:r.to_phone,direction:'inbound',conversation_initiation_client_data:{branch_id:r.branch_id,user_id:'icash-recorded-reception:'+r.id,conversation_config_override:{conversation:{max_duration_seconds:remaining}},dynamic_variables:{...(propertyReceptionEnabled(r.configuration)?receptionContextVariables(r.configuration,propertyContext):{}),icash_reception_recording_id:r.id,secret__icash_reception_stop_token:receptionStopToken(r,env)}}});
   const text=raw.trim().startsWith('"')?JSON.parse(raw):raw;
   if(typeof text!=='string'||text.length>64000||/<!/.test(text)||!/^\s*(?:<\?xml[^>]*>\s*)?<Response(?:\s|>)/.test(text)||!text.includes('<Connect')||!text.includes('<Stream'))throw Error('REGISTRATION_NOT_CONFIRMED');
   const tags=[...text.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)\b/g)].map(m=>m[1]);
   if(tags.some(t=>!['Response','Connect','Stream','Parameter'].includes(t))||[...text.matchAll(/<Connect\b/g)].length!==1||[...text.matchAll(/<Stream\b/g)].length!==1||/<Connect\b[^>]*\baction\s*=/.test(text)||/<Stream\b[^>]*\bstatusCallback\s*=/.test(text))throw Error('REGISTRATION_NOT_CONFIRMED');
   const stream=text.match(/<Stream\b[^>]*\burl=["']([^"']+)["']/);if(!stream)throw Error('REGISTRATION_NOT_CONFIRMED');
   const endpoint=new URL(stream[1].replaceAll('&amp;','&'));if(endpoint.protocol!=='wss:'||endpoint.username||endpoint.password||!(endpoint.hostname==='elevenlabs.io'||endpoint.hostname.endsWith('.elevenlabs.io')))throw Error('REGISTRATION_NOT_CONFIRMED');
   return text;
  },
 };
}
export type RecordedReceptionProviders=ReturnType<typeof createRecordedReceptionProviders>;
