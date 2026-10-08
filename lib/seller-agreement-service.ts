import {sellerAgreementInput,confirmedSellerTerms} from './seller-agreement-flow.ts';
import {runScreeningJob} from './screening-job.ts';
import {dealTermsSchema} from './deal-documents.ts';
import {signingReadiness} from './signing-policy.ts';
import {sha} from './required-call-recording.ts';
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
export type SellerAgreementScope={callKey:string;accountId:string;ownerUserId:string;ownerEmail:string;dealId:string;screeningId:string;phone:string};
type Envelope={id:string;state:string;test_mode:boolean;terms:unknown;recipients:{name:string;phone?:string}[]};
type Dependencies={db:Database;bind:(token:string,conversationId:string)=>Promise<void>;send:(input:{accountId:string;userId:string;customerEmail:string;dealId:string;kind:'purchase';signers:{name:string;phone:string}[];phoneLinkOnly:true})=>Promise<{id:string;testMode:boolean}>;text:(accountId:string,envelopeId:string,phone:string)=>Promise<{sent:boolean;status:string;instruction:string}>;refresh:(accountId:string,envelopeId:string)=>Promise<{status:string}>;now?:()=>number};
const instructions:Record<string,string>={
 all_owners_required:'Another owner or decision maker must be included. Ask who else needs to agree and arrange their participation; do not omit a required signer.',
 confirmation_required:'Confirm the exact price and closing date, prepared terms, and whether they want the agreement texted now before sending.',
 updated_property_review_required:'The property facts changed. The numbers need updating before confirming an agreement.',
 property_binding_changed:'The property details changed. This agreement needs review.',
 price_review_required:'That price needs review. Do not promise a price outside the authorized offer.',
 existing_price_changed:'A different price is already saved. The existing agreement needs revision before sending.',
 closing_date_review_required:'Confirm an exact future closing date, including the year. Do not invent a date.',
 earnest_terms_required:'The earnest money terms still need to be prepared by the buyer. Record the agreed price and closing date for follow-up; do not invent an earnest amount or say the contract was sent.',
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
  if(!existing||!existing.recipients.slice(0,-1).some(r=>r.phone===scope.phone))return {status:'not_sent',sent:false,instruction:'There is no matching agreement to verify for this seller yet.'};
  const verified=await d.refresh(scope.accountId,existing.id);
  if(verified.status==='completed')return {status:'fully_signed',sent:true,instruction:'All required signatures are verified. Congratulate them on the signed agreement and explain that title and closing coordination come next. Do not claim the sale is funded.'};
  if(verified.status==='customer_signature_needed')return {status:'seller_signed',sent:true,instruction:'The required seller signatures are verified. Congratulate the seller; explain that the buyer signature is next. Do not claim all parties have signed.'};
  return {status:verified.status==='awaiting_counterparty'?'signature_pending':'needs_review',sent:true,instruction:verified.status==='awaiting_counterparty'?'The provider has not confirmed all seller signatures. Ask them to finish the final submit step. Check again only after they respond.':'The signing request needs review. Do not claim a verified signature.'};
 }
 const [deal]=await d.db<{terms:unknown;stage:string}[]>(`icash_deal_files?account_id=eq.${scope.accountId}&id=eq.${scope.dealId}&select=terms,stage`);
 const [screening]=await d.db<{snapshot:unknown}[]>(`icash_screening_jobs?account_id=eq.${scope.accountId}&id=eq.${scope.screeningId}&state=eq.complete&select=snapshot`);
 const [identity]=await d.db<{principal:string}[]>(`icash_customer_identities?account_id=eq.${scope.accountId}&select=principal`);
 if(!deal||deal.stage!=='draft'||!screening||!identity?.principal)throw Error('property_binding_changed');
 const result=runScreeningJob(screening.snapshot,(d.now??Date.now)());
 if(!result.offerAuthorized||result.financialCheck.status!=='eligible'||!result.preliminarySellerCeilingCents)throw Error('updated_property_review_required');
 const current=dealTermsSchema.parse(deal.terms);
 const terms=confirmedSellerTerms(current,i.confirmation,{address:result.property.address,principal:identity.principal,legalDescription:result.property.legalDescription??'',ceilingCents:result.preliminarySellerCeilingCents,now:(d.now??Date.now)()});
 const signers=[{name:terms.seller,phone:scope.phone}];
 signingReadiness('purchase',terms,signers,identity.principal,'draft',(d.now??Date.now)());
 if(existing){
  const prepared=dealTermsSchema.parse(existing.terms);
  if(existing.state!=='awaiting_counterparty'||JSON.stringify(prepared)!==JSON.stringify(current)||prepared.priceCents!==terms.priceCents||prepared.closingDate!==terms.closingDate||prepared.seller!==terms.seller||existing.recipients.length!==2||existing.recipients[0].phone!==scope.phone)throw Error('agreement_changed');
 }
 const claim=await d.db<{id:string;claimed:boolean;envelopeId:string|null}|null>('rpc/icash_claim_seller_agreement','POST',{p_hash:hash,p_conversation:i.conversationId,p_confirmation:i.confirmation,p_expected_terms:deal.terms,p_terms:existing?deal.terms:terms});
 if(!claim)throw Error('agreement_in_progress');
 let envelopeId=claim.envelopeId;
 if(!envelopeId){
  if(!claim.claimed)throw Error('agreement_in_progress');
  try{
   const sent=await d.send({accountId:scope.accountId,userId:scope.ownerUserId,customerEmail:scope.ownerEmail,dealId:scope.dealId,kind:'purchase',signers,phoneLinkOnly:true});
   if(sent.testMode)throw Error('live_agreement_required');
   envelopeId=sent.id;
   if(await d.db('rpc/icash_finish_seller_agreement','POST',{p_id:claim.id,p_account:scope.accountId,p_envelope:envelopeId})!==true)throw Error('agreement_in_progress');
  }catch(error){await d.db('rpc/icash_fail_seller_agreement','POST',{p_id:claim.id,p_account:scope.accountId}).catch(()=>undefined);throw error;}
 }
 // Recheck the live contact before the actual SMS dispatch; the queue is idempotent.
 if(!await d.db('rpc/icash_seller_agreement_call_context','POST',{p_hash:hash,p_conversation:i.conversationId}))return {status:'needs_followup',sent:false,instruction:'The agreement was prepared, but this call is no longer active. Do not claim a text was sent.'};
 return {...await d.text(scope.accountId,envelopeId,scope.phone),agreementPrepared:true};
}
export function sellerAgreementFailure(error:unknown){
 const reason=error instanceof Error?error.message:'';
 return {sent:false,status:'needs_followup',reason:Object.hasOwn(instructions,reason)?reason:'agreement_review_required',instruction:instructions[reason]??'The agreement needs review before sending. Do not claim delivery, a signature or a completed closing.'};
}
