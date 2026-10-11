import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {liveToolHistory} from '../lib/live-tool-history.ts';
import {boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
import {automaticCallOffer,blockedOffer,buyerAgreementHandoff} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence} from '../lib/call-offer-evidence.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {sellerPayoffEvidence} from '../lib/seller-payoff.ts';
import {sellerAgreementInput} from '../lib/seller-agreement-flow.ts';
import {sellerAgreementAction,sellerAgreementFailure} from '../lib/seller-agreement-service.ts';
import {object,sha} from '../lib/required-call-recording.ts';
const address='45 Fixture Lane',now=Date.now();
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,legal_description:'Lot 1 block 2',estimated_value:280000,estimated_repair_cost:48185,is_free_and_clear:'Yes',total_estimated_loan_balance:0,estimated_equity_percentage:100}}};
const context={party:'seller',address,offerState:{},offerVersion:0,snapshot},scope={callKey:'fixture',accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.test',dealId:'deal',screeningId:'screen',phone:'+12125550199'};
let rejectAcceptance=false;const savedActions=[];
let terms={address,buyer:'Fixture buyer',state:'TX'},claim,envelopes=[],sends=0,texts=0;
const db=async(path,method,b)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(context);
 if(path==='rpc/icash_save_call_offer'){if(rejectAcceptance&&b.p_action==='accept_offer')return false;savedActions.push(b.p_action);assert.equal(b.p_expected_version,context.offerVersion);context.offerState=b.p_state;context.offerVersion++;return true;}
 if(path==='rpc/icash_seller_agreement_call_context')return scope;
 if(path.startsWith('icash_signing_envelopes?'))return envelopes;
 if(path.startsWith('icash_deal_files?'))return [{terms,stage:'draft'}];
 if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
 if(path.startsWith('icash_customer_identities?'))return [{principal:'Fixture buyer'}];
 if(path==='rpc/icash_claim_seller_agreement'){if(claim)return {...claim,claimed:false};terms=b.p_terms;claim={id:'claim',claimed:true,envelopeId:null};return claim;}
 if(path==='rpc/icash_finish_seller_agreement'){claim.envelopeId=b.p_envelope;return true;}
 throw Error(path);
};
const route=await loadService('app/api/internal/voice/cash-offer/route.ts',{
 liveToolHistory,boundSellerQualification,NextResponse:{json:Response.json},process:{env:{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',DOCUSEAL_MODE:'live'}},db,
 bindSellerAgreementCall:async()=>{},createRecordedReceptionProviders:()=>({conversation:async()=>assert.fail('The live tool history must work even when a provider GET is stale')}),
 callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence,sellerPayoffEvidence,sellerListingEvidence,automaticCallOffer,blockedOffer,buyerAgreementHandoff,sellerAgreementInput,object,sha,sellerAgreementFailure,sellerAgreementAction,
 sendForSignatures:async i=>{sends++;assert.equal(i.signers[0].phone,scope.phone);assert.equal(terms.priceCents,15200000);assert.equal(terms.earnestCents,null);envelopes=[{id:'envelope',state:'awaiting_counterparty',test_mode:false,terms,recipients:[i.signers[0],{name:'Fixture buyer'}]}];return {id:'envelope',testMode:false};},
 textPendingContract:async(account,id,phone)=>{texts++;assert.deepEqual([account,id,phone],['account','envelope',scope.phone]);return {sent:true,status:'accepted'};},refreshSigning:async()=>({status:'awaiting_counterparty'}),
});
let entries=qualifiedSellerTurns.slice(0,2),qualificationEntries=[];
const post=async(body,status=200)=>{const r=await route.POST(new Request('https://fixture.test/api/internal/voice/cash-offer',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({conversationId:'conv_fixture',conversationHistory:JSON.stringify({'x-elevenlabs-history':true,entries:[...qualificationEntries,...entries]}),...body})}));assert.equal(r.status,status);return r.json();};
const early=await post({action:'get_offer'});assert.equal(early.quoteAllowed,false);assert.equal(early.priceCents,null);assert.equal(early.nextQuestion,'Is now a good time to talk about the property?');assert.equal(savedActions.length,0,'ownership alone cannot issue a price');
qualificationEntries=qualifiedSellerTurns;entries=[];
const quoted=await post({action:'get_offer'});assert.equal(quoted.priceCents,15200000);
entries=[{role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify(quoted)}]},{role:'agent',message:'Our cash offer is one hundred fifty-two thousand dollars. Does that work?'},{role:'user',message:'Yes, it works.'},{role:'agent',message:'What is your legal name?'},{role:'user',message:'Jane Seller.'}];
assert.equal((await post({action:'accept_offer',priceCents:15200000,quoteRevision:quoted.quoteRevision})).status,'verbally_accepted');
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:15200000,closingDate:new Date(now+30*86400000).toISOString().slice(0,10),soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'yes',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
entries.push({role:'agent',message:'The price is $152,000, closing '+confirmation.closingDate+' with the prepared ten-day inspection period. Do those terms work, and shall I text it now?'},{role:'user',message:'Yes, please text the agreement.'});
entries.push({role:'agent',message:'Let me prepare it.'},{role:'user',message:'Wait, I need my spouse to agree first.'});
assert.equal((await post({action:'confirm_and_send',confirmation},409)).reason,'acceptance_confirmation_required');
assert.equal(sends,0);assert.equal(texts,0,'late hesitation must block actual provider preparation, not just a parser check');
entries.splice(-2);
assert.equal((await post({action:'confirm_and_send',confirmation})).sent,true);
assert.equal((await post({action:'confirm_and_send',confirmation})).sent,true);
assert.equal(sends,1,'retries reuse the existing signing request');assert.equal(texts,2,'SMS service receives the same idempotent envelope key');
context.party='buyer';context.buyer={address,askingPriceCents:16200000,depositCents:200000,closingDate:confirmation.closingDate};
const buyerVersion=context.offerVersion,buyerResult=await post({action:'confirm_and_send',confirmation});
assert.equal(buyerResult.sent,false);assert.equal(buyerResult.reason,'buyer_assignment_team_required');assert.equal(context.offerVersion,buyerVersion);assert.equal(sends,1);assert.equal(texts,2,'buyer request cannot send a seller agreement or claim delivery');
console.log('PASS real route → saved acceptance → prepared no-EMD terms → one signing request → exact-recipient text, with stale provider GET and no live contacts.');

