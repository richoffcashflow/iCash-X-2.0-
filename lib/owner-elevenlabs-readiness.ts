import {timingSafeEqual} from 'node:crypto';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';

// Read-only, fixed US-region metadata diagnostic. Official schemas checked 2026-10-02:
// https://elevenlabs.io/docs/eleven-agents/api-reference/agents/get
// https://elevenlabs.io/docs/eleven-agents/api-reference/agents/branches/get
// https://elevenlabs.io/docs/eleven-agents/api-reference/phone-numbers/get
// No defaults stand in for absent provider evidence. Workspace settings/secrets,
// conversations, prompts, arbitrary webhook URLs and raw errors are never exposed.
type RecordValue=Record<string,unknown>;
type Environment={ELEVENLABS_API_KEY?:string;ELEVENLABS_INBOUND_WEBHOOK_SECRET?:string};
export type ElevenMetadataStatus='checked'|'provider_auth_failed'|'provider_access_denied'|'provider_unavailable'|'provider_receipt_invalid'|'target_mismatch';
export class OwnerElevenLabsReadinessError extends Error{
 readonly code:'configuration_unavailable';
 constructor(){super('configuration_unavailable');this.code='configuration_unavailable';}
}
const object=(v:unknown):RecordValue|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:null;
const bool=(v:unknown)=>typeof v==='boolean'?v:null;
const integer=(v:unknown,min=0)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min?v:null;
const percent=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=100?v:null;
function modelTokenLimit(prompt:RecordValue|null){
 const value=integer(prompt?.max_tokens,-1);
 // The schema documents a positive cap and -1 as the unbounded default. Do
 // not apply that default when the field is absent, null, zero or malformed.
 return {maxTokens:value!==null&&(value===-1||value>0)?value:null,
  maxTokensStatus:!prompt||!Object.hasOwn(prompt,'max_tokens')?'not_returned' as const:value===-1?'unlimited' as const:value!==null&&value>0?'bounded' as const:'unknown' as const};
}
const maximumBytes=1024*1024;
const origin='https://api.us.elevenlabs.io';

// Only documented public model identifiers may cross this boundary. Unknown or
// custom provider strings are not copied into the response.
const models=new Set('gpt-4o-mini gpt-4o gpt-4 gpt-4-turbo gpt-4.1 gpt-4.1-mini gpt-4.1-nano gpt-5 gpt-5.1 gpt-5.2 gpt-5.2-chat-latest gpt-5.4 gpt-5.4-mini gpt-5.4-nano gpt-5.5 gpt-5.6-sol gpt-5.6-terra gpt-5.6-luna gpt-6-astra gpt-6-sol gpt-6-luna gpt-5-mini gpt-5-nano gpt-3.5-turbo gemini-1.5-pro gemini-1.5-flash gemini-2.0-flash gemini-2.0-flash-lite gemini-2.5-flash-lite gemini-2.5-flash gemini-3-pro-preview gemini-3-flash-preview gemini-3.1-pro-preview gemini-3.1-flash-lite-preview gemini-3.1-flash-lite gemini-3.5-flash gemini-3.5-flash-lite gemini-3.6-flash gemini-3.7-flash gemini-3.8-flash claude-sonnet-4-5 claude-opus-4-7 claude-opus-4-8 claude-opus-5 claude-opus-5-5 claude-sonnet-4-6 claude-sonnet-5 claude-sonnet-5-5 claude-sonnet-4 claude-haiku-4-5 claude-3-7-sonnet claude-3-5-sonnet claude-3-5-sonnet-v1 claude-3-haiku grok-beta custom-llm qwen3-4b qwen3-30b-a3b qwen36-35b-a3b qwen35-397b-a17b gpt-oss-20b gpt-oss-120b glm-45-air-fp8 glm-52 deepseek-v41-flash gemini-2.5-flash-preview-09-2025 gemini-2.5-flash-lite-preview-09-2025 gemini-2.5-flash-preview-05-20 gemini-2.5-flash-preview-04-17 gemini-2.5-flash-lite-preview-06-17 gemini-2.0-flash-lite-001 gemini-2.0-flash-001 gemini-1.5-flash-002 gemini-1.5-flash-001 gemini-1.5-pro-002 gemini-1.5-pro-001 claude-sonnet-4@20250514 claude-sonnet-4-5@20250929 claude-haiku-4-5@20251001 claude-3-7-sonnet@20250219 claude-3-5-sonnet@20240620 claude-3-5-sonnet-v2@20241022 claude-3-haiku@20240307 gpt-5-2025-08-07 gpt-5.1-2025-11-13 gpt-5.2-2025-12-11 gpt-5.4-2026-03-05 gpt-5.4-mini-2026-03-17 gpt-5.4-nano-2026-03-17 gpt-5.5-2026-04-23 gpt-5-mini-2025-08-07 gpt-5-nano-2025-08-07 gpt-4.1-2025-04-14 gpt-4.1-mini-2025-04-14 gpt-4.1-nano-2025-04-14 gpt-4o-mini-2024-07-18 gpt-4o-2024-11-20 gpt-4o-2024-08-06 gpt-4o-2024-05-13 gpt-4-0613 gpt-4-0314 gpt-4-turbo-2024-04-09 gpt-3.5-turbo-0125 gpt-3.5-turbo-1106 watt-tool-8b watt-tool-70b'.split(' '));

