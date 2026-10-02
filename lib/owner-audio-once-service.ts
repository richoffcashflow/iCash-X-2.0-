import {db} from '@/lib/stripe-test';
import {createOwnerInboundProviders} from './owner-inbound-providers.ts';
import {ownerInboundTarget,ownerInboundChallenge,validOwnerInboundAccountSid,type OwnerInboundCall} from './owner-inbound-acceptance.ts';
import {audioOnceInitiation,inspectAudioCall,inspectAudioOnce,isAudioCall,isAudioOwner,reconcileAudioOnce,type AudioRun} from './owner-audio-once.ts';
type Owner={accountId:string;userId:string};
const target=ownerInboundTarget;
const params=(o:Owner)=>({p_account:o.accountId,p_user:o.userId});
function owner(o:Owner){if(!isAudioOwner(o))throw Error('OWNER_REQUIRED');}
function trustedAccountSid(){const sid=process.env.TWILIO_ACCOUNT_SID?.trim();if(!sid)throw Error('AUDIO_TWILIO_ACCOUNT_MISSING');if(!validOwnerInboundAccountSid(sid))throw Error('AUDIO_TWILIO_ACCOUNT_INVALID');return sid;}
function providers(){
 const sid=trustedAccountSid();
 const token=process.env.TWILIO_AUTH_TOKEN?.trim();if(!token)throw Error('AUDIO_TWILIO_TOKEN_MISSING');
 return createOwnerInboundProviders({agentId:target.agentId,branchId:target.branchId,phoneNumberId:target.phoneNumberId,twilioAccountSid:sid,elevenLabsRegion:'us',twilioRegion:'us1'},{env:{ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY,TWILIO_ACCOUNT_SID:sid,TWILIO_AUTH_TOKEN:token}});
}
const latest=async()=>{const [r]=await db<AudioRun[]>('icash_owner_audio_once?id=eq.1&select=*&limit=1');return r;};
function summary(r:AudioRun){return {status:r.state==='armed'&&Date.parse(r.expires_at)<=Date.now()?'expired':r.state,canArm:false,canCancel:r.state==='armed',canReconcile:['claimed','inspecting','needs_review'].includes(r.state)&&!!r.call_sid&&!!r.conversation_id,expiresAt:r.expires_at,result:r.result,maxDurationSeconds:60,customerCreditCharge:false,forwardingVerified:false};}
async function review(){
 const api=providers();
 const read=async(call:()=>Promise<unknown>,code:string)=>{try{return await call();}catch(error){
  if(code==='AUDIO_TWILIO_READ_UNAVAILABLE'&&error instanceof Error){
   const status=(error as Error&{providerHttpStatus?:unknown}).providerHttpStatus;
   if(error.message==='OWNER_INBOUND_PROVIDER_UNAVAILABLE'&&typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599)throw Error(`AUDIO_TWILIO_HTTP_${status}`);
   if(error.message==='OWNER_INBOUND_PROVIDER_UNAVAILABLE'&&(error as Error&{providerFailure?:unknown}).providerFailure==='network')throw Error('AUDIO_TWILIO_NETWORK_FAILURE');
   if(error.message==='OWNER_INBOUND_PROVIDER_CREDENTIALS_UNAVAILABLE')throw Error('AUDIO_TWILIO_TOKEN_INVALID');
   if(error.message==='OWNER_INBOUND_PROVIDER_RECEIPT_INVALID')throw Error('AUDIO_TWILIO_RESPONSE_INVALID');
  }
  throw Error(code);
 }};
 const priorSid='CAc7bc8aa402619ced824617d1efa894d9';
 const [agent,branch,phone,incoming,prior]=await Promise.all([read(api.agent,'AUDIO_PRIVATE_AGENT_READ_UNAVAILABLE'),read(api.branch,'AUDIO_BRANCH_READ_UNAVAILABLE'),read(api.phone,'AUDIO_PHONE_READ_UNAVAILABLE'),read(api.incomingAgent,'AUDIO_MAIN_READ_UNAVAILABLE'),read(()=>api.twilio(priorSid),'AUDIO_TWILIO_READ_UNAVAILABLE')]);
 const receipt=prior as Record<string,unknown>;
 if(!receipt||receipt.sid!==priorSid||receipt.account_sid!==trustedAccountSid()||receipt.from!==target.ownerPhone||receipt.to!==target.ingressNumber||receipt.direction!=='inbound')throw Error('AUDIO_TWILIO_RECEIPT_MISMATCH');
 return {api,review:inspectAudioOnce(agent,branch,phone,incoming)};
}
export async function audioOnceStatus(o:Owner){
 owner(o);const run=await latest();if(run)return summary(run);
 const {review:r}=await review();
 return {status:r.safe?'ready':'held',canArm:r.safe,canCancel:false,canReconcile:false,checks:r.checks,incomingDiagnostics:r.incomingDiagnostics,configHash:r.hash,versionId:r.version,maxDurationSeconds:60,customerCreditCharge:false,forwardingVerified:false};
}
export async function armAudioOnce(o:Owner,hash:string,version:string){
 owner(o);if(await latest())throw Error('AUDIO_ALREADY_CONSUMED');
 const {review:r}=await review();if(!r.safe||r.hash!==hash||r.version!==version)throw Error('AUDIO_REVIEW_CHANGED');
 const challenge=ownerInboundChallenge();
 const run=await db<AudioRun|null>('rpc/icash_arm_owner_audio_once','POST',{...params(o),p_hash:r.hash,p_version:r.version,p_branch_name:r.branchName,p_salt:challenge.salt,p_challenge_hash:challenge.hash});
 if(!run||run.state!=='armed')throw Error('AUDIO_ARM_UNCONFIRMED');
 return {...summary(run),challenge:challenge.code};
}
export async function cancelAudioOnce(o:Owner){owner(o);const r=await db<AudioRun|null>('rpc/icash_cancel_owner_audio_once','POST',params(o));if(!r)throw Error('AUDIO_CANCEL_UNCONFIRMED');return summary(r);}
const unknown=()=>({status:'needs_review',forwarding:'unverified',durationSeconds:null,challenge:'unverified'});
async function finish(run:AudioRun,result:unknown){return db<AudioRun|null>('rpc/icash_finish_owner_audio_once','POST',{p_call_sid:run.call_sid,p_conversation:run.conversation_id,p_result:result});}
/** Exact authenticated notification only; durable claim consumes before provider
 * reads. Caller ID alone never verifies the owner. The test exposes no business
 * data/tools; dashboard code is checked only against authoritative GET receipts. */
