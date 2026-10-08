import {signingTermsHash} from './signing-policy.ts';
import {dealTermsSchema} from './deal-documents.ts';
type Job={id:string;accountId:string;userId:string;customerEmail:string;dealId:string;phone:string;sellerName:string;expectedTerms:unknown};
type Database=<T>(path:string,method?:string,body?:unknown)=>Promise<T>;
type Dependencies={db:Database;send:(input:{accountId:string;userId:string;customerEmail:string;dealId:string;kind:'purchase';signers:{name:string;phone:string}[];phoneLinkOnly:true})=>Promise<{id:string;testMode:boolean}>;text:(accountId:string,envelopeId:string,phone:string)=>Promise<{sent:boolean;status:string}>};
/** One owner-authorized request, one provider creation. An uncertain send stays
 * in review instead of recreating a contract. All normal signing/SMS checks run. */
export async function recoverAgreementDelivery(d:Dependencies,env:Record<string,string|undefined>){
 if(env.VERCEL_ENV!=='production'||env.DOCUSEAL_MODE!=='live'||env.ICASH_LIVE_WORK_READY!=='true')return {status:'disabled'};
 const job=await d.db<Job|null>('rpc/icash_claim_agreement_delivery_recovery','POST',{});if(!job)return {status:'idle'};
 let envelopeId:string|null=null;
 try{
  const existing=await d.db<{id:string;state:string;terms:unknown;recipients:{name:string;phone?:string}[];provider_id:string|null}[]>(`icash_signing_envelopes?account_id=eq.${job.accountId}&deal_id=eq.${job.dealId}&kind=eq.purchase&test_mode=eq.false&select=id,state,terms,recipients,provider_id&limit=2`);
  if(existing.length){
   const e=existing[0];
   if(existing.length!==1||e.state!=='awaiting_counterparty'||!e.provider_id||signingTermsHash(dealTermsSchema.parse(e.terms))!==signingTermsHash(dealTermsSchema.parse(job.expectedTerms))||e.recipients.length!==2||e.recipients[0].phone!==job.phone||e.recipients[0].name!==job.sellerName)throw Error('existing_agreement_needs_review');
   envelopeId=e.id;
  }else{
   const sent=await d.send({accountId:job.accountId,userId:job.userId,customerEmail:job.customerEmail,dealId:job.dealId,kind:'purchase',signers:[{name:job.sellerName,phone:job.phone}],phoneLinkOnly:true});
   if(sent.testMode)throw Error('live_agreement_required');envelopeId=sent.id;
  }
  const result=await d.text(job.accountId,envelopeId,job.phone);
  await d.db('rpc/icash_finish_agreement_delivery_recovery','POST',{p_id:job.id,p_envelope:envelopeId,p_result:{sent:result.sent,status:result.status}});
  return {status:result.sent?'agreement_text_accepted':'agreement_text_needs_review'};
 }catch(error){
  const reason=error instanceof Error?error.message.slice(0,250):'Agreement recovery needs review';
  await d.db('rpc/icash_finish_agreement_delivery_recovery','POST',{p_id:job.id,p_envelope:envelopeId,p_result:{sent:false,status:'needs_review',reason}});
  return {status:'agreement_recovery_needs_review'};
 }
}
