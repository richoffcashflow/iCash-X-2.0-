import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {bindSellerAgreementCall} from '@/lib/seller-agreement-binding';
import {automaticCallOffer,blockedOffer,buyerAgreementHandoff} from '@/lib/automatic-call-offer';
import {sellerListingEvidence} from '@/lib/seller-listing';
import {sellerPayoffEvidence} from '@/lib/seller-payoff';
import {callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence} from '@/lib/call-offer-evidence';
import {createRecordedReceptionProviders} from '@/lib/recorded-reception-provider';
import {sellerAgreementAction,sellerAgreementFailure} from '@/lib/seller-agreement-service';
import {sellerAgreementInput} from '@/lib/seller-agreement-flow';
import {sendForSignatures,refreshSigning} from '@/lib/signing-service';
import {textPendingContract} from '@/lib/contract-text-service';
import {object,sha} from '@/lib/required-call-recording';
import {liveToolHistory} from '@/lib/live-tool-history';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'},token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({quoteAllowed:false,sent:false},{status:401,headers});
 let action='unknown',conversationId:string|null=null;
 try{
  const raw=await request.text();if(raw.length>262144)throw Error('invalid_input');
  const {conversationHistory,...input}=object(JSON.parse(raw));
  if(JSON.stringify(input).length>6000)throw Error('invalid_input');
  if(typeof input.conversationId==='string'&&/^conv_[A-Za-z0-9]+$/.test(input.conversationId))conversationId=input.conversationId;
  const currentHistory=liveToolHistory(conversationHistory);
  if(['get_offer','accept_offer','update_repairs','report_change','confirm_and_send','status'].includes(String(input.action)))action=String(input.action);
  if(process.env.ICASH_LIVE_WORK_READY!=='true'||process.env.ICASH_RECORDING_RECEIPTS_READY!=='true')return NextResponse.json(blockedOffer('unavailable','The live property workflow is not currently available.'),{status:409,headers});
  let evidence:Promise<unknown>|undefined;
  const transcript=(i:Record<string,unknown>)=>currentHistory?Promise.resolve(currentHistory):evidence??=createRecordedReceptionProviders(process.env).conversation(String(i.conversationId));
  const d={db,bind:bindSellerAgreementCall,resolveStatement:async(i:Record<string,unknown>)=>callSellerStatement(await transcript(i),i),verifyInput:async(i:Record<string,unknown>)=>callOfferEvidence(await transcript(i),i),verifyPayoffChange:async(i:Record<string,unknown>)=>callPayoffEvidence(await transcript(i),i),verifyListingStatus:async(i:Record<string,unknown>)=>sellerListingEvidence(await transcript(i),i),verifySellerPrice:async(i:Record<string,unknown>)=>callSellerPriceEvidence(await transcript(i),i),verifyPayoffFacts:async(i:Record<string,unknown>)=>sellerPayoffEvidence(await transcript(i),i)};
  if(input.action!=='confirm_and_send'&&input.action!=='status')return NextResponse.json(await automaticCallOffer(token,input,d),{headers});
  const agreement=sellerAgreementInput.parse(input);
  if(process.env.DOCUSEAL_MODE!=='live')return NextResponse.json({sent:false,status:'unavailable',instruction:'Live agreement delivery is not ready.'},{status:409,headers});
  if(agreement.action==='confirm_and_send'){
   const quote=await automaticCallOffer(token,{action:'get_offer',conversationId:agreement.conversationId},d);
   if('party' in quote&&quote.party==='buyer')return NextResponse.json(buyerAgreementHandoff(),{headers});
   if(quote.quoteAllowed&&'contractAllowed' in quote&&quote.contractAllowed===false)return NextResponse.json({...quote,sent:false,reason:'payoff_review_required',instruction:quote.instruction},{headers});
   if(!quote.quoteAllowed||!('party' in quote)||quote.party!=='seller'||!('status' in quote)||!['verbally_accepted','pending_agreement'].includes(quote.status)||quote.priceCents!==agreement.confirmation.agreedPriceCents)return NextResponse.json({...blockedOffer('confirmed_price_required','Confirm and save the exact current offer before preparing the agreement.'),sent:false},{status:409,headers});
   if(!callOfferEvidence(await transcript(agreement),{action:'accept_offer',priceCents:quote.priceCents,quoteRevision:'quoteRevision' in quote?quote.quoteRevision:undefined}))return NextResponse.json({...blockedOffer('acceptance_confirmation_required','The latest seller response needs clarification. Reconfirm the exact current price after resolving their concern before sending.'),sent:false},{status:409,headers});
   // Preserve the caller's changed-facts flag; the agreement validator must
   // still stop any unresolved change reported after this quote was calculated.
  }
  return NextResponse.json(await sellerAgreementAction(token,agreement,{db,bind:bindSellerAgreementCall,send:sendForSignatures,text:textPendingContract,refresh:refreshSigning}),{headers});
 }catch(error){
  const failure=sellerAgreementFailure(error),invalid=error instanceof Error&&error.name==='ZodError';
  // Durable, call-bound recovery. This is only a case; it cannot repeat a
  // signing/provider attempt or authorize a different price or recipient.
  if(conversationId)try{await db('rpc/icash_record_seller_tool_gap','POST',{p_hash:sha(token),p_conversation:conversationId,p_reason:failure.reason});}catch{console.warn('seller_gap_capture_pending',{action});}
  console.warn('automatic_offer_held',{action,reason:failure.reason,code:invalid?'invalid_tool_arguments':error instanceof Error&&/^[A-Za-z_]{3,80}$/.test(error.message)?error.message:'invalid_or_unavailable'});
  const recovery=invalid?{reason:'invalid_tool_arguments',instruction:'Retry once with only the fields required for this action and the exact conversationId. Omit unused optional fields. Do not ask the caller to repeat their answers. If it fails again, explain the technical problem once.'}:failure.reason==='agreement_review_required'?{reason:'call_temporarily_unavailable',instruction:'The call action is temporarily unavailable. Retry this action at most once. If it still fails, explain the technical problem once; do not repeat answered questions or claim that the offer or contract is ready.'}:{};
  const instruction=(recovery.instruction??failure.instruction??'The call action needs team review.')+' No callback or delivery has been scheduled. Do not promise that someone will reach out, review, send or arrange anything; do not agree if the caller assumes a callback. Do not guess missing terms or offer viewing coordination while current details are unavailable.';
  return NextResponse.json({...failure,...recovery,instruction,callbackScheduled:false,quoteAllowed:false,priceCents:null},{status:409,headers});
 }
}
