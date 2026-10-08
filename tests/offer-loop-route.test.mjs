import {liveToolHistory} from '../lib/live-tool-history.ts';
import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {automaticCallOffer,blockedOffer} from '../lib/automatic-call-offer.ts';
import {callOfferEvidence,callPayoffEvidence,callSellerStatement} from '../lib/call-offer-evidence.ts';
import {sellerPayoffEvidence} from '../lib/seller-payoff.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {sellerAgreementInput} from '../lib/seller-agreement-flow.ts';
import {sellerAgreementFailure} from '../lib/seller-agreement-service.ts';
import {object} from '../lib/required-call-recording.ts';
const actual='So it needs a new roof. It is basically... Yeah, it just needs a new roof and new AC.';
let transcript={transcript:[{role:'agent',message:'What repairs or updates does the property need?'},{role:'user',message:actual}]},reads=0;
const context={party:'seller',address:'45 Fixture Lane',offerState:{},offerVersion:0,snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Lane',estimated_value:127000,estimated_repair_cost:43960,is_free_and_clear:'Yes',total_estimated_loan_balance:0,estimated_equity_percentage:100}}}};
const forbidden=()=>assert.fail('This regression never contacts or signs for anyone');
const route=await loadService('app/api/internal/voice/cash-offer/route.ts',{
 liveToolHistory,NextResponse:{json:Response.json},process:{env:{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',DOCUSEAL_MODE:'live'}},
 db:async(path,method,b)=>{if(path==='rpc/icash_call_offer_context')return structuredClone(context);assert.equal(path,'rpc/icash_save_call_offer');assert.equal(b.p_expected_version,context.offerVersion);context.offerState=b.p_state;context.offerVersion++;return true;},
 bindSellerAgreementCall:async()=>{},createRecordedReceptionProviders:()=>({conversation:async()=>{reads++;return transcript;}}),
 callOfferEvidence,callPayoffEvidence,callSellerStatement,sellerPayoffEvidence,sellerListingEvidence,automaticCallOffer,blockedOffer,sellerAgreementInput,object,sellerAgreementFailure,
 sellerAgreementAction:forbidden,sendForSignatures:forbidden,textPendingContract:forbidden,refreshSigning:forbidden,
});
const post=async body=>{const response=await route.POST(new Request('https://fixture.test/api/internal/voice/cash-offer',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({conversationId:'conv_fixture',...body})}));assert.equal(response.status,200);return response.json();};
const quote=await post({action:'update_repairs',sellerStatement:'Needs a new roof and new AC.',repairEstimateCents:null});
assert.equal(quote.quoteAllowed,true);assert.equal(quote.priceCents,4812800);assert.equal(context.offerState.sellerStatement,actual);assert.equal(reads,1);
transcript={transcript:[{role:'agent',message:'Is the property currently listed with a real estate agent?'},{role:'user',message:'Yes.'}]};
const listed=await post({action:'report_change',sellerStatement:'Yes, it is listed.'});assert.equal(listed.reason,'listed_with_agent');assert.equal(reads,2,'one provider transcript read per tool request');assert.equal((await post({action:'get_offer'})).quoteAllowed,false);
console.log('PASS real POST handler: provider null request, full transcript recovery, exact $48,128, persisted listing stop, zero external actions.');
