import {dispatchCustomerUpdate} from './customer-updates-service';
import {dispatchAttentionNotification} from './attention-notifications-service';
import {readVoiceUsagePolicies,settlePendingVoiceUsage,type VoiceUsageDb} from './voice-usage-service';
import {reconcileLiveConversation} from './live-conversation-service';
import {processFollowupCheckpoints} from './followup-checkpoints';

/** The primary finish transaction already persisted this account's follow-up.
 * A fresh one-use ticket only recovers original receipts and existing notices.
 * A missing receipt keeps its money hold; it never authorizes primary replay.
 */
export async function processAutomationFollowup(database:VoiceUsageDb,accountId:string,ticketId:string){
 const deadline=AbortSignal.timeout(45000);
 const db:VoiceUsageDb=(path,method,body)=>{deadline.throwIfAborted();return database(path,method,body,deadline);};
 const context=await db<{notify:boolean;stepCheckpoints?:boolean}|null>('rpc/icash_account_followup_context','POST',{p_account:accountId,p_ticket:ticketId});
 if(!context)throw Error('RECONCILIATION_LEASE_CHANGED');
 if(context.stepCheckpoints===true){
  const {success,outcomes}=await processFollowupCheckpoints(database,accountId,ticketId,[
   {name:'estimates',timeoutMs:10000,run:async database=>{
    const result=await database<{settled:number;held:number}|null>('rpc/icash_settle_pending_estimates','POST',{p_account:accountId,p_limit:25});
    const valid=!!result&&Number.isSafeInteger(result.settled)&&result.settled>=0&&Number.isSafeInteger(result.held)&&result.held>=0&&result.settled+result.held<=25;
    const pending=await database<boolean|null>('rpc/icash_account_followup_pending','POST',{p_account:accountId,p_ticket:ticketId,p_step:'estimates'});
    return {complete:valid&&result!.held===0&&pending===false,evidence:{...(valid?{status:'original_estimates_checked',settled:result!.settled,held:result!.held}:{status:'estimate_result_unverified'}),pending:pending!==false}};
   }},
   {name:'voice_receipts',timeoutMs:20000,run:async(database,signal)=>{
    const result=await settlePendingVoiceUsage(database,accountId,readVoiceUsagePolicies(process.env.VOICE_USAGE_POLICIES_JSON,process.env.VOICE_USAGE_POLICY_ACTIVATIONS_JSON),reconcileLiveConversation,signal);
    const valid=!!result&&[result.settled,result.held,result.reviewRequired].every(n=>Number.isSafeInteger(n)&&n>=0);
    // Zero due reads can mean a cooldown, missing conversation or unavailable
    // policy. Only original terminal state proves this step has no work left.
    const pending=await database<boolean|null>('rpc/icash_account_followup_pending','POST',{p_account:accountId,p_ticket:ticketId,p_step:'voice_receipts'});
    return {complete:valid&&result.reviewRequired===0&&result.held===0&&pending===false,evidence:{...(valid?{settled:result.settled,held:result.held,reviewRequired:result.reviewRequired}:{status:'voice_result_unverified'}),pending:pending!==false}};
   }},
   ...(context.notify?[{name:'customer_updates' as const,timeoutMs:10000,run:async(database:VoiceUsageDb,signal:AbortSignal)=>{
    const result=await dispatchCustomerUpdate(accountId,{db:database,signal});
    return {complete:!['updates_needs_review','updates_held'].includes(result.status),evidence:{status:result.status}};
   }}]:[]),
   ...(context.notify&&process.env.ICASH_ATTENTION_EMAIL_ENABLED==='true'?[{name:'attention' as const,timeoutMs:10000,run:async(database:VoiceUsageDb,signal:AbortSignal)=>{
    const result=await dispatchAttentionNotification(accountId,{db:database,signal});
    return {complete:!['attention_needs_review','attention_held'].includes(result.status),evidence:{status:result.status}};
   }}]:[]),
  ]);
  const finished=await database<boolean>('rpc/icash_finish_account_followup','POST',
   {p_account:accountId,p_ticket:ticketId,p_success:success},AbortSignal.timeout(5000));
  if(!finished)throw Error('RECONCILIATION_LEASE_CHANGED');
  return {status:success?'account_reconciled':'reconciliation_retry_due',billing:outcomes.voice_receipts??{status:'pending'},steps:outcomes};
 }
 let success=true;
 let billing:{settled:number;held:number;reviewRequired:number}|{status:string}={status:'pending'};
 try{await db('rpc/icash_settle_pending_estimates','POST',{p_account:accountId,p_limit:25});}
 catch{success=false;}
 try{
  billing=await settlePendingVoiceUsage(db,accountId,readVoiceUsagePolicies(process.env.VOICE_USAGE_POLICIES_JSON,process.env.VOICE_USAGE_POLICY_ACTIVATIONS_JSON),reconcileLiveConversation,deadline);
  if(billing.reviewRequired>0)success=false;
 }catch{success=false;billing={status:'review_required'};}
 if(context.notify){
  try{deadline.throwIfAborted();const result=await dispatchCustomerUpdate(accountId,{db,signal:deadline});if(result.status==='updates_needs_review')success=false;}catch{success=false;}
  if(process.env.ICASH_ATTENTION_EMAIL_ENABLED==='true'){
   try{deadline.throwIfAborted();const result=await dispatchAttentionNotification(accountId,{db,signal:deadline});if(result.status==='attention_needs_review')success=false;}catch{success=false;}
  }
 }
 // The durable acknowledgment has its own bounded deadline, even after a
 // provider read fails. A stale worker cannot finish a replacement generation.
 const finished=await database<boolean>('rpc/icash_finish_account_followup','POST',
  {p_account:accountId,p_ticket:ticketId,p_success:success},AbortSignal.timeout(5000));
 if(!finished)throw Error('RECONCILIATION_LEASE_CHANGED');
 return {status:success?'account_reconciled':'reconciliation_retry_due',billing};
}

