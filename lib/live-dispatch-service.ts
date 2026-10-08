import {sellerOfferPresentation} from './seller-offer-presentation.ts';
import {VoiceActivationBudgetError} from './voice-budget-failure.ts';
import {limitedSellerPrompt} from './seller-limited-contact.ts';
import {selectedCustomCallVoice} from './custom-voice.ts';
import {runScreeningJob} from './screening-job.ts';
import {loadSellerClosingContext} from './seller-closing-context.ts';
import {recordingServer} from './required-call-recording-server.ts';
import {object,readRecordingReview,recordingAgentMatches,recordingPolicy} from './required-call-recording.ts';
import {createHash} from 'node:crypto';
import {sameBusinessNumber,consistentTextSenders} from './number-continuity.ts';
import {boundedVoiceSmsContext} from './voice-sms-context.ts';
import {db} from '@/lib/stripe-test';
import {elevenRequest} from '@/lib/elevenlabs';
import {buyerCallInstructions,buyerFirstMessage,type BuyerCallContext} from './buyer-call-policy.ts';
import {contactEligibility,callEligibility,nextContactWindow,type VoicePermission} from './live-dispatch-policy.ts';
import {sellerFirstMessage,sellerCallPrompt,type SellerRequestContext} from './seller-call-context.ts';
type Job={id:string;account_id:string;permission_id:string|null;operational_contact_id?:string|null;callback_id:string|null;state:string};
type Config={approved_voice_ids:string[];enabled:boolean;agent_id:string;phone_number_id:string;agent_config_hash:string;reviewed_until:string;seller_rate_id:string;buyer_rate_id:string|null;max_duration_seconds:number;required_tool_ids:string[]};
type Permission=VoicePermission&{id:string;account_id:string;screening_id:string;party:'seller'|'buyer';contact_key:string;seller_intake_id?:string|null};
export async function dispatchLiveVoice(accountId:string,jobId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready'};
 const [j]=await db<Job[]>(`icash_voice_jobs?id=eq.${jobId}&account_id=eq.${accountId}&select=*`);if(!j||j.state!=='issued')return {status:'held'};
 let ownsDispatch=false;
 const hold=async(reason:string)=>{await db('rpc/icash_hold_voice_job','POST',{p_account:accountId,p_job:j.id,p_reason:reason,p_after_claim:ownsDispatch});return {status:reason};};
 // Every customer call uses consent-first recording. Capture OFF is a hold, never a legacy fallback.
 const reviewJson=process.env.RECORDED_OUTBOUND_REVIEW_JSON;
 const recordingReleaseHold=()=>{
  if(process.env.ICASH_LIVE_WORK_READY!=='true')return 'live_work_not_ready';
  if(process.env.ICASH_RECORDED_OUTBOUND_READY!=='true')return 'recorded_call_release_required';
  const review=readRecordingReview(process.env.RECORDED_OUTBOUND_REVIEW_JSON);
  if(process.env.ICASH_RECORDING_RECEIPTS_READY!=='true'||!review||process.env.RECORDED_OUTBOUND_REVIEW_JSON!==reviewJson||review.providerAccountSid!==process.env.TWILIO_ACCOUNT_SID||!process.env.TWILIO_AUTH_TOKEN)return 'recorded_call_review_required';
  return null;
 };
 const releaseHold=recordingReleaseHold();if(releaseHold)return hold(releaseHold);
 const recordedReview=readRecordingReview(reviewJson)!;
 const [c]=await db<Config[]>(`icash_voice_configs?account_id=eq.${accountId}&select=*`);
 // Operational targets contain routing/DNC evidence only, never a fabricated consent record.
 if((j.permission_id==null)===(j.operational_contact_id==null))return hold('contact_binding_invalid');
 const [p]=await db<Permission[]>(`${j.operational_contact_id?'icash_voice_contact_targets':'icash_contact_permissions'}?id=eq.${j.operational_contact_id??j.permission_id}&account_id=eq.${accountId}&select=*`);
 if(j.operational_contact_id&&await db<boolean>('rpc/icash_operational_contact_current','POST',{p_account:accountId,p_contact:j.operational_contact_id,p_channel:'voice',p_check_hour:false})!==true)return hold('contact_operating_checks_required');
 const [snapshot]=p?await db<{snapshot:unknown}[]>(`icash_screening_jobs?id=eq.${p.screening_id}&account_id=eq.${accountId}&state=eq.complete&select=snapshot`):[];
 if(!c?.enabled||!(Date.parse(c.reviewed_until)>Date.now())||!p||!snapshot||!process.env.ELEVENLABS_API_KEY)return hold('voice_configuration_required');
 // Recorded dispatch binds the account config to the complete reviewed projection,
 // not the legacy main-branch conversation-only hash or its two-tool subset.
 if(c.agent_id!==recordedReview.agentId||c.agent_config_hash!==recordedReview.configHash||c.max_duration_seconds!==recordedReview.maxTotalSeconds||!Array.isArray(c.required_tool_ids)||c.required_tool_ids.length!==recordedReview.toolIds.length||!recordedReview.toolIds.every(id=>c.required_tool_ids.includes(id)))return hold('recorded_call_review_required');
 if(createHash('sha256').update(p.phone).digest('hex')!==p.contact_key)return hold('contact_binding_invalid');
 const suppressed=await db<{phone:string}[]>(`icash_text_suppressions?phone=eq.${encodeURIComponent(p.phone)}&select=phone&limit=1`);if(suppressed.length)return hold('contact_opted_out');
 // This flag is derived exclusively from a fresh server-side database check.
 p.sellerConsentVerified=p.seller_intake_id?await db<boolean>('rpc/icash_seller_voice_permission_current','POST',{p_account:accountId,p_permission:p.id})===true:false;
 const contact=contactEligibility(p);
 if(!contact.ready){
  const dueAt=contact.reason==='outside_contact_hours'&&!j.callback_id?nextContactWindow(p):null;
  if(dueAt){
   await db(`icash_voice_jobs?id=eq.${j.id}&account_id=eq.${accountId}&state=eq.issued`,'PATCH',{state:'ready',due_at:dueAt,outcome:'Waiting for calling hours'});
   return {status:contact.reason,dueAt};
  }
  return hold(contact.reason);
 }
 const eligible=p.party==='seller'?callEligibility(p,snapshot.snapshot):null;
 const limited=p.party==='seller'&&eligible&&!eligible.ready&&eligible.reason==='financial_hold'&&p.sellerConsentVerified&&await db<boolean>('rpc/icash_seller_limited_contact','POST',{p_account:accountId,p_screening:p.screening_id})===true;
 if(eligible&&!eligible.ready&&!limited)return hold(eligible.reason);
 const limitedScreen=limited?runScreeningJob(snapshot.snapshot):null;
 const buyerContext=p.party==='buyer'?await db<BuyerCallContext|null>('rpc/icash_buyer_voice_context','POST',{p_permission:p.id}):null;
 if(p.party==='buyer'&&!buyerContext)return hold('buyer_marketing_release_required');
 const address=limitedScreen?.property.address||buyerContext?.address||(eligible?.ready?eligible.screening.property.address:'');
 const [identity]=await db<{principal:string;voice_id:string;company_name?:string}[]>(`icash_customer_identities?account_id=eq.${accountId}&select=principal,voice_id,company_name`);
 const [account]=await db<{assistant_name:string;bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=assistant_name,bot_paused`);
 if(!identity?.principal||!account||account.bot_paused)return hold('identity_or_start_required');
 // Verify the actual provider caller ID before reserving credits or placing a call.
 const businessNumber=process.env.CONTIGUITY_FROM;
 const threads=await db<{sender:string}[]>(`icash_text_threads?account_id=eq.${accountId}&recipient=eq.${encodeURIComponent(p.phone)}&select=sender`);
 if(!consistentTextSenders(businessNumber,threads))return hold('business_number_mismatch');
 let phone:{phone_number:string};
 try{phone=await elevenRequest<{phone_number:string}>(`/v1/convai/phone-numbers/${encodeURIComponent(c.phone_number_id)}`);}catch{return hold('business_number_verification_required');}
 if(!sameBusinessNumber(businessNumber,phone.phone_number))return hold('business_number_mismatch');
 let agent:unknown;
 try{agent=await elevenRequest<unknown>(`/v1/convai/agents/${encodeURIComponent(recordedReview.agentId)}?branch_id=${encodeURIComponent(recordedReview.branchId)}`);}catch{return hold('production_agent_review_required');}
 // Share the recording service's exact non-main branch/version, privacy,
 // override, tool-set and canonical full-projection validation before reserve.
 if(!recordingAgentMatches(recordedReview,agent))return hold('production_agent_review_required');
 const customVoice=await selectedCustomCallVoice(accountId);
 const callVoiceId=customVoice??identity.voice_id;
 const voiceOverride=object(object(object(agent).conversation_config).tts).voice_id!==callVoiceId;
 if(voiceOverride&&!customVoice&&!c.approved_voice_ids?.includes(callVoiceId))return hold('voice_selection_setup_required');
 const [practice]=await db<{agent_id:string}[]>(`icash_voice_test_config?agent_id=eq.${c.agent_id}&select=agent_id`);if(practice)return hold('practice_agent_blocked');
 const rateId=p.party==='buyer'?c.buyer_rate_id:c.seller_rate_id;if(!rateId)return hold('full_call_cost_quote_required');
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;voice_max_duration_seconds:number|null;charge_cents?:number;version?:string}[]>(`icash_operation_rates?id=eq.${rateId}&select=operation,enabled,expires_at,voice_max_duration_seconds,charge_cents,version`);
 if(!rate?.enabled||rate.operation!==(p.party==='buyer'?'buyer_call':'seller_call')||!(Date.parse(rate.expires_at)>Date.now())||!rate.voice_max_duration_seconds||rate.voice_max_duration_seconds<c.max_duration_seconds)return hold('full_call_cost_quote_required');
 if(!sameBusinessNumber(businessNumber,recordedReview.fromPhone)||rate.charge_cents!==recordingPolicy.minimumHoldCents||!rate.version?.startsWith(recordingPolicy.version+':'))return hold('recorded_call_review_required');
 // The displayed formula result is the actual seller offer, under standing operator policy.
 const cashOfferPrice=eligible?.ready?eligible.screening.cashOfferPriceCents:null;
 const ceiling=cashOfferPrice;
 const smsContext=p.party==='seller'?boundedVoiceSmsContext(await db<unknown>('rpc/icash_voice_sms_context','POST',{p_account:accountId,p_permission:p.id})):null;
 const priorCalls=p.party==='seller'?await db<unknown>(`icash_live_conversations?account_id=eq.${accountId}&screening_id=eq.${p.screening_id}&contact_key=eq.${p.contact_key}&party=eq.seller&state=eq.complete&operation_key=like.voice:*&completed_at=gte.${encodeURIComponent(new Date(Date.now()-30*86400000).toISOString())}&order=completed_at.desc&limit=3&select=completed_at,result`):[];
 const buyerKind=identity.company_name?.trim()?'company' as const:'individual' as const;
 const request=p.party==='seller'&&object(snapshot.snapshot).sellerRequest?await db<SellerRequestContext|null>('rpc/icash_seller_call_request','POST',{p_account:accountId,p_screening:p.screening_id,p_phone:p.phone}):null;
 const closing=!limited&&p.party==='seller'&&recordedReview.contractToolId?await loadSellerClosingContext(db,accountId,p.screening_id,p.phone,ceiling):null;
 const sellerContext={buyerKind,priorCalls,address,principal:identity.principal,assistantName:account.assistant_name,history:smsContext,request:request??undefined};
 // Validate the complete opening/context before reserving credits or dialing.
 let sellerGreeting:string|undefined,sellerPrompt:string|undefined;
 if(p.party==='seller'){try{sellerGreeting=sellerFirstMessage(sellerContext,true);sellerPrompt=limited?limitedSellerPrompt(address,identity.principal,account.assistant_name):sellerCallPrompt(sellerContext,ceiling,closing,!!recordedReview.contractToolId,cashOfferPrice,sellerOfferPresentation(snapshot.snapshot,address));}catch{return hold('property_context_required');}}
 const operationKey=`voice:${j.id}`;
 const reserveHold=recordingReleaseHold();if(reserveHold)return hold(reserveHold);
 const reservationInput={p_account:accountId,p_job:j.id,p_rate:rateId,p_permission_until:p.permission_until,p_financial_checked_at:eligible?.ready?new Date(eligible.screening.financialCheck.checkedAt).toISOString():null,p_financial_eligible:eligible?.ready&&eligible.screening.financialCheck.status==='eligible'};
 // Activate only after the matching database migration is installed. Never retry an ambiguous reservation through another path.
 let fundedCall:{maxSeconds:number}|null;
 try{
 fundedCall=process.env.ICASH_FLEXIBLE_VOICE_READY==='true'
  ?await db<{maxSeconds:number}|null>('rpc/icash_reserve_flexible_voice','POST',reservationInput)
  :await db<boolean>('rpc/icash_reserve_paced_voice','POST',reservationInput)?{maxSeconds:600}:null;
 }catch(error){
  if(!(error instanceof VoiceActivationBudgetError))throw error;
  // No automatic retry: this is a configured spending boundary, not provider uncertainty.
  // The database refuses this transition if ANY reservation or provider attempt exists.
  const held=await db<boolean>('rpc/icash_hold_voice_activation_budget','POST',{p_account:accountId,p_job:j.id});
  if(!held)throw error;
  return {status:'activation_budget_held'};
 }
 if(!fundedCall)return {status:process.env.ICASH_FLEXIBLE_VOICE_READY==='true'?'waiting_for_available_credits':'waiting_for_daytime_budget'};
 const claimHold=recordingReleaseHold();if(claimHold)return hold(claimHold);
 const claimed=p.party==='seller'
  ?limited?await db<boolean>('rpc/icash_claim_limited_seller_voice','POST',{p_job:j.id,p_snapshot:snapshot.snapshot}):await db<boolean>('rpc/icash_claim_automatic_offer_voice_job','POST',{p_job:j.id,p_snapshot:snapshot.snapshot,p_offer_price_cents:cashOfferPrice})
  :await db<boolean>('rpc/icash_claim_reviewed_voice_job','POST',{p_job:j.id,p_offer_snapshot:null,p_buyer_snapshot:buyerContext});
 if(!claimed)return hold('dispatch_permission_changed');
 ownsDispatch=true;
 const strategy=parseInt(createHash('sha256').update(`${accountId}:${p.contact_key}`).digest('hex').slice(0,8),16)%2===0?'cash_interest':'flexible_timing';
 try{
 await db(`icash_voice_jobs?id=eq.${j.id}&account_id=eq.${accountId}&state=eq.dispatching`,'PATCH',{sms_context:smsContext});
 const dispatchHold=recordingReleaseHold();if(dispatchHold)return hold(dispatchHold);
 const result=await recordingServer().dispatch({accountId,operationKey,maxTotalSeconds:fundedCall.maxSeconds,...(p.party==='seller'?{buyerKind}:{}),principal:identity.principal,assistantName:account.assistant_name,voiceId:callVoiceId,firstMessage:sellerGreeting??buyerFirstMessage(buyerContext!),prompt:buyerContext?buyerCallInstructions(buyerContext,identity.principal,account.assistant_name):sellerPrompt!,strategyKey:strategy});
 // A started call is connecting; only the recording service can confirm capture.
 if(result.status==='recording_consent_pending')return {status:'call_started'};
 if(result.status==='recording_dial_unknown_no_retry')return {status:'provider_outcome_unknown_no_retry'}; // Keep the durable claim recoverable; never redial.
 return hold(result.status);
 }catch{return hold('provider_outcome_unknown_no_retry');}
}
