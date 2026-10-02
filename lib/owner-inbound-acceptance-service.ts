import {db} from '@/lib/stripe-test';
import {createOwnerInboundProviders} from './owner-inbound-providers.ts';
import {eligibleOwnerInboundCall,exactOwnerInboundTarget,validOwnerInboundAccountSid,inspectOwnerInbound,inspectOwnerInboundInitiation,ownerInboundChallenge,ownerInboundInitiation,ownerInboundReceiptHash,ownerInboundCostsBound,reconcileOwnerInbound,type OwnerInboundCall,type OwnerInboundConfig,type OwnerInboundRun} from './owner-inbound-acceptance.ts';
type Owner={accountId:string;userId:string};
const ownerParams=(owner:Owner)=>({p_account:owner.accountId,p_user:owner.userId});
const owned=(run:OwnerInboundRun,owner:Owner)=>run.account_id===owner.accountId&&run.owner_user_id===owner.userId;
function providers(c:OwnerInboundConfig,trustedAccountSid:string){return createOwnerInboundProviders({agentId:c.agent_id,branchId:c.branch_id,phoneNumberId:c.phone_number_id,twilioAccountSid:c.twilio_account_sid,elevenLabsRegion:c.elevenlabs_region,twilioRegion:c.twilio_region},{env:{ELEVENLABS_API_KEY:process.env.ELEVENLABS_API_KEY,TWILIO_ACCOUNT_SID:trustedAccountSid,TWILIO_AUTH_TOKEN:process.env.TWILIO_AUTH_TOKEN}});}
const enabled=()=>process.env.ICASH_OWNER_INBOUND_TEST_ENABLED==='true';
async function configFor(owner:Owner){const [c]=await db<OwnerInboundConfig[]>(`icash_owner_inbound_acceptance_config?account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&order=created_at.desc&limit=1&select=*`);return c;}
async function latestRun(owner:Owner){const [r]=await db<OwnerInboundRun[]>(`icash_owner_inbound_acceptance_runs?account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&order=armed_at.desc&limit=1&select=*`);return r;}
async function ownedRun(owner:Owner,id:string){const [r]=await db<OwnerInboundRun[]>(`icash_owner_inbound_acceptance_runs?id=eq.${id}&account_id=eq.${owner.accountId}&owner_user_id=eq.${owner.userId}&limit=1&select=*`);return r;}
function summary(run:OwnerInboundRun){return {status:run.state==='armed'&&Date.parse(run.expires_at)<=Date.now()?'expired_pending_cancel':run.state,canArm:false,runId:run.id,sourcePhone:run.configuration.source_phone,expiresAt:run.expires_at,reservedCents:run.reserved_cents,actualCostCents:run.actual_cost_cents,currency:'USD',canCancel:['armed','inspecting','claimed'].includes(run.state),canReconcile:['inspecting','claimed','needs_review'].includes(run.state)&&!run.settled_at&&!!run.provider_call_sid&&!!run.conversation_id};}
export async function ownerInboundStatus(owner:Owner){
 const accountSid=process.env.TWILIO_ACCOUNT_SID,run=await latestRun(owner);
 // A configuration outage must not hide cancellation for an already reserved run.
 if(run&&!run.settled_at)return summary(run);
 if(!validOwnerInboundAccountSid(accountSid))return {status:'not_configured',canArm:false};
 const c=await configFor(owner);if(!c||!exactOwnerInboundTarget(c,accountSid))return {status:'not_configured',canArm:false};
 if(run&&run.config_id===c.id)return summary(run);
 const canArm=enabled()&&c.enabled&&Date.parse(c.expires_at)>Date.now()&&c.all_in_cost_reviewed&&c.forwarding_no_incremental_cost&&c.provider_extras_disabled;
 return {status:canArm?'awaiting_owner_confirmation':'held',canArm,configId:c.id,quoteCapCents:c.quote_cap_cents,rateEvidenceHash:c.rate_evidence_hash,currency:'USD',expiresAt:c.expires_at,ownerPhone:c.owner_phone,sourcePhone:c.source_phone,maxDurationSeconds:60};
}
export async function armOwnerInbound(owner:Owner,approval:{configId:string;quoteCapCents:number;rateEvidenceHash:string}){
 const accountSid=process.env.TWILIO_ACCOUNT_SID;
 if(!enabled()||!validOwnerInboundAccountSid(accountSid))throw Error('OWNER_INBOUND_HELD');
 const c=await configFor(owner);
 if(!c||!exactOwnerInboundTarget(c,accountSid)||!c.enabled||c.id!==approval.configId||c.quote_cap_cents!==approval.quoteCapCents||c.rate_evidence_hash!==approval.rateEvidenceHash||!c.all_in_cost_reviewed||!c.forwarding_no_incremental_cost||!c.provider_extras_disabled||Date.parse(c.expires_at)<=Date.now())throw Error('OWNER_INBOUND_QUOTE_CHANGED');
 const api=providers(c,accountSid),[agent,branch,phone]=await Promise.all([api.agent(),api.branch(),api.phone()]);
 const review=inspectOwnerInbound(c,agent,branch,phone,accountSid);if(!review.reviewed)throw Error('OWNER_INBOUND_PROVIDER_REVIEW_REQUIRED');
 const challenge=ownerInboundChallenge();
 const run=await db<OwnerInboundRun|null>('rpc/icash_arm_owner_inbound_acceptance','POST',{...ownerParams(owner),p_config:c.id,p_hash:review.hash,p_version:review.version,p_expected:c,p_challenge_salt:challenge.salt,p_challenge_hash:challenge.hash});
 if(!run||!owned(run,owner)||run.state!=='armed')throw Error('OWNER_INBOUND_ARM_UNCONFIRMED_NO_RETRY');
 // Plaintext leaves the server exactly once, in the authenticated no-store arm
 // response. It is never part of configuration, receipts, URLs, logs or prompts.
 return {...summary(run),challenge:challenge.code,sourcePhone:c.source_phone};
}
export async function cancelOwnerInbound(owner:Owner,id:string){
 const run=await db<OwnerInboundRun|null>('rpc/icash_cancel_owner_inbound_acceptance','POST',{...ownerParams(owner),p_run:id});
 if(!run||!owned(run,owner))throw Error('OWNER_INBOUND_CANCEL_UNCONFIRMED');return summary(run);
}
function unknownEvidence(){return {outcome:'needs_review',challenge_passed:null,audio_passed:null,duration_seconds:null,result_receipt_hash:null,twilio_cost_micros:null,elevenlabs_cost_micros:null,twilio_receipt_hash:null,elevenlabs_receipt_hash:null};}
async function consumeUnknown(run:OwnerInboundRun){
 try{await db('rpc/icash_finish_owner_inbound_acceptance','POST',{p_account:run.account_id,p_user:run.owner_user_id,p_run:run.id,p_call_sid:run.provider_call_sid,p_conversation:run.conversation_id,p_evidence:unknownEvidence()});}catch{/* Durable inspecting/claimed row and reservation stay consumed. Never retry admission. */}
}
/** Called only after exact Bearer webhook authentication. A signed webhook is an
 * event notification, never authoritative provider evidence. No fallback route. */
