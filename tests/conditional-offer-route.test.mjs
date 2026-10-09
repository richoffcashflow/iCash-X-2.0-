import {liveToolHistory} from '../lib/live-tool-history.ts';
import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {sellerAgreementInput} from '../lib/seller-agreement-flow.ts';
import {blockedOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
import {object} from '../lib/required-call-recording.ts';
let sends=0,quote={quoteAllowed:true,party:'seller',priceCents:10200000,status:'conditional_accepted',conditional:true,contractAllowed:false};
const forbidden=()=>assert.fail('A conditional offer must not reach providers');
const route=await loadService('app/api/internal/voice/cash-offer/route.ts',{
 liveToolHistory,NextResponse:{json:Response.json},process:{env:{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',DOCUSEAL_MODE:'live'}},
 db:forbidden,bindSellerAgreementCall:forbidden,callOfferEvidence,callPayoffEvidence:forbidden,createRecordedReceptionProviders:()=>({conversation:async()=>({transcript:[{role:'agent',message:'The cash offer is $102,000. Does that work?'},{role:'user',message:'Yes.'}]})}),
 automaticCallOffer:async()=>quote,blockedOffer,sellerAgreementInput,object,
 sellerAgreementAction:async()=>{sends++;return {sent:true};},sellerAgreementFailure:()=>({sent:false,status:'held'}),sendForSignatures:forbidden,textPendingContract:forbidden,refreshSigning:forbidden,
});
const input={action:'confirm_and_send',conversationId:'conv_fixture',confirmation:{sellerLegalName:'Jane Seller',agreedPriceCents:10200000,closingDate:'2026-11-15',soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'yes',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false}};
const request=()=>new Request('https://fixture.test/api/internal/voice/cash-offer',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify(input)});
let result=await route.POST(request());assert.equal(result.status,200);
let body=await result.json();assert.equal(body.quoteAllowed,true);assert.equal(body.priceCents,10200000);assert.equal(body.sent,false);assert.equal(body.reason,'payoff_review_required');assert.equal(sends,0);
quote={...quote,status:'verbally_accepted',conditional:false,contractAllowed:true};
result=await route.POST(request());assert.equal((await result.json()).sent,true);assert.equal(sends,1,'ordinary accepted eligible offer still reaches the existing agreement service');
quote={...quote,status:'calculated_proposal'};
result=await route.POST(request());assert.equal(result.status,409);assert.equal(sends,1,'fresh quote without acceptance cannot send');
console.log('PASS conditional offer API: spoken price retained; no signing or text on hold; accepted eligible flow preserved.');
