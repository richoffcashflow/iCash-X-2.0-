import {object,sid,type RecordingRow,type RecordingReview} from './required-call-recording.ts';
export type RecordingEnv={[key:string]:string|undefined;ICASH_RECORDED_OUTBOUND_READY?:string;RECORDED_OUTBOUND_REVIEW_JSON?:string;TWILIO_ACCOUNT_SID?:string;TWILIO_AUTH_TOKEN?:string;ELEVENLABS_API_KEY?:string};
export class RecordingProviderError extends Error{status:number;constructor(status:number){super('RECORDING_PROVIDER_UNAVAILABLE');this.status=status;}}
export async function boundedBytes(response:Response|Request,max:number){
 const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>max))throw Error('BODY_LIMIT');
 if(!response.body)throw Error('BODY_REQUIRED');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.byteLength;if(size>max)throw Error('BODY_LIMIT');chunks.push(x.value);}}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
 return Buffer.concat(chunks);
}
export function createRecordingProviders(env:RecordingEnv,fetcher:typeof fetch=fetch,signal?:AbortSignal){
 if(typeof window!=='undefined'||!sid(env.TWILIO_ACCOUNT_SID,'AC')||!env.TWILIO_AUTH_TOKEN||env.TWILIO_AUTH_TOKEN.length<20)throw Error('RECORDING_PROVIDER_CONFIGURATION_REQUIRED');
 const base=`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}`;
 const auth='Basic '+Buffer.from(env.TWILIO_ACCOUNT_SID+':'+env.TWILIO_AUTH_TOKEN).toString('base64');
 async function twilio(path:string,method='GET',body?:URLSearchParams,safety=false){
  const url=base+path,r=await fetcher(url,{method,headers:{Authorization:auth,...(body?{'Content-Type':'application/x-www-form-urlencoded'}:{})},body:body?.toString(),redirect:'error',cache:'no-store',credentials:'omit',signal:signal&&!safety?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  if(!r.ok||r.redirected||(r.url&&r.url!==url))throw new RecordingProviderError(r.status);return r;
 }
 async function json(path:string,method='GET',body?:URLSearchParams,safety=false){return object(JSON.parse((await boundedBytes(await twilio(path,method,body,safety),262144)).toString('utf8')));}
 async function eleven(path:string,body?:unknown){
  if(!env.ELEVENLABS_API_KEY)throw Error('RECORDING_PROVIDER_CONFIGURATION_REQUIRED');const url='https://api.elevenlabs.io'+path;
  const r=await fetcher(url,{method:body===undefined?'GET':'POST',headers:{'xi-api-key':env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',credentials:'omit',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(8000)]):AbortSignal.timeout(8000)});
  if(!r.ok||r.redirected||(r.url&&r.url!==url))throw new RecordingProviderError(r.status);return (await boundedBytes(r,262144)).toString('utf8');
 }
 const callPath=(id:string)=>{if(!sid(id,'CA'))throw Error('CALL_ID_REQUIRED');return `/Calls/${id}`;};
 const recordPath=(id:string)=>{if(!sid(id,'RE'))throw Error('RECORDING_ID_REQUIRED');return `/Recordings/${id}`;};
 return {
  getCall:(id:string)=>json(callPath(id)+'.json'),
  // Read-only call diagnostics. Reconstruct the fixed resource path; never fetch a provider pagination URL.
  getCallEventsPage:(id:string,page=0,pageToken?:string)=>{
   if(!Number.isSafeInteger(page)||page<0||page>2||pageToken!==undefined&&!/^[A-Za-z0-9._~-]{1,512}$/.test(pageToken))throw Error('CALL_EVENT_PAGE_INVALID');
   const query=new URLSearchParams({PageSize:'100',Page:String(page)});if(pageToken!==undefined)query.set('PageToken',pageToken);
   return json(callPath(id)+'/Events.json?'+query.toString());
  },
  dial:(from:string,to:string,twiml:string,statusCallback:string)=>json('/Calls.json','POST',new URLSearchParams({From:from,To:to,Twiml:twiml,Record:'false',TimeLimit:'600',Timeout:'20',StatusCallback:statusCallback,StatusCallbackMethod:'POST',StatusCallbackEvent:'completed'})),
  start:(call:string,callback:string)=>json(callPath(call)+'/Recordings.json','POST',new URLSearchParams({RecordingChannels:'dual',RecordingTrack:'both',Trim:'do-not-trim',RecordingStatusCallback:callback,RecordingStatusCallbackMethod:'POST',RecordingStatusCallbackEvent:'in-progress completed absent'})),
  stop:(call:string,recording:string)=>{recordPath(recording);return json(callPath(call)+`/Recordings/${recording}.json`,'POST',new URLSearchParams({Status:'stopped'}));},
  end:(call:string)=>json(callPath(call)+'.json','POST',new URLSearchParams({Status:'completed'}),true),
  getRecording:(id:string,deleted=false)=>json(recordPath(id)+'.json'+(deleted?'?IncludeSoftDeleted=true':'')),
  listRecordings:(call:string)=>json(callPath(call)+'/Recordings.json?PageSize=100'),
  deleteRecording:async(id:string)=>{const r=await twilio(recordPath(id)+'.json','DELETE');if(r.status!==204)throw Error('DELETION_NOT_CONFIRMED');},
  media:async(id:string)=>{const r=await twilio(recordPath(id)+'.mp3');if(!/^audio\/(mpeg|mp3)(?:;|$)/i.test(r.headers.get('content-type')??''))throw Error('AUDIO_TYPE_INVALID');return boundedBytes(r,6*1024*1024);},
  agent:async(r:RecordingReview)=>object(JSON.parse(await eleven(`/v1/convai/agents/${r.agentId}?branch_id=${r.branchId}`))),
  tool:async(id:string)=>{if(!/^tool_[A-Za-z0-9]+$/.test(id))throw Error('TOOL_ID_REQUIRED');return object(JSON.parse(await eleven('/v1/convai/tools/'+id)));},
  conversations:async(row:RecordingRow)=>object(JSON.parse(await eleven('/v1/convai/conversations?'+new URLSearchParams({agent_id:row.agent_id,branch_id:row.branch_id,version_id:row.version_id,user_id:'icash-recorded:'+row.id,page_size:'2'})))),
  conversation:async(id:string)=>{if(!/^conv_[A-Za-z0-9]+$/.test(id))throw Error('CONVERSATION_ID_REQUIRED');return object(JSON.parse(await eleven('/v1/convai/conversations/'+id)));},
  register:async(row:RecordingRow,remainingSeconds:number,stopToken:string)=>{
   const context=object(row.call_context);if(typeof context.prompt!=='string'||typeof context.firstMessage!=='string')throw Error('RECORDING_CONTEXT_REQUIRED');
   const raw=await eleven('/v1/convai/twilio/register-call',{agent_id:row.agent_id,from_number:row.from_phone,to_number:row.to_phone,direction:'outbound',conversation_initiation_client_data:{branch_id:row.branch_id,user_id:'icash-recorded:'+row.id,dynamic_variables:{secret__icash_recording_stop_token:stopToken,secret__icash_call_token:stopToken,icash_recording_id:row.id,principal:context.principal,assistant_name:context.assistantName},conversation_config_override:{...(typeof context.voiceId==='string'?{tts:{voice_id:context.voiceId}}:{}),agent:{first_message:context.firstMessage,prompt:{prompt:context.prompt+'\nA verified consent gate has authorized this recording. If the person withdraws recording permission or says stop recording, immediately call icash_stop_recording and end this call. Never restart recording or continue an unrecorded conversation. Do not claim a stop before the tool confirms it. If another participant joins or permission becomes unclear, stop and end the call.'}},conversation:{max_duration_seconds:remainingSeconds}}}});
   // Register-call may return XML directly or a JSON-encoded XML string.
   const text=raw.trim().startsWith('"')?JSON.parse(raw):raw;
   if(typeof text!=='string'||text.length>64000||/<!/.test(text)||!/^\s*(?:<\?xml[^>]*>\s*)?<Response(?:\s|>)/.test(text)||!text.includes('<Connect')||!text.includes('<Stream'))throw Error('REGISTRATION_NOT_CONFIRMED');
   const tags=[...text.matchAll(/<\/?([A-Za-z][A-Za-z0-9]*)\b/g)].map(m=>m[1]);
   if(tags.some(tag=>!['Response','Connect','Stream','Parameter'].includes(tag))||[...text.matchAll(/<Connect\b/g)].length!==1||[...text.matchAll(/<Stream\b/g)].length!==1)throw Error('REGISTRATION_NOT_CONFIRMED');
   const stream=text.match(/<Stream\b[^>]*\burl=[\"']([^\"']+)[\"']/);if(!stream)throw Error('REGISTRATION_NOT_CONFIRMED');
   const endpoint=new URL(stream[1].replaceAll('&amp;','&'));if(endpoint.protocol!=='wss:'||endpoint.username||endpoint.password||!(endpoint.hostname==='elevenlabs.io'||endpoint.hostname.endsWith('.elevenlabs.io')))throw Error('REGISTRATION_NOT_CONFIRMED');
   return text;
  },
 };
}
export type RecordingProviders=ReturnType<typeof createRecordingProviders>;
