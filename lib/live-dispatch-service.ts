import {instantLeadPrompt} from './meta-instant-leads.ts';
import {opportunityConversationInstructions} from './outreach-conversation.ts';
import {instantLeadsEnabled} from './meta-instant-lead-service.ts';
import {cancellationCallPrompt,type CancellationCallContext} from './cancellation-notice-policy.ts';
import {conversationAddressFields,conversationAddressInstructions} from './conversation-address.ts';
import {automaticOfferPolicy} from './automatic-offer-policy.ts';
import {sellerContractToolId} from './seller-contract-tool.ts';
import {automaticOfferReceptionPrompt,payoffAutomaticOfferReceptionPrompt,legacyAutomaticOfferReceptionPrompt,streamingAutomaticOfferReceptionPrompt,progressAutomaticOfferReceptionPrompt} from './seller-agreement-reception.ts';
import {sellerAgreementDeliveryPrompt} from './seller-agreement-delivery-prompt.ts';
import {sellerOfferPresentation} from './seller-offer-presentation.ts';
import {VoiceActivationBudgetError} from './voice-budget-failure.ts';
import {limitedSellerPrompt} from './seller-limited-contact.ts';
import {selectedCustomCallVoice} from './custom-voice.ts';
import {runScreeningJob} from './screening-job.ts';
import {loadSellerClosingContext} from './seller-closing-context.ts';
import {recordingServer} from './required-call-recording-server.ts';
import {object,readRecordingReview,recordingAgentMatches,recordingPolicy} from './required-call-recording.ts';
import {createHash} from 'node:crypto';
import {assignSharedLearning} from './shared-learning.ts';
import {acquisitionOpeners} from './deal-conversation.ts';
import {sameBusinessNumber,consistentTextSenders} from './number-continuity.ts';
import {selectBusinessCaller,secondaryCallingReady} from './business-voice-numbers.ts';
import {isAdditionalBusinessPhone} from './business-phone-policy.ts';
import {boundedVoiceSmsContext} from './voice-sms-context.ts';
import {db} from '@/lib/stripe-test';
import {dispatchTextMessage} from './text-message-service';
import {elevenRequest} from '@/lib/elevenlabs';
import {buyerCallInstructions,buyerFirstMessage,type BuyerCallContext} from './buyer-call-policy.ts';
import {contactEligibility,callEligibility,nextContactWindow,type VoicePermission} from './live-dispatch-policy.ts';
import {readVoiceOutreachContext} from './outreach-hours.ts';
import {sellerFirstMessage,sellerCallPrompt,sellerCallContext,compactSellerProgress,type SellerRequestContext} from './seller-call-context.ts';
type Job={id:string;account_id:string;permission_id:string|null;operational_contact_id?:string|null;callback_id:string|null;sms_source_message_id?:string|null;cancellation_notice_id?:string|null;state:string};
type Config={approved_voice_ids:string[];enabled:boolean;agent_id:string;phone_number_id:string;agent_config_hash:string;reviewed_until:string;seller_rate_id:string;buyer_rate_id:string|null;max_duration_seconds:number;required_tool_ids:string[]};
type Permission=VoicePermission&{id:string;account_id:string;screening_id:string;party:'seller'|'buyer';contact_key:string;seller_intake_id?:string|null};
const outboundVoiceParties:ReadonlySet<string>=new Set(['seller']);
export async function dispatchLiveVoice(accountId:string,jobId:string){
 if(process.env.ICASH_LIVE_WORK_READY!=='true')return {status:'live_work_not_ready'};
 const [j]=await db<Job[]>(`icash_voice_jobs?id=eq.${jobId}&account_id=eq.${accountId}&select=*`);if(!j||j.state!=='issued')return {status:'held'};
 let ownsDispatch=false;
 const cancellation=j.cancellation_notice_id?await db<CancellationCallContext|null>('rpc/icash_cancellation_voice_context','POST',{p_account:accountId,p_job:j.id}):null;
 if(j.cancellation_notice_id&&!cancellation)return {status:'cancellation_notice_held'};
 const hold=async(reason:string)=>{await db('rpc/icash_hold_voice_job','POST',{p_account:accountId,p_job:j.id,p_reason:reason,p_after_claim:ownsDispatch});return {status:reason};};
 // Resolve the channel policy before provider reads, credit reservations or calls.
 if((j.permission_id==null)===(j.operational_contact_id==null))return hold('contact_binding_invalid');
 const [p]=await db<Permission[]>(`${j.operational_contact_id?'icash_voice_contact_targets':'icash_contact_permissions'}?id=eq.${j.operational_contact_id??j.permission_id}&account_id=eq.${accountId}&select=*`);
 if(p&&!outboundVoiceParties.has(p.party))return hold('buyer_outbound_calls_disabled');
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
 if(j.operational_contact_id&&await db<boolean>('rpc/icash_operational_contact_current','POST',{p_account:accountId,p_contact:j.operational_contact_id,p_channel:'voice',p_check_hour:false})!==true)return hold('contact_operating_checks_required');
 const intake=instantLeadsEnabled(process.env)&&p?.seller_intake_id?await db<{leadId:string;name:string|null;state:string;address:string|null}|null>('rpc/icash_meta_voice_context','POST',{p_account:accountId,p_job:j.id}):null;
 const [snapshot]=p?await db<{snapshot:unknown}[]>(`icash_screening_jobs?id=eq.${p.screening_id}&account_id=eq.${accountId}&state=${intake?'eq.awaiting_address':'eq.complete'}&select=snapshot`):[];
 if(!c?.enabled||!(Date.parse(c.reviewed_until)>Date.now())||!p||!snapshot||!process.env.ELEVENLABS_API_KEY)return hold('voice_configuration_required');
 // Recorded dispatch binds the account config to the complete reviewed projection,
 // not the legacy main-branch conversation-only hash or its two-tool subset.
 if(c.agent_id!==recordedReview.agentId||c.agent_config_hash!==recordedReview.configHash||c.max_duration_seconds!==recordedReview.maxTotalSeconds||!Array.isArray(c.required_tool_ids)||c.required_tool_ids.length!==recordedReview.toolIds.length||!recordedReview.toolIds.every(id=>c.required_tool_ids.includes(id)))return hold('recorded_call_review_required');
 if(createHash('sha256').update(p.phone).digest('hex')!==p.contact_key)return hold('contact_binding_invalid');
 const suppressed=await db<{phone:string}[]>(`icash_text_suppressions?phone=eq.${encodeURIComponent(p.phone)}&select=phone&limit=1`);if(suppressed.length)return hold('contact_opted_out');
 // This flag is derived exclusively from a fresh server-side database check.
 p.sellerConsentVerified=p.seller_intake_id?await db<boolean>('rpc/icash_seller_voice_permission_current','POST',{p_account:accountId,p_permission:p.id})===true:false;
 // First contact (including a new seller form) uses the current outreach
 // window. Only fresh database evidence of an active conversation or a
 // specifically requested callback establishes an exception, never a flag
 // loaded from a contact record. Final database admission rechecks it.
 const outreach=readVoiceOutreachContext(await db<unknown>('rpc/icash_voice_outreach_context','POST',{p_account:accountId,p_job:j.id}));
 if(!outreach)return hold('contact_hours_required');
 const contact=contactEligibility(p,Date.now(),outreach);
 if(!contact.ready){
  const dueAt=contact.reason==='outside_contact_hours'&&!j.callback_id&&!j.sms_source_message_id?nextContactWindow(p,Date.now(),outreach):null;
  if(dueAt){
   await db(`icash_voice_jobs?id=eq.${j.id}&account_id=eq.${accountId}&state=eq.issued`,'PATCH',{state:'ready',due_at:dueAt,outcome:'Waiting for calling hours'});
   return {status:contact.reason,dueAt};
  }
  return hold(contact.reason);
 }
 const eligible=p.party==='seller'&&!cancellation&&!intake?callEligibility(p,snapshot.snapshot,Date.now(),outreach):null;
 const limited=p.party==='seller'&&eligible&&!eligible.ready&&eligible.reason==='financial_hold'&&p.sellerConsentVerified&&await db<boolean>('rpc/icash_seller_limited_contact','POST',{p_account:accountId,p_screening:p.screening_id})===true;
 if(eligible&&!eligible.ready&&!limited)return hold(eligible.reason);
 const limitedScreen=limited?runScreeningJob(snapshot.snapshot):null;
 const buyerContext=p.party==='buyer'?await db<BuyerCallContext|null>('rpc/icash_buyer_voice_context','POST',{p_permission:p.id}):null;
 if(p.party==='buyer'&&!buyerContext)return hold('buyer_marketing_release_required');
 const address=cancellation?.address||limitedScreen?.property.address||buyerContext?.address||(eligible?.ready?eligible.screening.property.address:'');
 const [identity]=await db<{principal:string;voice_id:string;company_name?:string}[]>(`icash_customer_identities?account_id=eq.${accountId}&select=principal,voice_id,company_name`);
 const [account]=await db<{assistant_name:string;bot_paused:boolean}[]>(`icash_accounts?id=eq.${accountId}&select=assistant_name,bot_paused`);
 if(!identity?.principal||!account||account.bot_paused)return hold('identity_or_start_required');
 // Verify the actual provider caller ID before reserving credits or placing a call.
 const primaryNumber=process.env.CONTIGUITY_FROM;
 const threads=await db<{sender:string;sender_pool_assigned?:boolean}[]>('rpc/icash_property_voice_threads','POST',{p_account:accountId,p_screening:p.screening_id,p_phone:p.phone});
 let threadNumber:string;
 try{threadNumber=selectBusinessCaller(primaryNumber,threads);}catch{return hold('business_number_mismatch');}
 // Calls and texts share one recipient-specific allocation. The database keeps
 // established thread/call identities and balances only new conversations.
 const businessNumber=await db<string|null>('rpc/icash_property_call_sender','POST',{p_account:accountId,p_screening:p.screening_id,p_recipient:p.phone});
 if(!businessNumber||(threads.length&&businessNumber!==threadNumber)||(!isAdditionalBusinessPhone(businessNumber)&&businessNumber!==primaryNumber))return hold('business_number_mismatch');
 if(isAdditionalBusinessPhone(businessNumber)){
  const [secondary]=await db<{outbound_enabled:boolean}[]>(`icash_business_voice_numbers?phone=eq.${encodeURIComponent(businessNumber)}&select=outbound_enabled`);
  if(!secondary?.outbound_enabled)return hold('business_number_verification_required');
  try{if(!await secondaryCallingReady(db,process.env,fetch,businessNumber))return hold('business_number_verification_required');}catch{return hold('business_number_verification_required');}
 }
 if(!isAdditionalBusinessPhone(businessNumber)){
  if(!consistentTextSenders(businessNumber,threads.filter(t=>!t.sender_pool_assigned)))return hold('business_number_mismatch');
  let phone:{phone_number:string};
  try{phone=await elevenRequest<{phone_number:string}>(`/v1/convai/phone-numbers/${encodeURIComponent(c.phone_number_id)}`);}catch{return hold('business_number_verification_required');}
  if(!sameBusinessNumber(businessNumber,phone.phone_number))return hold('business_number_mismatch');
 }
 let agent:unknown;
 try{agent=await elevenRequest<unknown>(`/v1/convai/agents/${encodeURIComponent(recordedReview.agentId)}?branch_id=${encodeURIComponent(recordedReview.branchId)}`);}catch(error){
  // Distinguish a failed read from configuration drift without logging provider
  // payloads, credentials, contact data or caller-supplied error text.
  const code=error instanceof Error&&/^(?:VOICE_UNREACHABLE|VOICE_KEY_MISSING|VOICE_SERVER_ONLY|VOICE_HTTP_[1-5][0-9]{2}(?:_(?:CONVAI_WRITE|CONVAI_READ|VOICES_READ|TEXT_TO_SPEECH))?)$/.test(error.message)?error.message:'VOICE_AGENT_READ_FAILED';
  console.warn('production_agent_preflight_held',{stage:'provider_read',code});
  return hold('production_agent_review_required');
 }
 // Share the recording service's exact non-main branch/version, privacy,
 // override, tool-set and canonical full-projection validation before reserve.
 if(!recordingAgentMatches(recordedReview,agent)){
  console.warn('production_agent_preflight_held',{stage:'review_match',code:'VOICE_AGENT_CONFIGURATION_MISMATCH'});
  return hold('production_agent_review_required');
 }
 const customVoice=await selectedCustomCallVoice(accountId);
 const callVoiceId=customVoice??identity.voice_id;
 const voiceOverride=object(object(object(agent).conversation_config).tts).voice_id!==callVoiceId;
 if(voiceOverride&&!customVoice&&!c.approved_voice_ids?.includes(callVoiceId))return hold('voice_selection_setup_required');
 const [practice]=await db<{agent_id:string}[]>(`icash_voice_test_config?agent_id=eq.${c.agent_id}&select=agent_id`);if(practice)return hold('practice_agent_blocked');
 const rateId=p.party==='buyer'?c.buyer_rate_id:c.seller_rate_id;if(!rateId)return hold('full_call_cost_quote_required');
 const [rate]=await db<{operation:string;enabled:boolean;expires_at:string;voice_max_duration_seconds:number|null;charge_cents?:number;version?:string}[]>(`icash_operation_rates?id=eq.${rateId}&select=operation,enabled,expires_at,voice_max_duration_seconds,charge_cents,version`);
 if(!rate?.enabled||rate.operation!==(p.party==='buyer'?'buyer_call':'seller_call')||!(Date.parse(rate.expires_at)>Date.now())||!rate.voice_max_duration_seconds||rate.voice_max_duration_seconds<c.max_duration_seconds)return hold('full_call_cost_quote_required');
 if(!sameBusinessNumber(primaryNumber,recordedReview.fromPhone)||rate.charge_cents!==recordingPolicy.minimumHoldCents||!rate.version?.startsWith(recordingPolicy.version+':'))return hold('recorded_call_review_required');
 // The displayed formula result is the actual seller offer, under standing operator policy.
 const cashOfferPrice=eligible?.ready?eligible.screening.cashOfferPriceCents:null;
 const ceiling=cashOfferPrice;
 const smsContext=p.party==='seller'&&!cancellation?boundedVoiceSmsContext(await db<unknown>('rpc/icash_voice_sms_context','POST',{p_account:accountId,p_permission:p.id})):null;
 const priorCalls=p.party==='seller'&&!cancellation?await db<unknown>('rpc/icash_seller_prior_call_context','POST',{p_account:accountId,p_screening:p.screening_id,p_phone:p.phone}):[];
 const buyerKind=identity.company_name?.trim()?'company' as const:'individual' as const;
 const request=!cancellation&&p.party==='seller'&&object(snapshot.snapshot).sellerRequest?await db<SellerRequestContext|null>('rpc/icash_seller_call_request','POST',{p_account:accountId,p_screening:p.screening_id,p_phone:p.phone}):null;
 const closing=!intake&&!cancellation&&!limited&&p.party==='seller'&&recordedReview.contractToolId?await loadSellerClosingContext(db,accountId,p.screening_id,p.phone,ceiling):null;
 const agreementToolsEnabled=!intake&&!cancellation&&!!recordedReview.contractToolId&&recordedReview.contractToolId!==sellerContractToolId;
 const [purchaseDraft]=agreementToolsEnabled&&p.party==='seller'?await db<{terms:Record<string,unknown>}[]>(`icash_deal_files?account_id=eq.${accountId}&screening_id=eq.${p.screening_id}&stage=eq.draft&select=terms&limit=1`):[];
 const purchaseTerms=purchaseDraft?{inspectionDays:purchaseDraft.terms.inspectionDays??10,closingDate:purchaseDraft.terms.closingDate??'',escrowAgent:purchaseDraft.terms.escrowAgent??''}:null;
 const sellerContext={buyerKind,priorCalls,address,principal:identity.principal,assistantName:account.assistant_name,history:smsContext,request:request??undefined,callbackRequestedNow:!!j.sms_source_message_id};
 // Validate the complete opening/context before reserving credits or dialing.
 let sellerGreeting:string|undefined,sellerPrompt:string|undefined;
 if(intake){sellerGreeting=`Hi, this is ${account.assistant_name}, HomeOffer Network's AI assistant calling for ${identity.principal}. ${intake.address?"Thanks for sending the address. Let's check that property together.":"You requested a cash offer. What's the address of the property you'd like to sell?"}`;sellerPrompt=instantLeadPrompt(identity.principal,account.assistant_name)+(intake.address?' The address already submitted is '+JSON.stringify(intake.address)+'. Confirm it rather than asking from the beginning.':'');}
 else if(p.party==='seller'&&!cancellation){try{sellerGreeting=sellerFirstMessage(sellerContext,true);sellerPrompt=limited?limitedSellerPrompt(address,identity.principal,account.assistant_name):sellerCallPrompt(sellerContext,ceiling,closing,!!recordedReview.contractToolId,cashOfferPrice,sellerOfferPresentation(snapshot.snapshot,address),agreementToolsEnabled,purchaseTerms);}catch{return hold('property_context_required');}}
 const sellerProgress=intake?{history:null,priorCalls:[]}:sellerCallContext(sellerContext);
 const {history:fullSms,priorCalls:fullCalls,...sellerData}=sellerProgress;
 const automaticContext=intake||cancellation||!automaticOfferPolicy(recordedReview.offerPolicy)?null:buyerContext?{status:'buyer',address:buyerContext.address,returningName:buyerContext.firstName,buyerPaysClosingCosts:buyerContext.buyerPaysClosingCosts,repairsCents:buyerContext.repairsCents,packageUrl:buyerContext.packageUrl}:{...sellerData,...compactSellerProgress({history:fullSms,priorCalls:fullCalls},0),status:'matched',purchaseTerms,today:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(Date.now()),timeZone:'America/Chicago'};
 const basePrompt=()=>intake?sellerPrompt!:cancellation?cancellationCallPrompt(cancellation,identity.principal,account.assistant_name):(automaticOfferPolicy(recordedReview.offerPolicy)
  ?(recordedReview.offerPolicy==='automatic_offer_v5'?legacyAutomaticOfferReceptionPrompt:recordedReview.offerPolicy==='automatic_offer_v6'?streamingAutomaticOfferReceptionPrompt:recordedReview.offerPolicy==='automatic_offer_v7'?payoffAutomaticOfferReceptionPrompt:recordedReview.offerPolicy==='automatic_offer_v8'?progressAutomaticOfferReceptionPrompt:automaticOfferReceptionPrompt).replace('{{icash_property_context}}',JSON.stringify({...automaticContext,...conversationAddressFields(address),principal:identity.principal,companyName:identity.company_name?.trim()||null,assistantName:account.assistant_name}))+'\nOUTBOUND CAPABILITIES: Use the callback tool only for an explicitly agreed date, time and timezone; use the handoff tool when requested. Claim either action only after its successful result. Do not claim an immediate transfer unless the tool confirms one.'
  :buyerContext?buyerCallInstructions(buyerContext,identity.principal,account.assistant_name):sellerPrompt!)+ '\n'+conversationAddressInstructions;
 const assigned=!intake&&!cancellation&&p.party==='seller'?await assignSharedLearning(db,{account:accountId,domain:'seller_calls',subject:`${p.screening_id}:${p.contact_key}`,context:limited?'limited':'reviewed',market:'*'}):null;
 const strategy=(assigned?.variant as keyof typeof acquisitionOpeners|undefined)??(parseInt(createHash('sha256').update(`${accountId}:${p.contact_key}`).digest('hex').slice(0,8),16)%2===0?'cash_interest':'flexible_timing');
 const buildPrompt=()=>{
  const base=!intake&&!cancellation&&p.party==='seller'&&automaticOfferPolicy(recordedReview.offerPolicy)?sellerAgreementDeliveryPrompt(basePrompt()):basePrompt();
  const instructions=!intake&&!cancellation&&p.party==='seller'&&!automaticOfferPolicy(recordedReview.offerPolicy)?base+'\n'+opportunityConversationInstructions:base;
  return instructions+(assigned?`\nREVIEWED INTEREST QUESTION (shared-v1/${limited?'limited':'reviewed'}): Only after the required identity and ownership checks, and only if interest is not already answered in the saved conversation, use this exact question: ${acquisitionOpeners[strategy]} Do not repeat it to a returning seller who already answered. All existing consent, stop, human handoff, offer authority and agreement requirements still apply.`:'');
 };
 if(automaticContext&&p.party==='seller'){
  // Reserve space for the complete runtime instructions, then retain whole
  // historical exchanges within the existing provider limit.
  const historyBudget=Math.max(0,Math.min(recordedReview.offerPolicy==='automatic_offer_v9'?3500:5800,24000-buildPrompt().length-64));
  Object.assign(automaticContext,compactSellerProgress({history:fullSms,priorCalls:fullCalls},historyBudget));
 }
 const prompt=buildPrompt();
 if(prompt.length>24000||(sellerGreeting?.length??0)>2000)return hold('voice_context_too_large');
 const operationKey=`voice:${j.id}`;
 const reserveHold=recordingReleaseHold();if(reserveHold)return hold(reserveHold);
 const reservationInput={p_account:accountId,p_job:j.id,p_rate:rateId,p_permission_until:p.permission_until,p_financial_checked_at:eligible?.ready?new Date(eligible.screening.financialCheck.checkedAt).toISOString():null,p_financial_eligible:eligible?.ready&&eligible.screening.financialCheck.status==='eligible'};
 // Activate only after the matching database migration is installed. Never retry an ambiguous reservation through another path.
 let fundedCall:{maxSeconds:number}|null;
 try{
 fundedCall=cancellation?await db<{maxSeconds:number}|null>('rpc/icash_reserve_cancellation_voice','POST',{p_account:accountId,p_job:j.id,p_context:cancellation}):process.env.ICASH_FLEXIBLE_VOICE_READY==='true'
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
 if(!fundedCall)return {status:cancellation?'cancellation_notice_waiting':process.env.ICASH_FLEXIBLE_VOICE_READY==='true'?'waiting_for_available_credits':'waiting_for_daytime_budget'};
 const claimHold=recordingReleaseHold();if(claimHold)return hold(claimHold);
 const metaClaim=intake?await db<'claimed'|'deferred'|'held'|'unavailable'>('rpc/icash_meta_claim_or_defer_voice','POST',{p_account:accountId,p_job:j.id}):null;
 // Deferral retains the unattempted reservation. Never send a later generic
 // hold: it could arrive after the same job has been issued for its next turn.
 if(metaClaim==='deferred')return {status:'waiting_for_active_call'};
 if(intake&&metaClaim!=='claimed')return {status:metaClaim==='held'?'dispatch_permission_changed':'held'};
 const claimed=intake?metaClaim==='claimed':cancellation?await db<boolean>('rpc/icash_claim_cancellation_voice','POST',{p_account:accountId,p_job:j.id,p_context:cancellation}):p.party==='seller'
  ?limited?await db<boolean>('rpc/icash_claim_limited_seller_voice','POST',{p_job:j.id,p_snapshot:snapshot.snapshot}):await db<boolean>('rpc/icash_claim_automatic_offer_voice_job','POST',{p_job:j.id,p_snapshot:snapshot.snapshot,p_offer_price_cents:cashOfferPrice})
  :await db<boolean>('rpc/icash_claim_reviewed_voice_job','POST',{p_job:j.id,p_offer_snapshot:null,p_buyer_snapshot:buyerContext});
 if(!claimed)return hold('dispatch_permission_changed');
 ownsDispatch=true;
 try{
 await db(`icash_voice_jobs?id=eq.${j.id}&account_id=eq.${accountId}&state=eq.dispatching`,'PATCH',{sms_context:smsContext});
 const dispatchHold=recordingReleaseHold();if(dispatchHold)return hold(dispatchHold);
 const result=await recordingServer().dispatch({accountId,operationKey,fromPhone:businessNumber,maxTotalSeconds:fundedCall.maxSeconds,...(p.party==='seller'?{buyerKind}:{}),principal:identity.principal,assistantName:account.assistant_name,voiceId:callVoiceId,firstMessage:cancellation?`Hello, this is ${account.assistant_name}, an AI assistant calling for ${identity.principal} about an agreement update. Am I speaking with the property seller?`:sellerGreeting??buyerFirstMessage(buyerContext!),prompt,strategyKey:strategy});
 // A started call is connecting; only the recording service can confirm capture.
 if(result.status==='recording_consent_pending'){
  if(j.sms_source_message_id)try{
   const message=await db<string|null>('rpc/icash_seller_sms_call_ack','POST',{p_account:accountId,p_job:j.id});
   if(message)await dispatchTextMessage(accountId,message);
  }catch{/* A text failure must never retry a call already accepted by the provider. */}
  return {status:'call_started'};
 }
 if(result.status==='recording_dial_unknown_no_retry')return {status:'provider_outcome_unknown_no_retry'}; // Keep the durable claim recoverable; never redial.
 return hold(result.status);
 }catch{return hold('provider_outcome_unknown_no_retry');}
}