export async function beginOwnerInbound(call:OwnerInboundCall){
 const accountSid=process.env.TWILIO_ACCOUNT_SID;if(!enabled()||!validOwnerInboundAccountSid(accountSid))return null;
 const runs=await db<OwnerInboundRun[]>(`icash_owner_inbound_acceptance_runs?state=eq.armed&order=armed_at.desc&limit=2&select=*`);
 const candidates=runs.filter(r=>eligibleOwnerInboundCall(r.configuration,call,accountSid));if(candidates.length!==1)return null;
 const pending=candidates[0];
 const run=await db<OwnerInboundRun|null>('rpc/icash_attempt_owner_inbound_acceptance','POST',{p_account:pending.account_id,p_user:pending.owner_user_id,p_run:pending.id,p_call_sid:call.call_sid,p_conversation:call.conversation_id});
 if(!run)return null;
 try{
  const c=run.configuration,api=providers(c,accountSid);
  const [agent,branch,phone,twilio]=await Promise.all([api.agent(),api.branch(),api.phone(),api.twilio(call.call_sid)]);
  const review=inspectOwnerInbound(c,agent,branch,phone,accountSid);
  if(!review.reviewed||!inspectOwnerInboundInitiation(run,twilio,accountSid))throw Error('OWNER_INBOUND_RECEIPT_REQUIRED');
  const claimed=await db<OwnerInboundRun|null>('rpc/icash_claim_owner_inbound_acceptance','POST',{p_account:run.account_id,p_user:run.owner_user_id,p_run:run.id,p_call_sid:call.call_sid,p_conversation:call.conversation_id,p_hash:review.hash,p_version:review.version,p_receipt_hash:ownerInboundReceiptHash({twilio,call})});
  if(!claimed)throw Error('OWNER_INBOUND_CLAIM_UNCONFIRMED');
  return ownerInboundInitiation(claimed);
 }catch{await consumeUnknown(run);return null;}
}
/** Explicit same-origin owner reconciliation only. Receipt request payloads from
 * the browser cannot reach either verification or settlement. */
