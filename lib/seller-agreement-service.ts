import {sellerAgreementInput,confirmedSellerTerms} from './seller-agreement-flow.ts';
import {calculateAutomaticCallOffer,type CallOfferContext} from './automatic-call-offer.ts';
import {runScreeningJob} from './screening-job.ts';
import {dealTermsSchema} from './deal-documents.ts';
import {signingReadiness} from './signing-policy.ts';
import {sha} from './required-call-recording.ts';
import {sellerAgreementEvidence,sellerAgreementConfirmationHold} from './seller-agreement-evidence.ts';
import {sellerAgreementIdentityEvidence,sellerAgreementIdentityHold} from './seller-agreement-identity.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type SellerAgreementScope={callKey:string;accountId:string;ownerUserId:string;ownerEmail:string;dealId:string;screeningId:string;phone:string};
type Envelope={id:string;state:string;test_mode:boolean;terms:unknown;recipients:{id:string;name:string;phone?:string}[]};
type Dependencies={db:Database;history:(conversationId:string)=>Promise<unknown>;bind:(token:string,conversationId:string)=>Promise<void>;send:(input:{accountId:string;userId:string;customerEmail:string;dealId:string;kind:'purchase';signers:{name:string;phone:string}[];phoneLinkOnly:true})=>Promise<{id:string;testMode:boolean}>;text:(accountId:string,envelopeId:string,phone:string)=>Promise<{sent:boolean;status:string;instruction:string}>;refresh:(accountId:string,envelopeId:string)=>Promise<{status:string}>;now?:()=>number};
const instructions:Record<string,string>={
 all_owners_required:'Another owner or decision maker must be included. Ask who else needs to agree and arrange their participation; do not omit a required signer.',
 confirmation_required:'Confirm the exact price and closing date, prepared terms, and whether they want the agreement texted now before sending.',
 updated_property_review_required:'The property facts changed. The numbers need updating before confirming an agreement.',
 property_binding_changed:'The property details changed. This agreement needs review.',
 price_review_required:'That price needs review. Do not promise a price outside the authorized offer.',
 existing_price_changed:'A different price is already saved. The existing agreement needs revision before sending.',
 closing_date_review_required:'Confirm an exact future closing date, including the year. Do not invent a date.',
 agreement_changed:'The pending agreement differs from the confirmed price, date or seller name. It must be revised before sending.',
 agreement_in_progress:'Agreement preparation is already in progress or needs review. Do not submit a second signing request.',
};
export async function sellerAgreementAction(token:string,input:unknown,d:Dependencies){
 const i=sellerAgreementInput.parse(input),hash=sha(token);
 await d.bind(token,i.conversationId);
 const scope=await d.db<SellerAgreementScope|null>('rpc/icash_seller_agreement_call_context','POST',{p_hash:hash,p_conversation:i.conversationId});
 if(!scope)return {status:'unavailable',sent:false,instruction:'This call does not have a current seller agreement context. Arrange follow-up; do not send to another number or guess a property.'};
 const envelopes=await d.db<Envelope[]>(`icash_signing_envelopes?account_id=eq.${scope.accountId}&deal_id=eq.${scope.dealId}&kind=eq.purchase&test_mode=eq.false&select=id,state,test_mode,terms,recipients&limit=2`);
 if(envelopes.length>1)throw Error('agreement_in_progress');
 const existing=envelopes[0];
 if(i.action==='status'){
  const signer=existing?.recipients.slice(0,-1).find(r=>r.phone===scope.phone);
  if(!existing||!signer)return {status:'not_sent',sent:false,instruction:'There is no matching agreement to verify for this seller yet.'};
  const verified=await d.refresh(scope.accountId,existing.id);
  if(verified.status==='completed')return {status:'fully_signed',sent:true,viewingStatus:'availability_needed',instruction:'All required signatures are verified. Say: Congratulations! The agreement is signed. We will contact you about available times to view the property. Keep this signing confirmation brief. The next step is collecting viewing availability; the signature-confirmation text asks for good days and times. If they volunteer availability now, reuse it and clarify only missing details. Do not require a concrete appointment now, start a title or closing checklist, or claim that a visit or closing is booked. Do not claim the sale is funded.'};
  if(verified.status==='customer_signature_needed')return {status:'seller_signed',sent:true,viewingStatus:'after_counter_signature',instruction:'The required seller signatures are verified. Say: Congratulations, your signature is in! Once everyone has signed, we will contact you about available times to view the property. Keep this confirmation brief. The buyer signature is still pending; do not claim all parties have signed, book a visit or start a title or closing checklist.'};
  // Phone-link-only preparation deliberately sends no provider invitation.
  // A pending envelope therefore cannot establish that its text was sent.
  const [delivery]=signer.id?await d.db<{message_id:string}[]>(`icash_contract_text_deliveries?account_id=eq.${scope.accountId}&envelope_id=eq.${existing.id}&signer_id=eq.${encodeURIComponent(signer.id)}&select=message_id&limit=1`):[];
  const [message]=delivery?await d.db<{state:string;provider_id:string|null}[]>(`icash_text_messages?account_id=eq.${scope.accountId}&id=eq.${delivery.message_id}&direction=eq.outgoing&select=state,provider_id&limit=1`):[];
  const sent=!!message?.provider_id&&['accepted','delivered'].includes(message.state);
  const deliveryStatus=message?.state??'not_queued';
  if(verified.status!=='awaiting_counterparty')return {status:'needs_review',sent,deliveryStatus,instruction:'The signing request needs review. Do not claim a verified signature or ask the seller to finish signing an unavailable agreement.'};
  if(!sent)return {status:message&&['ready','dispatching'].includes(message.state)?'delivery_pending':'delivery_needs_review',sent:false,agreementPrepared:true,deliveryStatus,instruction:'The agreement is prepared, but its text has not been confirmed as sent. Do not say it was sent or ask the seller to finish signing. Report the delivery issue for follow-up; this status check does not resend it or schedule a callback.'};
  return {status:'signature_pending',sent:true,deliveryStatus,instruction:(message!.state==='delivered'?'The provider reports text delivery, but the seller has not confirmed receiving it.':'The provider accepted the contract text; delivery is not confirmed.')+' Ask whether it arrived and invite them to review and sign for themselves. If they say it did not arrive, report the delivery issue; do not insist they received it. If they say they already signed, ask whether they completed the final submit step. Check again only after they respond.'};
 }
 const [deal]=await d.db<{terms:unknown;stage:string}[]>(`icash_deal_files?account_id=eq.${scope.accountId}&id=eq.${scope.dealId}&select=terms,stage`);
 const [screening]=await d.db<{snapshot:unknown}[]>(`icash_screening_jobs?account_id=eq.${scope.accountId}&id=eq.${scope.screeningId}&state=eq.complete&select=snapshot`);
 const [identity]=await d.db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${scope.accountId}&select=principal`);
 if(!deal||deal.stage!=='draft'||!screening||!identity?.principal)throw Error('property_binding_changed');
 const result=runScreeningJob(screening.snapshot,(d.now??Date.now)());
 const offerContext=await d.db<CallOfferContext|null>('rpc/icash_call_offer_context','POST',{p_hash:hash,p_conversation:i.conversationId});
 const callOffer=offerContext?calculateAutomaticCallOffer(offerContext,offerContext.offerState??{},(d.now??Date.now)()):null;
 const acceptedCallOffer=callOffer?.quoteAllowed&&'contractAllowed' in callOffer&&callOffer.contractAllowed===true&&'status' in callOffer&&['verbally_accepted','pending_agreement'].includes(callOffer.status)&&callOffer.priceCents===i.confirmation.agreedPriceCents;
 if(((!result.offerAuthorized||result.financialCheck.status!=='eligible')&&!acceptedCallOffer)||!result.preliminarySellerCeilingCents)throw Error('updated_property_review_required');
 const current=dealTermsSchema.parse(deal.terms);
 const history=await d.history(i.conversationId);
 const identityHold=sellerAgreementIdentityHold(sellerAgreementIdentityEvidence(history,i.confirmation.sellerLegalName));
 if(identityHold)return identityHold;
 const terms=confirmedSellerTerms(current,i.confirmation,{address:result.property.address,principal:identity.principal,legalDescription:result.property.legalDescription??'',ceilingCents:result.preliminarySellerCeilingCents,now:(d.now??Date.now)()});
 const signers=[{name:terms.seller,phone:scope.phone}];
 signingReadiness('purchase',terms,signers,identity.principal,'draft',(d.now??Date.now)());
 if(existing){
  const prepared=dealTermsSchema.parse(existing.terms);
  if(existing.state!=='awaiting_counterparty'||JSON.stringify(prepared)!==JSON.stringify(current)||prepared.priceCents!==terms.priceCents||prepared.closingDate!==terms.closingDate||prepared.seller!==terms.seller||existing.recipients.length!==2||existing.recipients[0].phone!==scope.phone)throw Error('agreement_changed');
 }
 if(!sellerAgreementEvidence(history,terms,(d.now??Date.now)()))return sellerAgreementConfirmationHold(terms);
 const deferDelivery=async()=>{
  try{
   const deferred=await d.db<{queued:boolean;id?:string}|null>('rpc/icash_defer_seller_agreement','POST',{p_hash:hash,p_conversation:i.conversationId,p_confirmation:i.confirmation,p_expected_terms:deal.terms,p_terms:existing?deal.terms:terms});
   if(deferred?.queued===true)return {sent:false,status:'delivery_queued',reason:'agreement_text_unavailable',deliveryScheduled:true,instruction:'The confirmed agreement is queued for automatic delivery. Explain that it will be texted when texting is available. Keep the confirmed price, date, name and other answers; do not repeat qualification, claim it has already been sent, or give an unverified delivery time. The seller does not need to repeat the request.'};
  }catch{/* Keep the original send failure or record a delivery gap below. */}
  return null;
 };
 // Check delivery before consuming the one-time agreement claim. A missing or
 // expired text channel has not attempted provider creation and must remain
 // recoverable when its existing, permitted configuration is restored.
 const threads=await d.db<{id:string}[]>(`icash_text_threads?account_id=eq.${scope.accountId}&deal_id=eq.${scope.dealId}&recipient=eq.${encodeURIComponent(scope.phone)}&party=eq.seller&retired_at=is.null&paused=eq.false&manual_only=eq.false&select=id&limit=2`);
 const suppressed=await d.db<{phone:string}[]>(`icash_text_suppressions?phone=eq.${encodeURIComponent(scope.phone)}&select=phone&limit=1`);
 if(suppressed.length)return {sent:false,status:'delivery_unavailable',reason:'contact_stopped',instruction:'This number has stopped text messages. Do not send or retry the contract text. Do not ask the seller to repeat the already confirmed agreement details.'};
 if(threads.length!==1||!await d.db<boolean>('rpc/icash_sms_thread_review_current','POST',{p_account:scope.accountId,p_thread:threads[0].id,p_check_hour:true})){
  const deferred=await deferDelivery();if(deferred)return deferred;
  try{await d.db('rpc/icash_record_seller_tool_gap','POST',{p_hash:hash,p_conversation:i.conversationId,p_reason:'agreement_text_unavailable'});}catch{console.warn('seller_gap_capture_pending',{action:i.action,reason:'agreement_text_unavailable'});}
  return {sent:false,status:'delivery_unavailable',reason:'agreement_text_unavailable',instruction:'The agreement details are confirmed, but text delivery for this property is currently unavailable. Explain the delivery problem once and keep the confirmed price, date, name and answers. Do not repeat qualification, claim the contract was sent, or immediately retry. The delivery setup needs review before the same confirmed agreement can be sent. No callback or delivery has been scheduled.'};
 }
 const claim=await d.db<{id:string;claimed:boolean;envelopeId:string|null}|null>('rpc/icash_claim_seller_agreement','POST',{p_hash:hash,p_conversation:i.conversationId,p_confirmation:i.confirmation,p_expected_terms:deal.terms,p_terms:existing?deal.terms:terms});
 if(!claim)throw Error('agreement_in_progress');
 let envelopeId=claim.envelopeId;
 if(!envelopeId){
  if(!claim.claimed){const deferred=await deferDelivery();if(deferred)return deferred;throw Error('agreement_in_progress');}
  try{
   const sent=await d.send({accountId:scope.accountId,userId:scope.ownerUserId,customerEmail:scope.ownerEmail,dealId:scope.dealId,kind:'purchase',signers,phoneLinkOnly:true});
   if(sent.testMode)throw Error('live_agreement_required');
   envelopeId=sent.id;
   if(await d.db('rpc/icash_finish_seller_agreement','POST',{p_id:claim.id,p_account:scope.accountId,p_envelope:envelopeId})!==true)throw Error('agreement_in_progress');
  }catch(error){
   await d.db('rpc/icash_fail_seller_agreement','POST',{p_id:claim.id,p_account:scope.accountId}).catch(()=>undefined);
   // The guarded queue rejects every existing envelope, including uncertain
   // provider attempts. Only a failure before creation can be resumed safely.
   const deferred=await deferDelivery();if(deferred)return deferred;throw error;
  }
 }
 // The saved confirmation authorizes this exact agreement. A call ending during
 // provider preparation must not drop its requested text. The SMS service
 // independently rechecks current contact permission, stops and exact signer.
 return {...await d.text(scope.accountId,envelopeId,scope.phone),agreementPrepared:true};
}
export function sellerAgreementFailure(error:unknown){
 const reason=error instanceof Error?error.message:'';
 return {sent:false,status:'needs_followup',reason:Object.hasOwn(instructions,reason)?reason:'agreement_review_required',instruction:instructions[reason]??'The agreement needs review before sending. Do not claim delivery, a signature or a completed closing.'};
}
