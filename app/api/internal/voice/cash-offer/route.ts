import {NextResponse} from 'next/server';
import {db} from '@/lib/stripe-test';
import {bindSellerAgreementCall} from '@/lib/seller-agreement-binding';
import {automaticCallOffer,blockedOffer} from '@/lib/automatic-call-offer';
import {callOfferEvidence,callPayoffEvidence} from '@/lib/call-offer-evidence';
import {createRecordedReceptionProviders} from '@/lib/recorded-reception-provider';
import {sellerAgreementAction,sellerAgreementFailure} from '@/lib/seller-agreement-service';
import {sellerAgreementInput} from '@/lib/seller-agreement-flow';
import {sendForSignatures,refreshSigning} from '@/lib/signing-service';
import {textPendingContract} from '@/lib/contract-text-service';
import {object} from '@/lib/required-call-recording';
export const runtime='nodejs';
export const maxDuration=60;
export async function POST(request:Request){
 const headers={'Cache-Control':'private, no-store'},token=request.headers.get('authorization')?.replace(/^Bearer /,'');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return NextResponse.json({quoteAllowed:false,sent:false},{status:401,headers});
 try{
  const raw=await request.text();if(raw.length>6000)throw Error('invalid_input');
  const input=object(JSON.parse(raw));
  if(process.env.ICASH_LIVE_WORK_READY!=='true'||process.env.ICASH_RECORDING_RECEIPTS_READY!=='true')return NextResponse.json(blockedOffer('unavailable','The live property workflow is not currently available.'),{status:409,headers});
  let evidence:Promise<unknown>|undefined;
  const transcript=(i:Record<string,unknown>)=>evidence??=createRecordedReceptionProviders(process.env).conversation(String(i.conversationId));
  const d={db,bind:bindSellerAgreementCall,verifyInput:async(i:Record<string,unknown>)=>callOfferEvidence(await transcript(i),i),verifyPayoffChange:async(i:Record<string,unknown>)=>callPayoffEvidence(await transcript(i),i)};
  if(input.action!=='confirm_and_send'&&input.action!=='status')return NextResponse.json(await automaticCallOffer(token,input,d),{headers});
  const agreement=sellerAgreementInput.parse(input);
  if(process.env.DOCUSEAL_MODE!=='live')return NextResponse.json({sent:false,status:'unavailable',instruction:'Live agreement delivery is not ready.'},{status:409,headers});
  if(agreement.action==='confirm_and_send'){
   const quote=await automaticCallOffer(token,{action:'get_offer',conversationId:agreement.conversationId},d);
   if(quote.quoteAllowed&&'contractAllowed' in quote&&quote.contractAllowed===false)return NextResponse.json({...quote,sent:false,reason:'payoff_review_required',instruction:'The exact cash price may be discussed as a conditional offer. The payoff and any liens must be confirmed before sending a contract. Acknowledge any payoff answer already given; do not claim delivery or ask the seller to reconcile the records themselves.'},{headers});
   if(!quote.quoteAllowed||!('party' in quote)||quote.party!=='seller'||!('status' in quote)||!['verbally_accepted','pending_agreement'].includes(quote.status)||quote.priceCents!==agreement.confirmation.agreedPriceCents)return NextResponse.json({...blockedOffer('confirmed_price_required','Confirm and save the exact current offer before preparing the agreement.'),sent:false},{status:409,headers});
   // Preserve the caller's changed-facts flag; the agreement validator must
   // still stop any unresolved change reported after this quote was calculated.
  }
  return NextResponse.json(await sellerAgreementAction(token,agreement,{db,bind:bindSellerAgreementCall,send:sendForSignatures,text:textPendingContract,refresh:refreshSigning}),{headers});
 }catch(error){const failure=sellerAgreementFailure(error);console.warn('automatic_offer_held',{reason:failure.reason});return NextResponse.json({...failure,quoteAllowed:false,priceCents:null},{status:409,headers});}
}