export async function reconcileOwnerInboundRun(owner:Owner,id:string){
 const accountSid=process.env.TWILIO_ACCOUNT_SID;
 const run=await ownedRun(owner,id);if(!run||!owned(run,owner))throw Error('OWNER_INBOUND_RUN_MISSING');
 if(!['inspecting','claimed','needs_review'].includes(run.state)||run.settled_at||!run.provider_call_sid||!run.conversation_id)return summary(run);
 if(!validOwnerInboundAccountSid(accountSid)||!exactOwnerInboundTarget(run.configuration,accountSid))return {...summary(run),status:'needs_review_no_retry',canArm:false};
 try{
  const c=run.configuration,api=providers(c,accountSid);
  const [twilio,conversation,agent,branch,phone]=await Promise.all([api.twilio(run.provider_call_sid!),api.conversation(run.conversation_id!),api.agent(),api.branch(),api.phone()]);
  const t=twilio as {status?:string},v=conversation as {status?:string;metadata?:{call_duration_secs?:number}};
  // Pending receipts leave a consumed run pending; they do not settle, release,
  // re-arm or classify a partially completed transcript as a failed challenge.
  if(['queued','ringing','in-progress'].includes(t.status??'')||['initiated','in-progress','processing'].includes(v.status??''))return {...summary(run),status:'provider_processing'};
  const result=inspectOwnerInbound(c,agent,branch,phone,accountSid).reviewed?reconcileOwnerInbound(run,twilio,conversation,accountSid):{audioResult:'needs_review',challengeResult:'unverified'};
  const costs=api.costs(twilio,conversation),costsBound=ownerInboundCostsBound(run,twilio,conversation,accountSid),audio=result.audioResult==='verified',challenge=result.challengeResult==='passed';
  const evidence={outcome:audio?(challenge?'passed':'failed'):'needs_review',challenge_passed:audio?challenge:null,audio_passed:audio,duration_seconds:audio?v.metadata!.call_duration_secs!:null,result_receipt_hash:ownerInboundReceiptHash({twilio,conversation}),twilio_cost_micros:costs.twilioCostMicros,elevenlabs_cost_micros:costs.elevenLabsCostMicros,twilio_receipt_hash:costs.twilioCostMicros===null?null:ownerInboundReceiptHash(twilio),elevenlabs_receipt_hash:costs.elevenLabsCostMicros===null?null:ownerInboundReceiptHash(conversation)};
  // Costs from mismatched receipts must never settle a different call.
  if(!costsBound){evidence.twilio_cost_micros=null;evidence.elevenlabs_cost_micros=null;evidence.twilio_receipt_hash=null;evidence.elevenlabs_receipt_hash=null;}
  const completed=await db<OwnerInboundRun|null>('rpc/icash_finish_owner_inbound_acceptance','POST',{...ownerParams(owner),p_run:run.id,p_call_sid:run.provider_call_sid,p_conversation:run.conversation_id,p_evidence:evidence});
  if(!completed)throw Error('OWNER_INBOUND_SETTLEMENT_UNCONFIRMED');return summary(completed);
 }catch{await consumeUnknown(run);return {status:'needs_review_no_retry',canArm:false,runId:run.id};}
}
