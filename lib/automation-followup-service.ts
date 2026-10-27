import {dispatchCustomerUpdate} from './customer-updates-service';
import {dispatchAttentionNotification} from './attention-notifications-service';
import {readVoiceUsagePolicies,settlePendingVoiceUsage,type VoiceUsageDb} from './voice-usage-service';
import {reconcileLiveConversation} from './live-conversation-service';

/** The primary finish transaction already persisted this account's follow-up.
 * A fresh one-use ticket only recovers original receipts and existing notices.
 * A missing receipt keeps its money hold; it never authorizes primary replay.
 */
export async function processAutomationFollowup(database:VoiceUsageDb,accountId:string,ticketId:string){
 const deadline=AbortSignal.timeout(45000);
 const db:VoiceUsageDb=(path,method,body)=>{deadline.throwIfAborted();return database(path,method,body,deadline);};
 const context=await db<{notify:boolean}|null>('rpc/icash_account_followup_context','POST',{p_account:accountId,p_ticket:ticketId});
 if(!context)throw Error('RECONCILIATION_LEASE_CHANGED');
 let success=true;
 let billing:{settled:number;held:number;reviewRequired:number}|{status:string}={status:'pending'};
 try{await db('rpc/icash_settle_pending_estimates','POST',{p_account:accountId,p_limit:25});}
 catch{success=false;}
 try{
  billing=await settlePendingVoiceUsage(db,accountId,readVoiceUsagePolicies(process.env.VOICE_USAGE_POLICIES_JSON,process.env.VOICE_USAGE_POLICY_ACTIVATIONS_JSON),reconcileLiveConversation,deadline);
  if(billing.reviewRequired>0)success=false;
 }catch{success=false;billing={status:'review_required'};}
 if(context.notify){
  try{deadline.throwIfAborted();await dispatchCustomerUpdate(accountId,{db,signal:deadline});}catch{success=false;}
  if(process.env.ICASH_ATTENTION_EMAIL_ENABLED==='true'){
   try{deadline.throwIfAborted();await dispatchAttentionNotification(accountId,{db,signal:deadline});}catch{success=false;}
  }
 }
 // The durable acknowledgment has its own bounded deadline, even after a
 // provider read fails. A stale worker cannot finish a replacement generation.
 const finished=await database<boolean>('rpc/icash_finish_account_followup','POST',
  {p_account:accountId,p_ticket:ticketId,p_success:success},AbortSignal.timeout(5000));
 if(!finished)throw Error('RECONCILIATION_LEASE_CHANGED');
 return {status:success?'account_reconciled':'reconciliation_retry_due',billing};
}