function authorizationMetadata(webhook:unknown,serverSecret:string|undefined,scope:'private_test_branch_override_only'|'default_agent_override_only'){
 const w=object(webhook),headers=object(w?.request_headers);
 const entries=headers?Object.entries(headers).filter(([name])=>name.toLowerCase()==='authorization'):[];
 const header=entries.length===1?entries[0][1]:null;
 const expectedUrl='https://www.geticashx.com/api/internal/voice/inbound';
 const noncanonicalUrl='https://geticashx.com/api/internal/voice/inbound';
 const url=typeof w?.url==='string'?w.url:null;
 // References, omitted values, masking and templates cannot prove a match.
 // A conservative token alphabet also keeps unrecognized representations unknown.
 const directlyComparable=typeof header==='string'&&/^Bearer [A-Za-z0-9._~+/-]{32,505}={0,2}$/.test(header)&&!/(redacted|masked|hidden)/i.test(header);
 const serverConfigured=typeof serverSecret==='string'&&serverSecret.length>=32&&serverSecret.length<=505&&/^[\x21-\x7e]+$/.test(serverSecret);
 let matches:boolean|null=null;
 if(directlyComparable&&serverConfigured){
  const actual=Buffer.from(header),expected=Buffer.from(`Bearer ${serverSecret}`);
  matches=actual.length===expected.length&&timingSafeEqual(actual,expected);
 }
 return {
  scope,
  overrideConfigured:webhook===null?false:w?true:null,
  webhookUrl:url===expectedUrl||url===noncanonicalUrl?url:null,
  webhookUrlMatchesCanonical:url===null?null:url===expectedUrl,
  authorizationHeaderPresent:headers?entries.length>0:null,
  authorizationHeaderUnique:headers?entries.length===1:null,
  authorizationBearerScheme:typeof header==='string'?header.startsWith('Bearer '):null,
  authorizationValueComparable:directlyComparable,
  serverWebhookSecretConfigured:serverConfigured,
  authorizationMatchesServerSecret:matches,
  workspaceFallback:'not_read' as const,
 };
}

/** The only runtime credential use is existing server-injected key authentication
 * to four fixed metadata GETs and optional in-memory webhook comparisons. */
