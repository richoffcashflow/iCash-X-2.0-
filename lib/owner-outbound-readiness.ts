import {createHash} from 'node:crypto';
import {sameBusinessNumber} from './number-continuity.ts';
type Obj=Record<string,unknown>;
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
// Resource identities come only from the service-only production singleton.
export type OutboundTemplate={id:number;enabled:boolean;agent_id:string;phone_number_id:string;agent_config_hash:string;required_tool_ids:string[];max_duration_seconds:number;reviewed_at:string;reviewed_until:string};
export function validOutboundTemplate(t:OutboundTemplate|undefined):t is OutboundTemplate{
 return !!t&&t.id===1&&/^agent_[A-Za-z0-9]+$/.test(t.agent_id)&&/^phnum_[A-Za-z0-9]+$/.test(t.phone_number_id)&&/^[a-f0-9]{64}$/.test(t.agent_config_hash)&&t.max_duration_seconds===600&&Array.isArray(t.required_tool_ids)&&t.required_tool_ids.length===2&&new Set(t.required_tool_ids).size===2&&t.required_tool_ids.every(id=>/^tool_[A-Za-z0-9]+$/.test(id));
}
// Official ElevenLabs header locators supply the entire header value. The live
// callback/handoff receivers already accept the server-issued bare 64-hex token.
// Do not recognize mustache strings, workspace secrets, other variables or extras.
export function outboundAuthorizationShape(headers:unknown){
 const values=Object.entries(obj(headers)).filter(([name])=>name.toLowerCase()==='authorization').map(([,value])=>value);
 if(values.length===0)return 'missing';if(values.length!==1)return 'duplicate';
 const value=values[0],record=obj(value),keys=Object.keys(record);
 if(typeof value==='string')return value.includes('{{')||value.includes('}}')?'literal_template':'literal_value';
 if(keys.length===1&&keys[0]==='variable_name')return record.variable_name==='secret__icash_call_token'?'exact_call_token_locator':'other_variable_locator';
 if(keys.includes('secret_id'))return 'workspace_secret_reference';
 if(keys.includes('env_var_label'))return 'environment_reference';
 return 'unrecognized';
}
function currentConfigurationShape(agent:Obj){
 const config=obj(agent.conversation_config),a=obj(config.agent),prompt=obj(a.prompt),platform=obj(agent.platform_settings);
 const count=(v:unknown)=>Array.isArray(v)?v.length:null;
 const boolean=(v:unknown)=>typeof v==='boolean'?v:null;
 const hash=(v:unknown)=>v===undefined?null:createHash('sha256').update(JSON.stringify(v)).digest('hex');
 // Fixed field names only. Never return prompt text, defaults, headers, custom
 // URLs, model names, identifiers or secrets from an unknown provider field.
 return {promptCharacters:typeof prompt.prompt==='string'?prompt.prompt.length:null,firstMessageCharacters:typeof a.first_message==='string'?a.first_message.length:null,
  attachedToolCount:count(prompt.tool_ids),inlineToolCount:count(prompt.tools),knowledgeBaseCount:count(prompt.knowledge_base),mcpServerCount:count(prompt.mcp_server_ids),nativeMcpServerCount:count(prompt.native_mcp_server_ids),
  ragEnabled:boolean(obj(prompt.rag).enabled),customLlmConfigured:prompt.custom_llm===undefined?null:prompt.custom_llm!==null,
  providerAuthenticationEnabled:boolean(obj(platform.auth).enable_auth),recordVoice:boolean(obj(platform.privacy).record_voice),burstingEnabled:boolean(obj(platform.call_limits).bursting_enabled),
  sectionFingerprints:Object.fromEntries(['agent','asr','tts','turn','conversation','language_presets'].map(key=>[key,hash(config[key])]))};
}
export function inspectOutboundReadiness(t:OutboundTemplate,rawAgent:unknown,rawPhone:unknown,businessNumber:string|undefined){
 const agent=obj(rawAgent),phone=obj(rawPhone),config=obj(agent.conversation_config),a=obj(config.agent),prompt=obj(a.prompt),platform=obj(agent.platform_settings);
 const override=obj(obj(platform.overrides).conversation_config_override),agentOverride=obj(override.agent),max=obj(config.conversation).max_duration_seconds,toolIds=prompt.tool_ids;
 const hash=Object.keys(config).length?createHash('sha256').update(JSON.stringify(config)).digest('hex'):null;
 const checks={agentIdentityMatches:agent.agent_id===t.agent_id,phoneIdentityMatches:phone.phone_number_id===t.phone_number_id,phoneProviderTwilio:phone.provider==='twilio',businessNumberMatches:sameBusinessNumber(businessNumber,typeof phone.phone_number==='string'?phone.phone_number:undefined),configHashMatches:hash===t.agent_config_hash,durationExactly600:max===600,durationMessageEmpty:a.max_conversation_duration_message==='',requiredToolsPresent:Array.isArray(toolIds)&&t.required_tool_ids.every(id=>toolIds.includes(id)),firstMessageOverrideEnabled:agentOverride.first_message===true,promptOverrideEnabled:obj(agentOverride.prompt).prompt===true,durationOverrideEnabled:obj(override.conversation).max_duration_seconds===true,reviewCurrent:Number.isFinite(Date.parse(t.reviewed_at))&&Date.parse(t.reviewed_at)<=Date.now()&&Number.isFinite(Date.parse(t.reviewed_until))&&Date.parse(t.reviewed_until)>Date.now()};
 return {status:'checked',checks,runtimeConfigChecksPass:Object.values(checks).every(Boolean),templateEnabled:t.enabled,observedConfigHash:hash,maxDurationSeconds:typeof max==='number'&&Number.isSafeInteger(max)&&max>=0?max:null,maxOutputTokens:typeof prompt.max_tokens==='number'&&Number.isSafeInteger(prompt.max_tokens)&&prompt.max_tokens>=-1?prompt.max_tokens:null,expectedConfigHash:t.agent_config_hash,configurationDriftExplanation:hash===t.agent_config_hash?'none_detected':'not_determined_without_reviewed_snapshot',configurationShape:currentConfigurationShape(agent),toolDefinitionsVerified:false,callVerification:'not_tested',checkedAt:new Date().toISOString()};
}
export function inspectOutboundTools(t:OutboundTemplate,receipts:unknown[]){
 const tools=receipts.map((raw,index)=>{
  const tool=obj(raw),config=obj(tool.tool_config),api=obj(config.api_schema),body=obj(api.request_body_schema),properties=obj(body.properties),conversation=obj(properties.conversationId);
  const role=api.url==='https://www.geticashx.com/api/internal/voice/callback'?'callback':api.url==='https://www.geticashx.com/api/internal/voice/handoff'?'handoff':'unrecognized';
  const required=role==='callback'?['conversationId','dueAt','timezone','readback','confirmation']:role==='handoff'?['conversationId','reason']:[];
  const authorizationShape=outboundAuthorizationShape(api.request_headers);
  const checks={identityMatches:tool.id===t.required_tool_ids[index],webhookType:config.type==='webhook',canonicalEndpoint:role!=='unrecognized',postMethod:api.method==='POST',scopedCallAuthorization:authorizationShape==='exact_call_token_locator',providerConversationBinding:conversation.type==='string'&&conversation.dynamic_variable==='system__conversation_id',requiredBodyFields:body.type==='object'&&required.length>0&&Array.isArray(body.required)&&required.every(key=>(body.required as unknown[]).includes(key)&&obj(properties[key]).type==='string')&&Object.keys(properties).length===required.length,noAuthConnection:api.auth_connection===null||api.auth_connection===undefined,noMockResults:tool.response_mocks===null||tool.response_mocks===undefined||(Array.isArray(tool.response_mocks)&&tool.response_mocks.length===0)};
  return {role,authorizationShape,checks,definitionChecksPass:Object.values(checks).every(Boolean),observedDefinitionHash:createHash('sha256').update(JSON.stringify(config)).digest('hex')};
 });
 return {tools,toolDefinitionsVerified:tools.length===2&&new Set(tools.map(x=>x.role)).size===2&&tools.every(x=>x.definitionChecksPass)};
}
/** Four bounded metadata GETs only, on the same origin as live dispatch. */
export async function readOutboundReadiness(t:OutboundTemplate,key:string|undefined,businessNumber:string|undefined,fetcher:typeof fetch=fetch){
 if(typeof window!=='undefined'||!validOutboundTemplate(t)||!key||key.length>4096||!/^[\x21-\x7e]+$/.test(key))throw Error('CONFIGURATION_UNAVAILABLE');
 const signal=AbortSignal.timeout(8000),origin='https://api.elevenlabs.io',maximumBytes=1048576;
 async function get(path:string){
  const url=origin+path;
  const r=await fetcher(url,{method:'GET',headers:{'xi-api-key':key!,Accept:'application/json'},redirect:'error',cache:'no-store',credentials:'omit',signal});
  if(!r.ok||r.redirected||(r.url&&r.url!==url)||!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:;|$)/i.test(r.headers.get('content-type')??'')||!r.body)throw Error('PROVIDER_UNAVAILABLE');
  const length=r.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>maximumBytes))throw Error('INVALID_RECEIPT');
  const reader=r.body.getReader(),chunks:Uint8Array[]=[];let total=0;
  try{while(true){signal.throwIfAborted();const v=await reader.read();if(v.done)break;total+=v.value.byteLength;if(total>maximumBytes)throw Error('INVALID_RECEIPT');chunks.push(v.value);}}catch(e){await reader.cancel().catch(()=>undefined);throw e;}finally{reader.releaseLock();}
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }
 const [agent,phone,...toolReceipts]=await Promise.all([get('/v1/convai/agents/'+t.agent_id),get('/v1/convai/phone-numbers/'+t.phone_number_id),...t.required_tool_ids.map(id=>get('/v1/convai/tools/'+id))]);
 return {...inspectOutboundReadiness(t,agent,phone,businessNumber),...inspectOutboundTools(t,toolReceipts)};
}
