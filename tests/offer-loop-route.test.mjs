import {instantCallAddress} from '../lib/meta-instant-call.ts';
import {boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
import {liveToolHistory} from '../lib/live-tool-history.ts';
import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {automaticCallOffer,blockedOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence} from '../lib/call-offer-evidence.ts';
import {sellerPayoffEvidence} from '../lib/seller-payoff.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {sellerRoutineOwnershipAnswer} from '../lib/seller-ownership-answer.ts';
import {sellerAgreementInput} from '../lib/seller-agreement-flow.ts';
import {sellerAgreementFailure} from '../lib/seller-agreement-service.ts';
import {object,sha} from '../lib/required-call-recording.ts';
const actual='So it needs a new roof. It is basically... Yeah, it just needs a new roof and new AC.';
let transcript={transcript:[{role:'agent',message:'What repairs or updates does the property need?'},{role:'user',message:actual}]},reads=0;
const observations=[],observed=[];
let finishObservation;
const observationPending=new Promise(resolve=>{finishObservation=resolve;});
const context={party:'seller',address:'45 Fixture Lane',offerState:{},offerVersion:0,snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Lane',estimated_value:127000,estimated_repair_cost:43960,is_free_and_clear:'Yes',total_estimated_loan_balance:0,estimated_equity_percentage:100}}}};
const forbidden=()=>assert.fail('This regression never contacts or signs for anyone');
const route=await loadService('app/api/internal/voice/cash-offer/route.ts',{
 instantCallAddress,dispatchTextMessage:()=>assert.fail('Unexpected intake text'),dispatchLiveVoice:()=>assert.fail('Unexpected intake call'),
 liveToolHistory,boundSellerQualification,NextResponse:{json:Response.json},after:callback=>observations.push(callback),process:{env:{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',DOCUSEAL_MODE:'live'}},
 db:async(path,method,b)=>{if(path==='rpc/icash_targeting_note_qualified'){observed.push(b);return observationPending;}if(path==='rpc/icash_call_offer_context')return structuredClone(context);assert.equal(path,'rpc/icash_save_call_offer');assert.equal(b.p_expected_version,context.offerVersion);context.offerState=b.p_state;context.offerVersion++;return true;},
 bindSellerAgreementCall:async()=>{},createRecordedReceptionProviders:()=>({conversation:async()=>{reads++;return {transcript:[...qualifiedSellerTurns,...transcript.transcript]};}}),
 callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence,sellerPayoffEvidence,sellerListingEvidence,sellerRoutineOwnershipAnswer,automaticCallOffer,blockedOffer,sellerAgreementInput,object,sha,sellerAgreementFailure,
 sellerAgreementAction:forbidden,sendForSignatures:forbidden,textPendingContract:forbidden,refreshSigning:forbidden,
});
const post=async body=>{const response=await route.POST(new Request('https://fixture.test/api/internal/voice/cash-offer',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({conversationId:'conv_fixture',...body})}));assert.equal(response.status,200);return response.json();};
const quote=await post({action:'update_repairs',sellerStatement:'Needs a new roof and new AC.',repairEstimateCents:null});
assert.equal(quote.quoteAllowed,true);assert.equal(quote.priceCents,3400000);assert.equal(context.offerState.sellerStatement,actual);assert.equal(reads,1);
assert.equal(observed.length,0,'the live response does not wait for reporting');
assert.equal(observations.length,1);
const observation=observations.shift()();
assert.deepEqual(observed,[{p_hash:sha('a'.repeat(64)),p_conversation:'conv_fixture',p_evidence_hash:sha(JSON.stringify({transcript:[...qualifiedSellerTurns,...transcript.transcript]}))}]);
finishObservation(true);await observation;
// Anonymized spoken sequence from the November 4 repeat-question incident.
transcript={transcript:[{role:'agent',message:'Is the property currently listed with a real estate agent?'},{role:'user',message:"No, it's not."}]};
const unlisted=await post({action:'report_change',sellerStatement:"No, it's not."});
assert.equal(unlisted.quoteAllowed,true);assert.equal(context.offerState.listedWithAgent,false);assert.equal(context.offerState.factsPending,undefined);
transcript.transcript.push({role:'agent',message:'Does anyone else own the property with you who would need to agree to sell?'},{role:'user',message:'No, um, no.'});
const coowner=await post({action:'report_change',sellerStatement:'No, um, no.'});
assert.equal(coowner.quoteAllowed,true);assert.equal(coowner.priceCents,3400000);assert.equal(context.offerState.factsPending,undefined);
const beforeHold=structuredClone(context.offerState);context.offerState.factsPending=true;
assert.equal((await post({action:'report_change',sellerStatement:'No, um, no.'})).quoteAllowed,false,'ordinary answers never erase a previous material hold');
assert.equal(context.offerState.factsPending,true);context.offerState=beforeHold;
transcript={transcript:[{role:'agent',message:'Is the property currently listed with a real estate agent?'},{role:'user',message:'Yes.'}]};
const listed=await post({action:'report_change',sellerStatement:'Yes, it is listed.'});assert.equal(listed.reason,'listed_with_agent');assert.equal(reads,5,'one provider transcript read per tool request');assert.equal((await post({action:'get_offer'})).quoteAllowed,false);

// A routine initial co-owner answer cannot turn a saved yes into a new price ask.
context.offerState=structuredClone(beforeHold);
transcript={transcript:[{role:'agent',message:'We can offer $34,000 cash as is. Does that work for you?'},{role:'user',message:'Yes, send the agreement.'}]};
const accepted=await post({action:'accept_offer',priceCents:unlisted.priceCents,quoteRevision:unlisted.quoteRevision});
assert.equal(accepted.status,'verbally_accepted');
transcript.transcript.push({role:'agent',message:'Does anyone else own the property with you who would need to agree to sell?'},{role:'user',message:'No.'});
const ownerAnswer=await post({action:'report_change',sellerStatement:'No.'});
assert.equal(ownerAnswer.status,'verbally_accepted');assert.equal(ownerAnswer.quoteRevision,accepted.quoteRevision);
assert.equal(context.offerState.acceptedPriceCents,3400000);
const savedAcceptance=structuredClone(context.offerState);
context.offerState.factsPending=true;
assert.equal((await post({action:'report_change',sellerStatement:'No.'})).quoteAllowed,false,'saved acceptance does not clear a material hold');
context.offerState=structuredClone(savedAcceptance);context.pendingAgreement={priceCents:3400000,closingDate:'2026-12-15'};
assert.equal((await post({action:'report_change',sellerStatement:'No.'})).reason,'issued_agreement_changed','issued agreement revisions remain blocked');
delete context.pendingAgreement;context.offerState=structuredClone(savedAcceptance);context.offerState.acceptanceConditional=true;
assert.notEqual((await post({action:'report_change',sellerStatement:'No.'})).status,'verbally_accepted','conditional acceptance is never upgraded by an ownership answer');
context.offerState=structuredClone(savedAcceptance);
transcript.transcript.push({role:'agent',message:'Has ownership changed?'},{role:'user',message:'There is another owner.'});
assert.equal((await post({action:'report_change',sellerStatement:'There is another owner.'})).quoteAllowed,false);
assert.equal(context.offerState.acceptedPriceCents,null,'actual ownership changes still clear acceptance');
await Promise.all(observations.map(callback=>callback()));
console.log('PASS real POST handler: deferred bound observation, full transcript recovery, rounded offer, accepted-price continuity, changed-fact and issued-agreement holds; zero external actions.');