export async function beginAudioOnce(call:OwnerInboundCall){
 if(!isAudioCall(call))return null;
 const run=await db<AudioRun|null>('rpc/icash_attempt_owner_audio_once','POST',{p_call_sid:call.call_sid,p_conversation:call.conversation_id});
 if(!run)return null;
 try{
  const api=providers(),[agent,branch,phone,twilio,incoming]=await Promise.all([api.agent(),api.branch(),api.phone(),api.twilio(call.call_sid),api.incomingAgent()]);
  const r=inspectAudioOnce(agent,branch,phone,incoming);
  if(!r.safe||r.hash!==run.config_hash||r.version!==run.version_id||!inspectAudioCall(run,twilio,trustedAccountSid()))throw Error('AUDIO_HELD');
  const claimed=await db<AudioRun|null>('rpc/icash_claim_owner_audio_once','POST',{p_call_sid:call.call_sid,p_conversation:call.conversation_id,p_hash:r.hash,p_version:r.version});
  if(!claimed)throw Error('AUDIO_CLAIM_UNCONFIRMED');
  return audioOnceInitiation(claimed);
 }catch{try{await finish(run,unknown());}catch{/* Durable consumed state remains. */}return null;}
}
export async function reconcileAudioOnceRun(o:Owner){
 owner(o);const run=await latest();if(!run)throw Error('AUDIO_RUN_MISSING');
 if(!['claimed','inspecting','needs_review'].includes(run.state)||!run.call_sid||!run.conversation_id)return summary(run);
 try{
  const api=providers(),[twilio,conversation]=await Promise.all([api.twilio(run.call_sid),api.conversation(run.conversation_id)]);
  const t=twilio as {status?:string},v=conversation as {status?:string};
  if(['ringing','queued','in-progress'].includes(t.status??'')||['initiated','in-progress','processing'].includes(v.status??''))return {...summary(run),status:'provider_processing'};
  const result=reconcileAudioOnce(run,twilio,conversation,trustedAccountSid()),completed=await finish(run,result);
  if(!completed)throw Error('AUDIO_RESULT_UNCONFIRMED');return summary(completed);
 }catch{return {...summary(run),status:'needs_review',canArm:false};}
}
