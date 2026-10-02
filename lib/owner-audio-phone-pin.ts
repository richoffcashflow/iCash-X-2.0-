import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {ownerInboundTarget} from './owner-inbound-acceptance.ts';
import {inspectAudioOnce} from './owner-audio-once.ts';

// Fixed phone branch-only control. Official PATCH accepts branch_id: string|null:
// https://elevenlabs.io/docs/api-reference/phone-numbers/update (2026-10-02).
// Capture null distinctly from explicit Main; never PATCH an agent or credential.
type RecordValue=Record<string,unknown>;
type Environment={ELEVENLABS_API_KEY?:string;ELEVENLABS_INBOUND_WEBHOOK_SECRET?:string};
const target=ownerInboundTarget,origin='https://api.us.elevenlabs.io';
const agentPath=`/v1/convai/agents/${encodeURIComponent(target.agentId)}`;
const phonePath=`/v1/convai/phone-numbers/${encodeURIComponent(target.phoneNumberId)}`;
const operation='temporary_owner_audio_phone_pin' as const;
const pinLifetime=120_000,restoreLifetime=24*60*60*1000,maximumBytes=1024*1024;
const messages={
 ready:'Ready to temporarily route the phone to the isolated 60-second audio test. Retain this review to restore the exact original assignment.',
 pinned:'The phone is pinned to the isolated audio-test branch. Read-back verified the phone-only change and unchanged agent configurations. The test must still be armed separately.',
 restored:'Read-back verified the exact original phone assignment and unchanged other phone settings.',
 already_pinned:'The phone is already pinned. Use the retained review to inspect or restore its original assignment.',
 routing_not_safe:'The fixed phone, agent or branch routing does not match the required configuration. No change was sent.',
 unsafe_configuration:'The private audio-test safety checks did not pass. No change was sent.',
 evidence_missing:'Required published configuration or routing evidence is missing. No change was sent.',
 configuration_changed:'Configuration changed after review. No change was sent; inspect the current state.',
 review_expired:'The pin review expired. No change was sent; review the current state again.',
 restore_expired:'The restoration review expired. No change was sent; the phone needs an independently reviewed restoration.',
 invalid_review:'A valid retained owner review is required. No change was sent.',
 provider_unavailable:'The provider could not be checked. No change was sent.',
 provider_auth_failed:'The existing provider API credential was not accepted. No change was sent.',
 provider_access_denied:'The existing provider API credential cannot access the required phone settings. No change was sent.',
 provider_receipt_invalid:'The provider returned incomplete or invalid evidence. No change was sent.',
 verification_failed:'The request was sent, but its exact result could not be verified. Keep the review and use read-only inspection; do not retry the write automatically.',
 apply_uncertain:'The request outcome is uncertain. Keep the review and use read-only inspection; do not retry the write automatically.',
 configuration_unavailable:'The existing server configuration is unavailable. No change was sent.',
} as const;
export type OwnerAudioPhonePinReason=keyof typeof messages;
export type OwnerAudioPhonePinReview={
 status:'ready'|'pinned'|'restored'|'blocked'|'outcome_unknown';reason:OwnerAudioPhonePinReason;message:string;operation:typeof operation;
 fingerprint:string|null;reviewToken:string|null;expiresAt:string|null;restoreExpiresAt:string|null;checkedAt:string;
 providerRequestStatus?:number|null;concurrencyProtection:'fresh_snapshot_check_only';
};
class PinError extends Error{readonly code:OwnerAudioPhonePinReason;constructor(code:OwnerAudioPhonePinReason){super(code);this.code=code;}}
function fail(code:OwnerAudioPhonePinReason):never{throw new PinError(code);}
const object=(v:unknown):RecordValue|null=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:null;
const branchId=(v:unknown):v is string=>typeof v==='string'&&/^agtbrch_[A-Za-z0-9]{1,180}$/.test(v);
function canonical(v:unknown):string{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';const o=object(v);return o?'{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k])).join(',')+'}':JSON.stringify(v)??'undefined';}
const same=(a:unknown,b:unknown)=>canonical(a)===canonical(b);
function result(status:OwnerAudioPhonePinReview['status'],reason:OwnerAudioPhonePinReason,extra:Partial<OwnerAudioPhonePinReview>={}):OwnerAudioPhonePinReview{
 return {status,reason,message:messages[reason],operation,fingerprint:null,reviewToken:null,expiresAt:null,restoreExpiresAt:null,checkedAt:new Date().toISOString(),concurrencyProtection:'fresh_snapshot_check_only',...extra};
}
function configuration(env:Environment){
 const key=env.ELEVENLABS_API_KEY,secret=env.ELEVENLABS_INBOUND_WEBHOOK_SECRET;
 if(typeof window!=='undefined'||typeof key!=='string'||!key.length||key.length>4096||!/^[\x21-\x7e]+$/.test(key)||typeof secret!=='string'||secret.length<32||secret.length>505||!/^[\x21-\x7e]+$/.test(secret))fail('configuration_unavailable');
 return {key:key as string,secret:secret as string};
}
async function receipt(response:Response,signal:AbortSignal):Promise<RecordValue>{
 const length=response.headers.get('content-length');
 if(length&&(!/^\d+$/.test(length)||Number(length)>maximumBytes))fail('provider_receipt_invalid');
 if(!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type')??'')||!response.body)fail('provider_receipt_invalid');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){signal.throwIfAborted();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>maximumBytes)fail('provider_receipt_invalid');chunks.push(part.value);}}
 catch{await reader.cancel().catch(()=>undefined);fail('provider_receipt_invalid');}finally{reader.releaseLock();}
 try{return object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))))??fail('provider_receipt_invalid');}catch{fail('provider_receipt_invalid');}
}
function provider(key:string,fetcher:typeof fetch){
 const signal=AbortSignal.timeout(8000);
 return async(path:string)=>{
  const url=origin+path;let response:Response;
  try{response=await fetcher(url,{method:'GET',headers:{'xi-api-key':key,Accept:'application/json'},cache:'no-store',redirect:'error',credentials:'omit',signal});}catch{fail('provider_unavailable');}
  if(response!.redirected||(response!.url&&response!.url!==url))fail('provider_unavailable');
  if(!response!.ok)fail(response!.status===401?'provider_auth_failed':response!.status===403?'provider_access_denied':'provider_unavailable');
  return receipt(response!,signal);
 };
}
function phoneAssignment(phone:RecordValue):RecordValue&{branch_id:string|null}{
 const assigned=object(phone.assigned_agent);
 if(phone.phone_number_id!==target.phoneNumberId||phone.phone_number!==target.ingressNumber||phone.provider!=='twilio'||assigned?.agent_id!==target.agentId||!Object.hasOwn(assigned,'branch_id')||(assigned.branch_id!==null&&!branchId(assigned.branch_id)))fail('routing_not_safe');
 return assigned as RecordValue&{branch_id:string|null};
}
// GET agent embeds phone routing receipts. Protect all mirror fields, while
// accounting for the same target branch change in the expected post-pin state.
// Official GetAgentResponseModel.phone_numbers -> PhoneNumberAgentInfo.branch_id.
function mirroredPhone(agent:RecordValue):RecordValue|null{
 if(agent.phone_numbers===undefined)return null;
 if(!Array.isArray(agent.phone_numbers))fail('evidence_missing');
 const matches=agent.phone_numbers.filter(raw=>object(raw)?.phone_number_id===target.phoneNumberId);
 if(matches.length>1)fail('evidence_missing');
 return matches.length?object(matches[0]):null;
}
function stableAgent(a:RecordValue){const v={...a};for(const k of ['metadata','access_info','default_hold_audio_url'])delete v[k];return v;}
function stableBranch(b:RecordValue){const v={...b};for(const k of ['calls_7d','commits_ahead','commits_behind','access_info'])delete v[k];return v;}
type Snapshot={main:RecordValue;privateAgent:RecordValue;phone:RecordValue;branches:RecordValue[]};
async function snapshot(key:string,fetcher:typeof fetch):Promise<Snapshot>{
 const get=provider(key,fetcher),incoming=await get(agentPath),mainId=incoming.main_branch_id;
 if(incoming.agent_id!==target.agentId||!branchId(mainId)||mainId===target.branchId||incoming.branch_id!==mainId)fail('evidence_missing');
 const [main,privateAgent,listed,phone]=await Promise.all([get(`${agentPath}?branch_id=${encodeURIComponent(mainId)}`),get(`${agentPath}?branch_id=${encodeURIComponent(target.branchId)}`),get(`${agentPath}/branches?include_archived=true&limit=100`),get(phonePath)]);
 for(const [agent,id] of [[main,mainId],[privateAgent,target.branchId]] as const)if(agent.agent_id!==target.agentId||agent.branch_id!==id||agent.main_branch_id!==mainId||typeof agent.version_id!=='string'||!/^agtvrsn_[A-Za-z0-9]{1,180}$/.test(agent.version_id)||!object(agent.conversation_config)||!object(agent.platform_settings))fail('evidence_missing');
 if(!same(stableAgent(incoming),stableAgent(main)))fail('evidence_missing');
 const rows=listed.results,meta=object(listed.meta);
 if(!Array.isArray(rows)||!rows.length||rows.length>=100||(meta?.total!==undefined&&meta.total!==null&&meta.total!==rows.length))fail('evidence_missing');
 const branches:RecordValue[]=[],ids=new Set<string>();
 for(const item of rows as unknown[]){
  const b=object(item);
  if(!b||b.agent_id!==target.agentId||!branchId(b.id)||ids.has(b.id)||b.draft_exists!==false||typeof b.is_archived!=='boolean')fail('evidence_missing');
  if(b.current_live_percentage!==(b.id===mainId?100:0))fail('routing_not_safe');
  ids.add(b.id as string);branches.push(stableBranch(b));
 }
 const mainBranch=branches.find(b=>b.id===mainId),privateBranch=branches.find(b=>b.id===target.branchId),assignment=phoneAssignment(phone);
 if(!mainBranch||!privateBranch)fail('evidence_missing');
 if(mainBranch.is_archived!==false||privateBranch.is_archived!==false||![null,mainId,target.branchId].includes(assignment.branch_id))fail('routing_not_safe');
 for(const agent of [main,privateAgent]){const mirror=mirroredPhone(agent);if(mirror&&phoneAssignment(mirror).branch_id!==assignment.branch_id)fail('evidence_missing');}
 if(!inspectAudioOnce(privateAgent,privateBranch,phone,main,true).safe)fail('unsafe_configuration');
 return {main:stableAgent(main),privateAgent:stableAgent(privateAgent),phone,branches:branches.sort((a,b)=>String(a.id).localeCompare(String(b.id)))};
}
function digest(value:unknown,secret:string,purpose:string){return createHmac('sha256',secret).update(`icash-audio-phone-pin-${purpose}-v1\0`).update(canonical(value)).digest('hex');}
function phoneFingerprint(phone:RecordValue,secret:string){const normalized=structuredClone(phone);delete (normalized.assigned_agent as RecordValue).branch_id;return digest(normalized,secret,'phone');}
type Token={v:1;op:typeof operation;fingerprint:string;pinnedFingerprint:string;phoneFingerprint:string;originalBranch:string|null;expires:number;restoreExpires:number;nonce:string};
function signature(encoded:string,secret:string){return createHmac('sha256',secret).update('icash-audio-phone-pin-review-v1\0'+encoded).digest('base64url');}
function tokenFields(token:Token,reviewToken:string){return {fingerprint:token.fingerprint,reviewToken,expiresAt:new Date(token.expires).toISOString(),restoreExpiresAt:new Date(token.restoreExpires).toISOString()};}
function issue(before:Snapshot,secret:string,now:number){
 const expected=structuredClone(before);phoneAssignment(expected.phone).branch_id=target.branchId;
 for(const agent of [expected.main,expected.privateAgent]){const mirror=mirroredPhone(agent);if(mirror)phoneAssignment(mirror).branch_id=target.branchId;}
 const token:Token={v:1,op:operation,fingerprint:digest(before,secret,'snapshot'),pinnedFingerprint:digest(expected,secret,'snapshot'),phoneFingerprint:phoneFingerprint(before.phone,secret),originalBranch:phoneAssignment(before.phone).branch_id,expires:now+pinLifetime,restoreExpires:now+restoreLifetime,nonce:randomBytes(16).toString('hex')};
 const encoded=Buffer.from(JSON.stringify(token)).toString('base64url');return tokenFields(token,encoded+'.'+signature(encoded,secret));
}
function validate(raw:unknown,secret:string,now:number,pin=false):Token{
 if(typeof raw!=='string'||raw.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(raw))fail('invalid_review');
 const [encoded,signed]=(raw as string).split('.'),expected=Buffer.from(signature(encoded,secret)),actual=Buffer.from(signed);
 if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail('invalid_review');
 let t:RecordValue|null=null;try{t=object(JSON.parse(Buffer.from(encoded,'base64url').toString('utf8')));}catch{fail('invalid_review');}
 if(!t||Object.keys(t).sort().join(',')!=='expires,fingerprint,nonce,op,originalBranch,phoneFingerprint,pinnedFingerprint,restoreExpires,v'||t.v!==1||t.op!==operation||![t.fingerprint,t.pinnedFingerprint,t.phoneFingerprint].every(v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v))||typeof t.nonce!=='string'||!/^[a-f0-9]{32}$/.test(t.nonce)||(t.originalBranch!==null&&(!branchId(t.originalBranch)||t.originalBranch===target.branchId))||typeof t.expires!=='number'||!Number.isSafeInteger(t.expires)||typeof t.restoreExpires!=='number'||!Number.isSafeInteger(t.restoreExpires)||t.restoreExpires-t.expires!==restoreLifetime-pinLifetime||t.expires>now+pinLifetime||t.restoreExpires>now+restoreLifetime)fail('invalid_review');
 if(t.restoreExpires as number<=now)fail('restore_expired');if(pin&&t.expires as number<=now)fail('review_expired');return t as Token;
}
const failure=(error:unknown)=>error instanceof PinError?error.code:'provider_unavailable';
// Process-local duplicate suppression only. The provider has no conditional PATCH:
// fresh snapshots cannot prevent an external edit between the read and the write.
const active=new Set<string>(),used=new Map<string,number>();
export async function prepareOwnerAudioPhonePin(env:Environment,fetcher:typeof fetch=fetch,now=Date.now()):Promise<OwnerAudioPhonePinReview>{
 try{const {key,secret}=configuration(env),before=await snapshot(key,fetcher);if(phoneAssignment(before.phone).branch_id===target.branchId)return result('blocked','already_pinned');return result('ready','ready',issue(before,secret,now));}
 catch(error){return result('blocked',failure(error));}
}
async function currentPhone(key:string,secret:string,token:Token,fetcher:typeof fetch){const phone=await provider(key,fetcher)(phonePath);phoneAssignment(phone);if(phoneFingerprint(phone,secret)!==token.phoneFingerprint)fail('configuration_changed');return phone;}
export async function inspectOwnerAudioPhonePin(env:Environment,raw:unknown,fetcher:typeof fetch=fetch,now=Date.now()):Promise<OwnerAudioPhonePinReview>{
 try{const {key,secret}=configuration(env),token=validate(raw,secret,now),extra=tokenFields(token,raw as string),phone=await currentPhone(key,secret,token,fetcher),branch=phoneAssignment(phone).branch_id;
  if(branch===token.originalBranch)return result('restored','restored',extra);
  if(branch!==target.branchId)return result('blocked','configuration_changed',extra);
  const current=await snapshot(key,fetcher);if(digest(current,secret,'snapshot')!==token.pinnedFingerprint)return result('blocked','configuration_changed',extra);
  return result('pinned','pinned',extra);
 }catch(error){return result('blocked',failure(error));}
}
async function change(env:Environment,raw:unknown,mode:'pin'|'restore',fetcher:typeof fetch,now:number):Promise<OwnerAudioPhonePinReview>{
 let dispatched=false,locked=false,extra:Partial<OwnerAudioPhonePinReview>={};
 try{
  const {key,secret}=configuration(env),token=validate(raw,secret,now,mode==='pin');extra=tokenFields(token,raw as string);
  for(const [id,expires] of used)if(expires<=now)used.delete(id);
  const id=token.nonce+':'+mode;if(active.has(phonePath)||used.has(id))return result('blocked','invalid_review',extra);
  active.add(phonePath);locked=true;
  let before:Snapshot|null=null;
  if(mode==='pin'){before=await snapshot(key,fetcher);if(digest(before,secret,'snapshot')!==token.fingerprint)return result('blocked','configuration_changed',extra);}
  else{
   const phone=await currentPhone(key,secret,token,fetcher),branch=phoneAssignment(phone).branch_id;
   if(branch===token.originalBranch)return result('restored','restored',extra);
   if(branch!==target.branchId)return result('blocked','configuration_changed',extra);
  }
  if(Date.now()>token.restoreExpires)return result('blocked','restore_expired',extra);
  if(mode==='pin'&&Date.now()>token.expires)return result('blocked','review_expired',extra);
  used.set(id,token.restoreExpires);
  const desired=mode==='pin'?target.branchId:token.originalBranch,url=origin+phonePath;let acknowledged=false,providerRequestStatus:number|null=null;
  try{
   dispatched=true;
   const response=await fetcher(url,{method:'PATCH',headers:{'xi-api-key':key,Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({branch_id:desired}),cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(8000)});
   providerRequestStatus=response.status;acknowledged=response.ok&&!response.redirected&&(!response.url||response.url===url);await response.body?.cancel().catch(()=>undefined);
  }catch{/* A lost response is not permission to repeat the write. */}
  let verified=false;
  try{verified=mode==='pin'?digest(await snapshot(key,fetcher),secret,'snapshot')===token.pinnedFingerprint:phoneAssignment(await currentPhone(key,secret,token,fetcher)).branch_id===desired;}catch{/* Read-only verification only. */}
  extra={...extra,providerRequestStatus};
  if(!acknowledged)return result('outcome_unknown','apply_uncertain',extra);
  if(!verified)return result('outcome_unknown','verification_failed',extra);
  return result(mode==='pin'?'pinned':'restored',mode==='pin'?'pinned':'restored',extra);
 }catch(error){return result(dispatched?'outcome_unknown':'blocked',dispatched?'apply_uncertain':failure(error),extra);}
 finally{if(locked)active.delete(phonePath);}
}
export async function applyOwnerAudioPhonePin(env:Environment,token:unknown,fetcher:typeof fetch=fetch,now=Date.now()){return change(env,token,'pin',fetcher,now);}
export async function restoreOwnerAudioPhonePin(env:Environment,token:unknown,fetcher:typeof fetch=fetch,now=Date.now()){return change(env,token,'restore',fetcher,now);}
/** Validate only the signed token and pin deadline before durable reservation.
 * This does not replace apply's fresh provider snapshot or authorize a write. */
export function assertPinReviewCurrent(env:Environment,raw:unknown,now=Date.now()){
 const {secret}=configuration(env),token=validate(raw,secret,now,true);return tokenFields(token,raw as string);
}
