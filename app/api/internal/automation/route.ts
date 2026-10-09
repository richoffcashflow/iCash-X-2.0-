import {dispatchCustomerUpdate} from '@/lib/customer-updates-service';
import {automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation} from '@/lib/live-work-admission';
import {dispatchAttentionNotification} from '@/lib/attention-notifications-service';
import {readVoiceUsagePolicies,settlePendingVoiceUsage} from '@/lib/voice-usage-service';
import {dispatchTextMessage} from '@/lib/text-message-service';
import {expandMarket} from '@/lib/market-expansion-service';
import {processTextAi} from '@/lib/text-ai-service';
import {dispatchTitleFollowup} from '@/lib/title-followup-service';
import {prepareFulfillment} from '@/lib/fulfillment-service';
import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {discoverForAccount} from '@/lib/discovery-service';
import {refreshSigning} from '@/lib/signing-service';
import {reconcileLiveConversation} from '@/lib/live-conversation-service';
import {dispatchLiveVoice} from '@/lib/live-dispatch-service';
import {enrichForAccount} from '@/lib/owner-enrichment-service';
export const dynamic='force-dynamic';
export const maxDuration=60;
/** Short-lived, one-use DB capabilities; no credentials or account IDs accepted from requests. */
export async function POST(request:Request){
 const billingDeadline=AbortSignal.timeout(45000);
 const headers={'Cache-Control':'private, no-store'};
 const token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$/.test(token))return NextResponse.json({error:'Unauthorized'},{status:401,headers});
 let ticket:{id:string;accountId:string;kind:string;screeningId:string|null;liveCallId:string|null;signingId:string|null;voiceJobId:string|null;fulfillmentJobId:string|null;titleTaskId:string|null;textAiJobId:string|null;marketResearchJobId:string|null;openerMessageId:string|null}|null=null;
 try{
  ticket=await db('rpc/icash_consume_automation','POST',{p_token:token});
  if(!ticket)return NextResponse.json({error:'Expired or consumed'},{status:401,headers});
  const result=!automationWorkReady(ticket.kind)&&newLiveWorkKinds.has(ticket.kind)?await deferUnstartedAutomation(db,ticket,token):ticket.kind==='customer_updates'?await dispatchCustomerUpdate(ticket.accountId,{db,signal:billingDeadline}):ticket.kind==='customer_attention'?await dispatchAttentionNotification(ticket.accountId,{db,signal:billingDeadline}):['seller_opener','seller_recovery'].includes(ticket.kind)&&ticket.openerMessageId?await dispatchTextMessage(ticket.accountId,ticket.openerMessageId):ticket.kind==='market_research'&&ticket.marketResearchJobId?await expandMarket(ticket.accountId,ticket.marketResearchJobId):ticket.kind==='text_ai'&&ticket.textAiJobId?await processTextAi(ticket.accountId,ticket.textAiJobId):ticket.kind==='title_followup'&&ticket.titleTaskId?await dispatchTitleFollowup(ticket.accountId,ticket.titleTaskId):ticket.kind==='fulfillment'&&ticket.fulfillmentJobId?await prepareFulfillment(ticket.accountId,ticket.fulfillmentJobId):ticket.kind==='voice_dispatch'&&ticket.voiceJobId?await dispatchLiveVoice(ticket.accountId,ticket.voiceJobId):ticket.kind==='signing_result'&&ticket.signingId?await refreshSigning(ticket.accountId,ticket.signingId):ticket.kind==='voice_result'&&ticket.liveCallId?await reconcileLiveConversation(ticket.accountId,ticket.liveCallId):ticket.kind==='discovery'?await discoverForAccount(ticket.accountId):ticket.kind==='contacts'&&ticket.screeningId?await enrichForAccount(ticket.accountId,ticket.screeningId):{status:'held'};
  const success=['supply_target_met','updates_disabled','updates_idle','updates_held','updates_accepted','attention_disabled','attention_idle','attention_held','attention_accepted','market_research_saved','waiting_for_daytime_budget','waiting_for_available_credits','text_ai_drafted','text_ai_handoff','message_accepted','title_followup_sent','fulfillment_prepared','call_started','outside_contact_hours','screening_queued','empty','contacts_saved','conversation_saved','awaiting_conversation','awaiting_counterparty','customer_signature_needed','completed','test_completed'].includes(result.status);
  await db('rpc/icash_finish_automation','POST',{p_id:ticket.id,p_success:success,p_outcome:result.status});
  try{await db('rpc/icash_settle_pending_estimates','POST',{p_account:ticket.accountId,p_limit:25});}catch{/* Scheduled reconciliation retries without changing a completed job. */}
  let billing;
  try{billing=await settlePendingVoiceUsage(db,ticket.accountId,readVoiceUsagePolicies(process.env.VOICE_USAGE_POLICIES_JSON,process.env.VOICE_USAGE_POLICY_ACTIVATIONS_JSON),reconcileLiveConversation,billingDeadline);}
  catch{billing={status:'review_required'};} // Billing failure never rewrites a successful primary action.
  // Optional alerts get only the remaining deadline and cannot change primary work.
  if(ticket.kind!=='customer_updates'&&!billingDeadline.aborted){
   try{await dispatchCustomerUpdate(ticket.accountId,{db,signal:billingDeadline});}catch{/* Optional updates never change completed work or repeat a provider attempt. */}
  }
  if(ticket.kind!=='customer_attention'&&process.env.ICASH_ATTENTION_EMAIL_ENABLED==='true'&&!billingDeadline.aborted){
   try{await dispatchAttentionNotification(ticket.accountId,{db,signal:billingDeadline});}catch{/* Durable claims remain held for review; never repeat the primary action. */}
  }
  return NextResponse.json({status:result.status,billing},{headers});
 }catch{
  if(ticket)try{await db('rpc/icash_finish_automation','POST',{p_id:ticket.id,p_success:false,p_outcome:'held_for_reconciliation'});}catch{/* Preserve consumed capability on database failure. */}
  return NextResponse.json({status:'held_for_reconciliation'},{status:503,headers});
 }
}
