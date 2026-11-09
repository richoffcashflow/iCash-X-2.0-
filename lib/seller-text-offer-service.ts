import {planSellerTextOffer,type TextOfferContext} from './seller-text-offer.ts';
import {signingReadiness} from './signing-policy.ts';
import {object} from './required-call-recording.ts';
type Database=<T=unknown>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dependencies={db:Database;dispatch:(account:string,id:string)=>Promise<{status:string}>;send:(input:{accountId:string;dealId:string;userId:string;customerEmail:string;kind:'purchase';signers:{name:string;phone:string}[];phoneLinkOnly:true;expectedTerms:unknown})=>Promise<{id:string;testMode:boolean}>;text:(account:string,id:string,phone:string)=>Promise<{sent:boolean;status:string}>;now?:()=>number};
/** No model call or provider retry. Saving a plan and claiming an agreement both
 * compare the complete source context again under the existing budget/deal locks. */
export async function processSellerTextOffer(context:TextOfferContext,d:Dependencies){
 const now=(d.now??Date.now)();
 const calls=await d.db<unknown[]>('rpc/icash_seller_prior_call_context','POST',{p_account:context.accountId,p_screening:context.screeningId,p_phone:context.phone});
 const bound={...context,history:Array.isArray(calls)?calls.map(c=>object(c).result):[],callInvitationAllowed:false};
 let plan=planSellerTextOffer(bound,now);
 // Offer a call only where the existing source-bound SMS callback workflow
 // is available. These are read-only checks, never permission to dial: final
 // request, recipient, hours, wallet and provider admission remain authoritative.
 const candidate=planSellerTextOffer({...bound,callInvitationAllowed:true},now);
 if(candidate.action==='invite_call'){
  try{
   if(await d.db('rpc/icash_outreach_voice_current','POST',{p_account:context.accountId})===true){
    // This source-bound RPC independently verifies account, thread, route,
    // property and controls for intake OR reviewed operational contact evidence.
    // The legacy conversation context excludes ordinary operational draft deals
    // and is not an additional authority here. Global voice remains unchanged.
    // This read cannot queue a call or expand future contact consent.
    if(await d.db('rpc/icash_seller_call_invitation_capable','POST',{p_account:context.accountId,p_thread:context.threadId,p_message:context.sourceId})===true)plan=candidate;
   }
  }catch{/* Missing/failed reads keep the supported text step moving. */}
 }
 if(plan.kind==='agreement'){
  try{signingReadiness('purchase',plan.terms!,[{name:plan.terms!.seller,phone:context.phone}],context.principal,'draft',now);}
  catch{return {status:'text_ai_contract_terms_required'};}
 }
 const saved=await d.db<{messageId?:string;agreement?:boolean;review?:boolean;waiting?:boolean}|null>('rpc/icash_save_seller_text_offer','POST',{p_account:context.accountId,p_job:context.jobId,p_fingerprint:context.fingerprint,p_version:context.offerVersion,p_plan:plan});
 if(!saved)return {status:'text_ai_context_changed'};
 if(saved.messageId)return d.dispatch(context.accountId,saved.messageId);
 if(saved.waiting)return {status:'text_ai_waiting'};
 if(saved.review)return {status:'text_ai_needs_review'};
 if(!saved.agreement)return {status:'text_ai_action_required'};
 const claim=await d.db<(TextOfferContext&{claimId:string;sellerName:string})|null>('rpc/icash_claim_seller_text_agreement','POST',{p_account:context.accountId,p_job:context.jobId});
 if(!claim)return {status:'text_ai_agreement_not_admitted'};
 try{
  const envelope=await d.send({accountId:claim.accountId,dealId:claim.dealId,userId:claim.ownerUserId,customerEmail:claim.ownerEmail,kind:'purchase',signers:[{name:claim.sellerName,phone:claim.phone}],phoneLinkOnly:true,expectedTerms:plan.terms});
  if(envelope.testMode)throw Error('live_agreement_required');
  if(await d.db('rpc/icash_finish_seller_agreement','POST',{p_id:claim.claimId,p_account:claim.accountId,p_envelope:envelope.id})!==true)throw Error('agreement_receipt_required');
  const delivery=await d.text(claim.accountId,envelope.id,claim.phone);
  await d.db('rpc/icash_finish_seller_text_agreement','POST',{p_account:claim.accountId,p_job:claim.jobId,p_envelope:envelope.id});
  return {status:delivery.sent?'seller_agreement_sent':'seller_agreement_delivery_pending'};
 }catch{
  await d.db('rpc/icash_fail_seller_agreement','POST',{p_id:claim.claimId,p_account:claim.accountId}).catch(()=>undefined);
  // Retain the consumed claim. Even a lost provider response cannot create a
  // second envelope; existing signing/contract-text reconciliation owns recovery.
  await d.db('rpc/icash_finish_seller_text_agreement','POST',{p_account:claim.accountId,p_job:claim.jobId,p_envelope:null}).catch(()=>undefined);
  return {status:'seller_agreement_receipt_unresolved'};
 }
}