export async function readOwnerElevenLabsReadiness(env:Environment,fetcher:typeof fetch=fetch){
 if(typeof window!=='undefined')throw new OwnerElevenLabsReadinessError();
 const key=env.ELEVENLABS_API_KEY;
 if(typeof key!=='string'||!key.length||key.length>4096||!/^[\x21-\x7e]+$/.test(key))throw new OwnerElevenLabsReadinessError();
 const signal=AbortSignal.timeout(8000);
 type Result={status:ElevenMetadataStatus;receipt:RecordValue|null};
 async function get(path:string,identity:(receipt:RecordValue)=>boolean):Promise<Result>{
  const url=origin+path;
  let response:Response;
  try{response=await fetcher(url,{method:'GET',headers:{'xi-api-key':key!,Accept:'application/json'},cache:'no-store',redirect:'error',credentials:'omit',signal});}
  catch{return {status:'provider_unavailable',receipt:null};}
  if(response.redirected||(response.url&&response.url!==url))return {status:'provider_unavailable',receipt:null};
  if(!response.ok)return {status:response.status===401?'provider_auth_failed':response.status===403?'provider_access_denied':'provider_unavailable',receipt:null};
  try{
   const length=response.headers.get('content-length');
   if(length&&(!/^\d+$/.test(length)||Number(length)>maximumBytes))throw Error();
   if(!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)throw Error();
   const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
   try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximumBytes)throw Error();chunks.push(part.value);}}
   catch{await reader.cancel().catch(()=>undefined);throw Error();}
   finally{reader.releaseLock();}
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
   const receipt=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
   if(!receipt)throw Error();
   if(!identity(receipt))return {status:'target_mismatch',receipt:null};
   return {status:'checked',receipt};
  }catch{return {status:'provider_receipt_invalid',receipt:null};}
 }
 const target=ownerInboundTarget,agentPath=`/v1/convai/agents/${encodeURIComponent(target.agentId)}`;
 const [agent,branch,phone,incomingDefault]=await Promise.all([
  get(`${agentPath}?branch_id=${encodeURIComponent(target.branchId)}`,r=>r.agent_id===target.agentId&&r.branch_id===target.branchId),
  get(`${agentPath}/branches/${encodeURIComponent(target.branchId)}`,r=>r.agent_id===target.agentId&&r.id===target.branchId),
  get(`/v1/convai/phone-numbers/${encodeURIComponent(target.phoneNumberId)}`,r=>r.phone_number_id===target.phoneNumberId&&r.phone_number===target.ingressNumber&&r.provider==='twilio'),
  get(agentPath,r=>r.agent_id===target.agentId),
 ]);
 const config=object(agent.receipt?.conversation_config),platform=object(agent.receipt?.platform_settings);
 const prompt=object(object(config?.agent)?.prompt),privacy=object(platform?.privacy),queue=object(platform?.queueing_config);
 const assignment=object(phone.receipt?.assigned_agent),webhook=object(platform?.workspace_overrides)?.conversation_initiation_client_data_webhook;
 const incomingPlatform=object(incomingDefault.receipt?.platform_settings);
 return {
  status:[agent,branch,phone,incomingDefault].every(r=>r.status==='checked')?'checked' as const:'partial' as const,
  region:'us' as const,
  agent:{status:agent.status,
   model:typeof prompt?.llm==='string'&&models.has(prompt.llm)?prompt.llm:null,
   ...modelTokenLimit(prompt),
   maxDurationSeconds:integer(object(config?.conversation)?.max_duration_seconds),
   queueEnabled:bool(queue?.enabled),queueWaitTimeoutSeconds:integer(queue?.wait_timeout_seconds),
   burstingEnabled:bool(object(platform?.call_limits)?.bursting_enabled),
   privacy:{recordVoice:bool(privacy?.record_voice),retentionDays:integer(privacy?.retention_days,-1),deleteTranscriptAndPii:bool(privacy?.delete_transcript_and_pii),deleteAudio:bool(privacy?.delete_audio),zeroRetentionMode:bool(privacy?.zero_retention_mode)},
   authenticationEnabled:bool(object(platform?.auth)?.enable_auth),
   initiationWebhookEnabled:bool(object(platform?.overrides)?.enable_conversation_initiation_client_data_from_webhook),
   webhookAuthentication:authorizationMetadata(webhook,env.ELEVENLABS_INBOUND_WEBHOOK_SECRET,'private_test_branch_override_only'),
  },
  incomingDefault:{status:incomingDefault.status,
   assignedPhoneBranchMatches:typeof assignment?.branch_id==='string'&&typeof incomingDefault.receipt?.branch_id==='string'?assignment.branch_id===incomingDefault.receipt.branch_id:null,
   initiationWebhookEnabled:bool(object(incomingPlatform?.overrides)?.enable_conversation_initiation_client_data_from_webhook),
   webhookAuthentication:authorizationMetadata(object(incomingPlatform?.workspace_overrides)?.conversation_initiation_client_data_webhook,env.ELEVENLABS_INBOUND_WEBHOOK_SECRET,'default_agent_override_only'),
   requestAuthenticationVerified:false as const,
  },
  branch:{status:branch.status,archived:bool(branch.receipt?.is_archived),liveTrafficPercent:percent(branch.receipt?.current_live_percentage)},
  phone:{status:phone.status,assignedAgentMatches:typeof assignment?.agent_id==='string'?assignment.agent_id===target.agentId:null,assignedBranchMatches:typeof assignment?.branch_id==='string'?assignment.branch_id===target.branchId:null},
  callVerification:'not_tested' as const,
  checkedAt:new Date().toISOString(),
 };
}
export type OwnerElevenLabsReadiness=Awaited<ReturnType<typeof readOwnerElevenLabsReadiness>>;