// Replay a provider-abandoned acceptance followed by the same requested send.
context.party='seller';context.offerState={};context.offerVersion=0;claim=undefined;envelopes=[];sends=0;texts=0;
terms={address,buyer:'Fixture buyer',state:'TX'};savedActions.length=0;
const replayQuote=await post({action:'get_offer'});
const replay=[{role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify(replayQuote)}]},
 {role:'agent',message:'Our cash offer is one hundred fifty-two thousand dollars. Does that fit?'},
 {role:'user',message:"Um, yeah, that fits. I want the closing date to be in 30 days from now. What's the next step?"},
 {role:'agent',message:'Your legal name?'},{role:'user',message:'Jane Seller.'},
 {role:'agent',message:'The agreed price, chosen closing date and prepared ten-day inspection period: should I text the agreement now?'},
 {role:'user',message:'Yes.'},{role:'user',message:'Text the agreement.'}];
for(const [extra,reason] of [["Wait, I need my spouse to approve first.",'acceptance_confirmation_required'],['No, do not send the agreement.','acceptance_confirmation_required'],['Yes, but I need $160,000.','acceptance_confirmation_required']]){
 entries=[...replay,{role:'user',message:extra}];assert.equal((await post({action:'confirm_and_send',confirmation},409)).reason,reason);assert.equal(sends,0);assert.equal(texts,0);
}
entries=replay;rejectAcceptance=true;
assert.equal((await post({action:'confirm_and_send',confirmation},409)).reason,'quote_changed');assert.equal(sends,0,'failed acceptance save cannot create an agreement');
rejectAcceptance=false;
assert.equal((await post({action:'confirm_and_send',confirmation:{...confirmation,agreedPriceCents:16000000}},409)).reason,'confirmed_price_required');assert.equal(sends,0);
assert.equal((await post({action:'confirm_and_send',confirmation})).sent,true);
assert(savedActions.includes('accept_offer'));assert.equal(context.offerState.acceptedPriceCents,15200000);
assert.equal((await post({action:'confirm_and_send',confirmation})).sent,true);assert.equal(sends,1,'recovery and retry share one signing request');
envelopes[0].state='needs_review';
assert.equal((await post({action:'confirm_and_send',confirmation},409)).sent,false);assert.equal(sends,1,'uncertain existing agreement cannot be replaced');
console.log('PASS interrupted acceptance recovery, withdrawal, counteroffer, failed save, exact price and duplicate agreement guards; no provider traffic.');
