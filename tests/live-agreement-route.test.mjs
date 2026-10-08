import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {liveToolHistory} from '../lib/live-tool-history.ts';
import {automaticCallOffer,blockedOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence,callPayoffEvidence,callSellerStatement} from '../lib/call-offer-evidence.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {sellerPayoffEvidence} from '../lib/seller-payoff.ts';
import {sellerAgreementInput} from '../lib/seller-agreement-flow.ts';
import {sellerAgreementAction,sellerAgreementFailure} from '../lib/seller-agreement-service.ts';
import {object} from '../lib/required-call-recording.ts';
const address='45 Fixture Lane',now=Date.now();
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,legal_description:'Lot 1 block 2',estimated_value:127000,estimated_repair_cost:43960,is_free_and_clear:'Yes',total_estimated_loan_balance:0,estimated_equity_percentage:100}}};
const context={party:'seller',address,offerState:{},offerVersion:0,snapshot},scope={callKey:'fixture',accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.test',dealId:'deal',screeningId:'screen',phone:'+12125550199'};
let terms={address,buyer:'Fixture buyer',state:'TX'},claim,envelopes=[],sends=0,texts=0;
const db=async(path,method,b)=>{
 if(path==='rpc/icash_call_offer_context')return structuredClone(context);
 if(path==='rpc/icash_save_call_offer'){assert.equal(b.p_expected_version,context.offerVersion);context.offerState=b.p_state;context.offerVersion++;return true;}
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
 liveToolHistory,NextResponse:{json:Response.json},process:{env:{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',DOCUSEAL_MODE:'live'}},db,
 bindSellerAgreementCall:async()=>{},createRecordedReceptionProviders:()=>({conversation:async()=>assert.fail('The live tool history must work even when a provider GET is stale')}),
 callOfferEvidence,callPayoffEvidence,callSellerStatement,sellerPayoffEvidence,sellerListingEvidence,automaticCallOffer,blockedOffer,sellerAgreementInput,object,sellerAgreementFailure,sellerAgreementAction,
 sendForSignatures:async i=>{sends++;assert.equal(i.signers[0].phone,scope.phone);assert.equal(terms.priceCents,4812800);assert.equal(terms.earnestCents,null);envelopes=[{id:'envelope',state:'awaiting_counterparty',test_mode:false,terms,recipients:[i.signers[0],{name:'Fixture buyer'}]}];return {id:'envelope',testMode:false};},
 textPendingContract:async(account,id,phone)=>{texts++;assert.deepEqual([account,id,phone],['account','envelope',scope.phone]);return {sent:true,status:'accepted'};},refreshSigning:async()=>({status:'awaiting_counterparty'}),
});
let entries=[];
const post=async body=>{const r=await route.POST(new Request('https://fixture.test/api/internal/voice/cash-offer',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({conversationId:'conv_fixture',conversationHistory:JSON.stringify({'x-elevenlabs-history':true,entries}),...body})}));assert.equal(r.status,200);return r.json();};
const quoted=await post({action:'get_offer'});assert.equal(quoted.priceCents,4812800);
entries=[{role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify(quoted)}]},{role:'agent',message:'Our cash offer is $48,128. Does that work?'},{role:'user',message:'Yes, it works.'},{role:'agent',message:'What is your legal name?'},{role:'user',message:'Jane Seller.'}];
assert.equal((await post({action:'accept_offer',priceCents:4812800,quoteRevision:quoted.quoteRevision})).status,'verbally_accepted');
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:4812800,closingDate:new Date(now+30*86400000).toISOString().slice(0,10),soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'yes',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
entries.push({role:'agent',message:'The price is $48,128, closing '+confirmation.closingDate+' with the prepared ten-day inspection period. Do those terms work, and shall I text it now?'},{role:'user',message:'Yes, please text the agreement.'});
assert.equal((await post({action:'confirm_and_send',confirmation})).sent,true);
assert.equal((await post({action:'confirm_and_send',confirmation})).sent,true);
assert.equal(sends,1,'retries reuse the existing signing request');assert.equal(texts,2,'SMS service receives the same idempotent envelope key');
console.log('PASS real route → saved acceptance → prepared no-EMD terms → one signing request → exact-recipient text, with stale provider GET and no live contacts.');
