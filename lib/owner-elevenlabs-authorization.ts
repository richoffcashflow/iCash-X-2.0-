import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';

// Fixed-target saved-reference repair only. Provider schemas and partial-merge
// behavior checked 2026-10-02 against ElevenLabs' public OpenAPI and official
// elevenlabs/plugin agents documentation. Explicit procedures prevent PATCH from
// publishing unrelated unpublished procedure edits. No secret-store endpoints.
type RecordValue=Record<string,unknown>;
type Environment={ELEVENLABS_API_KEY?:string;ELEVENLABS_INBOUND_WEBHOOK_SECRET?:string};
const origin='https://api.us.elevenlabs.io';
const webhookUrl='https://www.geticashx.com/api/internal/voice/inbound';
const operation='reuse_saved_authorization_reference_on_main' as const;
const target=ownerInboundTarget;
const agentPath=`/v1/convai/agents/${encodeURIComponent(target.agentId)}`;
const webhookKey='conversation_initiation_client_data_webhook';
const lifetimeMs=120_000,maximumBytes=1024*1024;
const messages={
 ready:'Ready to reuse the existing saved Authorization reference on Main. No call has been placed.',
 authorization_already_present:'Main already has an Authorization header. No change was made; this does not verify the saved credential works.',
 source_reference_invalid:'The private branch does not provide exactly one valid saved Authorization reference.',
 unsafe_headers:'Existing webhook headers cannot be safely preserved by this reference-only repair.',
 routing_not_safe:'Main, private-branch traffic, or the phone assignment does not match the required routing.',
 drafts_present:'A draft or unpublished procedure is present. Resolve it before reviewing this repair.',
 evidence_missing:'Required published configuration or routing evidence is missing or inconsistent.',
 configuration_changed:'Configuration changed after review. No repair was sent; review the current state again.',
 review_expired:'The review expired. Read the current state before reviewing another repair.',
 invalid_review:'A valid current owner review is required.',
 provider_unavailable:'The provider could not be checked. No repair was sent.',
 provider_auth_failed:'The existing provider API credential was not accepted. No repair was sent.',
 provider_access_denied:'The existing provider API credential cannot access the required settings. No repair was sent.',
 provider_receipt_invalid:'The provider returned incomplete or invalid evidence. No repair was sent.',
 verification_failed:'The repair request was sent, but the exact permitted change could not be verified. Do not apply again; use read-only checks.',
 apply_uncertain:'The repair outcome is uncertain. Do not apply again; use read-only checks.',
 verified_only_auth_changed:'The saved Authorization reference was added to Main. Read-back verified the other published settings, procedures, phone assignment and traffic were unchanged. Calls have not been tested.',
 configuration_unavailable:'The existing server configuration is unavailable. No repair was sent.',
} as const;
export type OwnerElevenLabsAuthorizationReason=keyof typeof messages;
export type OwnerElevenLabsAuthorizationReview={
 status:'ready'|'blocked'|'no_change'|'verified_only_auth_changed'|'outcome_unknown';
 reason:OwnerElevenLabsAuthorizationReason;message:string;operation:typeof operation;
 fingerprint:string|null;reviewToken:string|null;expiresAt:string|null;checkedAt:string;
 providerRequestStatus?:number|null;callVerification:'not_tested';concurrencyProtection:'fresh_snapshot_check_only';
};
class RepairError extends Error{
 readonly code:OwnerElevenLabsAuthorizationReason;
 constructor(code:OwnerElevenLabsAuthorizationReason){super(code);this.code=code;}
}
function fail(code:OwnerElevenLabsAuthorizationReason):never{throw new RepairError(code);}
const object=(value:unknown):RecordValue|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:null;
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)&&!/(redacted|masked|hidden)/i.test(value);
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function canonical(value:unknown):string{
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const record=object(value);
 if(record)return '{'+Object.keys(record).sort().map(key=>JSON.stringify(key)+':'+canonical(record[key])).join(',')+'}';
 return JSON.stringify(value)??'undefined';
}
function result(status:OwnerElevenLabsAuthorizationReview['status'],reason:OwnerElevenLabsAuthorizationReason,extra:Partial<OwnerElevenLabsAuthorizationReview>={}):OwnerElevenLabsAuthorizationReview{
 return {status,reason,message:messages[reason],operation,fingerprint:null,reviewToken:null,expiresAt:null,checkedAt:new Date().toISOString(),callVerification:'not_tested',concurrencyProtection:'fresh_snapshot_check_only',...extra};
}
function configuration(env:Environment){
 if(typeof window!=='undefined')fail('configuration_unavailable');
 const key=env.ELEVENLABS_API_KEY,secret=env.ELEVENLABS_INBOUND_WEBHOOK_SECRET;
 if(typeof key!=='string'||!key.length||key.length>4096||!/^[\x21-\x7e]+$/.test(key)||typeof secret!=='string'||secret.length<32||secret.length>505||!/^[\x21-\x7e]+$/.test(secret))fail('configuration_unavailable');
 return {key:key as string,secret:secret as string};
}
function reference(value:unknown):{secret_id:string}|null{
 const record=object(value);
 return record&&Object.keys(record).length===1&&identifier(record.secret_id)?{secret_id:record.secret_id}:null;
}
function webhook(agent:RecordValue){
 const platform=object(agent.platform_settings),overrides=object(platform?.workspace_overrides),hook=object(overrides?.[webhookKey]);
 if(!hook||hook.url!==webhookUrl||!object(hook.request_headers)||Object.keys(hook).some(k=>!['url','request_headers'].includes(k))||object(platform?.overrides)?.enable_conversation_initiation_client_data_from_webhook!==true)fail('evidence_missing');
 return hook as RecordValue&{url:string;request_headers:RecordValue};
}
function headers(record:RecordValue){
 const seen=new Set<string>();let authorization:unknown=undefined,authorizationName:string|null=null;
 for(const [name,value] of Object.entries(record)){
  const lower=name.toLowerCase();
  if(!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name)||['constructor','prototype','__proto__'].includes(lower)||seen.has(lower))fail('unsafe_headers');
  seen.add(lower);
  if(lower==='authorization'){authorization=value;authorizationName=name;continue;}
  // Do not resend arbitrary plaintext headers, which could contain credentials.
  if(!reference(value)&&!(['content-type','accept'].includes(lower)&&value==='application/json'))fail('unsafe_headers');
 }
 return {authorization,authorizationName};
}
function procedures(agent:RecordValue){
 const map=object(agent.procedures);if(!map)fail('evidence_missing');
 const published:Record<string,{procedure_id:string;version_id:string}>=Object.create(null);
 for(const [key,value] of Object.entries(map!)){
  const ref=object(value);
  if(!identifier(key)||!ref||ref.procedure_id!==key||!identifier(ref.version_id))fail('drafts_present');
  published[key]={procedure_id:key,version_id:ref!.version_id as string};
 }
 return published;
}
function stableAgent(agent:RecordValue){
 // Only provider bookkeeping is excluded. Unknown config fields stay protected.
 const copy={...agent};delete copy.metadata;delete copy.access_info;delete copy.default_hold_audio_url;
 return copy;
}
function stableBranch(branch:RecordValue){
 const copy={...branch};
 for(const key of ['calls_7d','commits_ahead','commits_behind','access_info'])delete copy[key];
 return copy;
}
async function receipt(response:Response,signal:AbortSignal){
 const length=response.headers.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>maximumBytes))fail('provider_receipt_invalid');
 if(!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)fail('provider_receipt_invalid');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximumBytes)fail('provider_receipt_invalid');chunks.push(part.value);}}
 catch{await reader.cancel().catch(()=>undefined);fail('provider_receipt_invalid');}
 finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{const record=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));return record??fail('provider_receipt_invalid');}catch{fail('provider_receipt_invalid');}
}
function provider(key:string,fetcher:typeof fetch,signal:AbortSignal){
 return async(path:string)=>{
  const url=origin+path;let response:Response;
  try{response=await fetcher(url,{method:'GET',headers:{'xi-api-key':key,Accept:'application/json'},cache:'no-store',redirect:'error',credentials:'omit',signal});}catch{fail('provider_unavailable');}
  if(response!.redirected||(response!.url&&response!.url!==url))fail('provider_unavailable');
  if(!response!.ok)fail(response!.status===401?'provider_auth_failed':response!.status===403?'provider_access_denied':'provider_unavailable');
  return receipt(response!,signal);
 };
}
type Snapshot={main:RecordValue;incomingDefault:RecordValue;privateAgent:RecordValue;phone:RecordValue;branches:RecordValue[];mainId:string;source:{secret_id:string};published:ReturnType<typeof procedures>;procedureEvidence:RecordValue[];hasAuthorization:boolean};
async function snapshot(key:string,fetcher:typeof fetch):Promise<Snapshot>{
 const get=provider(key,fetcher,AbortSignal.timeout(8000));
 const incomingDefault=await get(agentPath),mainId=incomingDefault!.main_branch_id;
 if(incomingDefault!.agent_id!==target.agentId||!identifier(mainId)||mainId===target.branchId||incomingDefault!.branch_id!==mainId)fail('evidence_missing');
 const [main,privateAgent,listed,phone,procedureList]=await Promise.all([
  get(`${agentPath}?branch_id=${encodeURIComponent(mainId as string)}`),
  get(`${agentPath}?branch_id=${encodeURIComponent(target.branchId)}`),
  get(`${agentPath}/branches?include_archived=true&limit=100`),
  get(`/v1/convai/phone-numbers/${encodeURIComponent(target.phoneNumberId)}`),
  get(`${agentPath}/branches/${encodeURIComponent(mainId as string)}/procedures`),
 ]);
 for(const [agent,branchId] of [[main,mainId],[privateAgent,target.branchId]] as const){
  if(agent!.agent_id!==target.agentId||agent!.branch_id!==branchId||agent!.main_branch_id!==mainId||!identifier(agent!.version_id)||!object(agent!.conversation_config)||!object(agent!.platform_settings))fail('evidence_missing');
  procedures(agent!);
 }
 if(!same(stableAgent(incomingDefault!),stableAgent(main!)))fail('evidence_missing');
 const branchRows=listed!.results,meta=object(listed!.meta);
 if(!Array.isArray(branchRows)||!branchRows.length||branchRows.length>=100||(meta?.total!==undefined&&meta.total!==null&&meta.total!==branchRows.length))fail('evidence_missing');
 const branches:RecordValue[]=[],ids=new Set<string>();
 for(const raw of branchRows){
  const row=object(raw);
  if(!row||row.agent_id!==target.agentId||!identifier(row.id)||ids.has(row.id))fail('evidence_missing');
  if(row!.draft_exists===true)fail('drafts_present');
  if(row!.draft_exists!==false||typeof row!.is_archived!=='boolean'||typeof row!.current_live_percentage!=='number'||!Number.isFinite(row!.current_live_percentage))fail('evidence_missing');
  if(row!.current_live_percentage!==(row!.id===mainId?100:0))fail('routing_not_safe');
  ids.add(row!.id as string);branches.push(stableBranch(row!));
 }
 const mainBranch=branches.find(b=>b.id===mainId),privateBranch=branches.find(b=>b.id===target.branchId);
 if(!mainBranch||!privateBranch)fail('evidence_missing');
 if(mainBranch.is_archived!==false||privateBranch.is_archived!==false)fail('routing_not_safe');
 const assignment=object(phone!.assigned_agent);
 if(phone!.phone_number_id!==target.phoneNumberId||phone!.phone_number!==target.ingressNumber||phone!.provider!=='twilio'||assignment?.agent_id!==target.agentId||!Object.hasOwn(assignment,'branch_id')||(assignment.branch_id!==null&&assignment.branch_id!==mainId))fail('routing_not_safe');
 const published=procedures(main!),procedureRows=procedureList!.procedures,procedureEvidence:RecordValue[]=[],listedPublished:Record<string,{procedure_id:string;version_id:string}>=Object.create(null);
 if(!Array.isArray(procedureRows))fail('evidence_missing');
 for(const raw of procedureRows as unknown[]){
  const item=object(raw);
  if(!item||!identifier(item.procedure_id)||Object.hasOwn(listedPublished,item.procedure_id))fail('evidence_missing');
  if(item!.has_draft===true||!identifier(item!.version_id))fail('drafts_present');
  if(item!.has_draft!==false)fail('evidence_missing');
  listedPublished[item!.procedure_id as string]={procedure_id:item!.procedure_id as string,version_id:item!.version_id as string};
  procedureEvidence.push(item!);
 }
 if(!same(published,listedPublished))fail('evidence_missing');
 procedureEvidence.sort((a,b)=>String(a.procedure_id).localeCompare(String(b.procedure_id)));
 const sourceHook=webhook(privateAgent!),sourceHeaders=headers(sourceHook.request_headers),source=reference(sourceHeaders.authorization);
 if(!sourceHeaders.authorizationName||!source)fail('source_reference_invalid');
 const mainHook=webhook(main!),mainHeaders=headers(mainHook.request_headers);
 return {main:stableAgent(main!),incomingDefault:stableAgent(incomingDefault!),privateAgent:stableAgent(privateAgent!),phone:phone!,branches:branches.sort((a,b)=>String(a.id).localeCompare(String(b.id))),mainId:mainId as string,source:source!,published,procedureEvidence,hasAuthorization:mainHeaders.authorizationName!==null};
}
function fingerprint(value:Snapshot,secret:string){return createHmac('sha256',secret).update('icash-elevenlabs-auth-snapshot-v1\0').update(canonical(value)).digest('hex');}
type ReviewToken={v:1;op:typeof operation;fingerprint:string;expires:number;nonce:string};
function sign(encoded:string,secret:string){return createHmac('sha256',secret).update('icash-elevenlabs-auth-review-v1\0'+encoded).digest('base64url');}
function issue(value:Snapshot,secret:string,now:number){
 const fp=fingerprint(value,secret),expires=now+lifetimeMs;
 const encoded=Buffer.from(JSON.stringify({v:1,op:operation,fingerprint:fp,expires,nonce:randomBytes(16).toString('hex')} satisfies ReviewToken)).toString('base64url');
 return {fingerprint:fp,reviewToken:encoded+'.'+sign(encoded,secret),expiresAt:new Date(expires).toISOString()};
}
function validate(token:unknown,secret:string,now:number):ReviewToken{
 if(typeof token!=='string'||token.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token))fail('invalid_review');
 const [encoded,signature]=(token as string).split('.'),expected=sign(encoded,secret),actual=Buffer.from(signature),wanted=Buffer.from(expected);
 if(actual.length!==wanted.length||!timingSafeEqual(actual,wanted))fail('invalid_review');
 let parsed:RecordValue|null=null;try{parsed=object(JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')));}catch{fail('invalid_review');}
 if(!parsed||Object.keys(parsed).sort().join(',')!=='expires,fingerprint,nonce,op,v'||parsed.v!==1||parsed.op!==operation||typeof parsed.fingerprint!=='string'||!/^[a-f0-9]{64}$/.test(parsed.fingerprint)||typeof parsed.nonce!=='string'||!/^[a-f0-9]{32}$/.test(parsed.nonce)||typeof parsed.expires!=='number'||!Number.isSafeInteger(parsed.expires)||parsed.expires>now+lifetimeMs)fail('invalid_review');
 if(parsed!.expires as number<=now)fail('review_expired');
 return parsed as ReviewToken;
}
const active=new Set<string>(),used=new Map<string,number>();
// Best-effort process-local duplicate suppression only. No provider conditional
// write or durable transaction primitive exists here. A fresh snapshot check
// cannot prevent an external edit between that check and PATCH.
export async function prepareOwnerElevenLabsAuthorization(env:Environment,fetcher:typeof fetch=fetch,now=Date.now()):Promise<OwnerElevenLabsAuthorizationReview>{
 try{const {key,secret}=configuration(env),before=await snapshot(key,fetcher);
  if(before.hasAuthorization)return result('no_change','authorization_already_present');
  return result('ready','ready',issue(before,secret,now));
 }catch(error){return result('blocked',error instanceof RepairError?error.code:'provider_unavailable');}
}
function expectedAfter(before:Snapshot,after:Snapshot){
 if(after.main.version_id===before.main.version_id||after.incomingDefault.version_id!==after.main.version_id)return false;
 const expected=structuredClone(before),observed=structuredClone(after);
 for(const agent of [expected.main,expected.incomingDefault])webhook(agent).request_headers.Authorization=before.source;
 expected.hasAuthorization=true;
 for(const agent of [observed.main,observed.incomingDefault])agent.version_id=before.main.version_id;
 // A new version changes Main's commit timestamp; no other branch field may move.
 for(const state of [expected,observed])for(const branch of state.branches)if(branch.id===before.mainId)delete branch.last_committed_at;
 return same(expected,observed);
}
export async function applyOwnerElevenLabsAuthorization(env:Environment,reviewToken:unknown,fetcher:typeof fetch=fetch,now=Date.now()):Promise<OwnerElevenLabsAuthorizationReview>{
 let fingerprintInFlight:string|null=null,dispatched=false;
 try{
  const {key,secret}=configuration(env),token=validate(reviewToken,secret,now);
  for(const [nonce,expires] of used)if(expires<=now)used.delete(nonce);
  if(used.has(token.nonce)||active.has(token.fingerprint))return result('blocked','invalid_review');
  active.add(token.fingerprint);fingerprintInFlight=token.fingerprint;
  const before=await snapshot(key,fetcher);
  if(fingerprint(before,secret)!==token.fingerprint)return result('blocked','configuration_changed');
  if(before.hasAuthorization)return result('no_change','authorization_already_present');
  if(Date.now()>token.expires)return result('blocked','review_expired');
  // Consume locally before dispatch. Never retry PATCH, even after a thrown error.
  used.set(token.nonce,token.expires);
  const hook=webhook(before.main),patch={platform_settings:{workspace_overrides:{[webhookKey]:{url:hook.url,request_headers:{...hook.request_headers,Authorization:before.source}}}},procedures:before.published,version_description:'Restore existing saved inbound Authorization reference on Main only'};
  const url=`${origin}${agentPath}?branch_id=${encodeURIComponent(before.mainId)}`;let acknowledged=false,providerRequestStatus:number|null=null;
  try{
   dispatched=true;
   const response=await fetcher(url,{method:'PATCH',headers:{'xi-api-key':key,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify(patch),cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});
   providerRequestStatus=response.status;
   acknowledged=response.ok&&!response.redirected&&(!response.url||response.url===url);
   await response.body?.cancel().catch(()=>undefined);
  }catch{/* Dispatch may have succeeded; only read verification follows. */}
  let verified=false;try{verified=expectedAfter(before,await snapshot(key,fetcher));}catch{/* Never repeat a write because verification failed. */}
  if(!acknowledged)return result('outcome_unknown','apply_uncertain',{providerRequestStatus});
  return verified?result('verified_only_auth_changed','verified_only_auth_changed',{providerRequestStatus}):result('outcome_unknown','verification_failed',{providerRequestStatus});
 }catch(error){return dispatched?result('outcome_unknown','apply_uncertain'):result('blocked',error instanceof RepairError?error.code:'provider_unavailable');}
 finally{if(fingerprintInFlight)active.delete(fingerprintInFlight);}
}
