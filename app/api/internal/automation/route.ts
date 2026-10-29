import {processAutomationFollowup} from '@/lib/automation-followup-service';
import {ProspectingBudgetError} from '@/lib/voice-budget-failure';
import {OwnerPreviewRateLimitError} from '@/lib/owner-enrichment-deferral';
import {dispatchCustomerUpdate} from '@/lib/customer-updates-service';
import {automationWorkReady,newLiveWorkKinds,deferUnstartedAutomation} from '@/lib/live-work-admission';
import {dispatchAttentionNotification} from '@/lib/attention-notifications-service';
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
// DealMachine's synchronous export permits 120 seconds, plus bounded original
// receipt/download and independent persistence deadlines.
export const maxDuration=240;
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
  if(ticket.kind==='account_reconcile')return NextResponse.json(await processAutomationFollowup(db,ticket.accountId,ticket.id),{headers});
  const result=!automationWorkReady(ticket.kind)&&newLiveWorkKinds.has(ticket.kind)?await deferUnstartedAutomation(db,ticket,token):ticket.kind==='customer_updates'?await dispatchCustomerUpdate(ticket.accountId,{db,signal:billingDeadline}):ticket.kind==='customer_attention'?await dispatchAttentionNotification(ticket.accountId,{db,signal:billingDeadline}):['seller_opener','seller_recovery'].includes(ticket.kind)&&ticket.openerMessageId?await dispatchTextMessage(ticket.accountId,ticket.openerMessageId):ticket.kind==='market_research'&&ticket.marketResearchJobId?await expandMarket(ticket.accountId,ticket.marketResearchJobId):ticket.kind==='text_ai'&&ticket.textAiJobId?await processTextAi(ticket.accountId,ticket.textAiJobId):ticket.kind==='title_followup'&&ticket.titleTaskId?await dispatchTitleFollowup(ticket.accountId,ticket.titleTaskId):ticket.kind==='fulfillment'&&ticket.fulfillmentJobId?await prepareFulfillment(ticket.accountId,ticket.fulfillmentJobId):ticket.kind==='voice_dispatch'&&ticket.voiceJobId?await dispatchLiveVoice(ticket.accountId,ticket.voiceJobId):ticket.kind==='signing_result'&&ticket.signingId?await refreshSigning(ticket.accountId,ticket.signingId):ticket.kind==='voice_result'&&ticket.liveCallId?await reconcileLiveConversation(ticket.accountId,ticket.liveCallId):ticket.kind==='discovery'?await discoverForAccount(ticket.accountId):ticket.kind==='contacts'&&ticket.screeningId?await enrichForAccount(ticket.accountId,ticket.screeningId):{status:'held'};
  const success=['no_new_properties','inventory_advancing','inventory_market_changed','inventory_waiting','seller_inventory_unavailable','supply_target_met','updates_disabled','updates_idle','updates_held','updates_accepted','attention_disabled','attention_idle','attention_held','attention_accepted','market_research_saved','waiting_for_daytime_budget','waiting_for_available_credits','waiting_for_active_call','text_ai_drafted','text_ai_handoff','message_accepted','title_followup_sent','fulfillment_prepared','call_started','outside_contact_hours','screening_queued','empty','contacts_saved','conversation_saved','awaiting_conversation','awaiting_counterparty','customer_signature_needed','completed','test_completed'].includes(result.status);
  if(ticket.kind==='contacts')await db('rpc/icash_finish_owner_enrichment','POST',{p_id:ticket.id,p_account:ticket.accountId,p_screening:ticket.screeningId,p_token:token,p_success:success,p_outcome:result.status});
  else await db('rpc/icash_finish_automation','POST',{p_id:ticket.id,p_success:success,p_outcome:result.status});
  // Finishing primary work atomically queues account reconciliation in SQL.
  // Return the worker slot immediately; original receipts and notifications
  // have independent durable claims and cannot replay this operation.
  return NextResponse.json({status:result.status,billing:{status:'queued'}},{headers});
 }catch(error){
  if(ticket?.kind==='contacts'&&ticket.screeningId&&error instanceof OwnerPreviewRateLimitError
   &&error.accountId===ticket.accountId&&error.screeningId===ticket.screeningId
   &&error.operationKey===`owners:${ticket.accountId}:${ticket.screeningId}`){
   // The RPC checks the exact consumed capability and absence of all paid-work
   // evidence under lock. It schedules a new capability, never reuses this token.
   try{if(await db<boolean>('rpc/icash_defer_owner_enrichment','POST',{p_id:ticket.id,p_account:ticket.accountId,p_screening:ticket.screeningId,p_token:token,p_operation:error.operationKey})===true)return NextResponse.json({status:'owner_preview_rate_limited'},{headers});}catch{/* An uncertain database outcome is never treated as a retry grant. */}
   // A lost deferral response may already have led to a fresh issued/consumed
   // capability. Never let this stale worker finish that newer attempt by ID.
   try{await db('rpc/icash_finish_owner_enrichment','POST',{p_id:ticket.id,p_account:ticket.accountId,p_screening:ticket.screeningId,p_token:token,p_success:false,p_outcome:'held_for_reconciliation'});}catch{/* Preserve the original capability on an uncertain completion; never repeat it. */}
   return NextResponse.json({status:'held_for_reconciliation'},{status:503,headers});
  }
  if(ticket&&error instanceof ProspectingBudgetError){
   try{if(await db<boolean>('rpc/icash_hold_prospecting_ticket','POST',{p_id:ticket.id,p_account:ticket.accountId,p_quote:error.quoteCents}))return NextResponse.json({status:'prospecting_budget_held'},{headers});}catch{/* Unknown outcomes retain reconciliation. */}
  }
  // Fixed codes only: never log provider bodies, account details or capabilities.
  const reason=error instanceof Error&&['Database request failed','DISCOVERY_RATE_LIMIT','DISCOVERY_CONFIGURATION_INVALID','DISCOVERY_FILTER_INVALID','DISCOVERY_ESTIMATE_INVALID','DISCOVERY_RATE_TOO_LOW','DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY','DISCOVERY_RESPONSE_REQUIRES_RECONCILIATION','DISCOVERY_DELIVERY_REQUIRES_RECONCILIATION'].includes(error.message)?error.message:'unclassified';
  const provider=error as {stage?:unknown;httpStatus?:unknown}|null;
  console.error('automation_held',{kind:ticket?.kind??'unclaimed',reason,...(reason==='DISCOVERY_PROVIDER_REQUEST_FAILED_NO_RETRY'?{stage:provider?.stage==='estimate'?'estimate':provider?.stage==='paid'?'paid':'unknown',httpStatus:typeof provider?.httpStatus==='number'&&Number.isInteger(provider.httpStatus)&&provider.httpStatus>=100&&provider.httpStatus<=599?provider.httpStatus:null}:{})});
  if(ticket)try{
   if(ticket.kind==='contacts')await db('rpc/icash_finish_owner_enrichment','POST',{p_id:ticket.id,p_account:ticket.accountId,p_screening:ticket.screeningId,p_token:token,p_success:false,p_outcome:'held_for_reconciliation'});
   else await db('rpc/icash_finish_automation','POST',{p_id:ticket.id,p_success:false,p_outcome:'held_for_reconciliation'});
  }catch{/* Preserve consumed capability on database failure. */}
  return NextResponse.json({status:'held_for_reconciliation'},{status:503,headers});
 }
}
