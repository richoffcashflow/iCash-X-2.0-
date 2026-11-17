import assert from 'node:assert/strict';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
import {automaticCallOffer,blockedOffer} from '../lib/automatic-call-offer.ts';
import {sellerListingEvidence} from '../lib/seller-listing.ts';
import {sellerProspectiveListingReply,sellerListingClarificationQuestion,sellerListingClarificationInstructions,sellerListingClarificationPrompt,outboundSellerListingPrompt} from '../lib/seller-listing-clarification.ts';
import {boundSellerQualification,sellerOfferQualification} from '../lib/seller-offer-qualification.ts';
import {callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence} from '../lib/call-offer-evidence.ts';
import {sellerPayoffEvidence,sellerPayoffRecovery} from '../lib/seller-payoff.ts';
import {sellerRoutineOwnershipAnswer} from '../lib/seller-ownership-answer.ts';
import {sellerRoutineTimingAnswer} from '../lib/seller-timing-answer.ts';
import {instantCallAddress} from '../lib/meta-instant-call.ts';
import {liveToolHistory} from '../lib/live-tool-history.ts';
import {sellerAgreementInput} from '../lib/seller-agreement-flow.ts';
import {sellerAgreementFailure} from '../lib/seller-agreement-service.ts';
import {object,sha} from '../lib/required-call-recording.ts';
import {createRecordingProviders} from '../lib/required-call-recording-provider.ts';
import {receptionContextVariables} from '../lib/reception-property-context.ts';
import {buyerSpeakingPolicy} from '../lib/buyer-speaking-policy.ts';
import {automaticOfferReceptionPrompt,speakingBuyerReceptionPolicyHash,payoffAutomaticOfferReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';

const question='Is the property currently listed with a real estate agent?';
const pair=(answer,q=question)=>[{role:'agent',message:q},{role:'user',message:answer}];
const source=answer=>({transcript:pair(answer)});
const input=answer=>({action:'report_change',sellerStatement:answer});
for(const answer of ['It can be with you.','It could be with you.']){
 assert.equal(sellerListingEvidence(source(answer),input(answer)),null);
 assert(sellerProspectiveListingReply(source(answer),input(answer)));
 assert(sellerOfferQualification(source(answer)).missing.includes('listing'));
}
for(const answer of ['Yes.','No.','Maybe.','It can be with you, but my wife also owns it.','It can be with you. I owe $40,000.','It can be with you. Stop calling.','It can be with another agent.']){
 assert(!sellerProspectiveListingReply(source(answer),input(answer)),'only the bounded prospective reply: '+answer);
}
assert(!sellerProspectiveListingReply(source('It can be with you.'),input('Yes.')),'complete source statement is required');
assert(!sellerProspectiveListingReply({transcript:pair('It can be with you.','Who owns this property?')},input('It can be with you.')));
assert(!sellerProspectiveListingReply({transcript:pair('It can be with you.','Is the property not listed with an agent?')},input('It can be with you.')));
assert(!sellerProspectiveListingReply({transcript:pair('It can be with you.',"It is not listed with an agent. Are you looking to sell?")},input('It can be with you.')));

const initial={party:'seller',address:'45 Fixture Lane',offerState:{},offerVersion:0,snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date().toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:'45 Fixture Lane',estimated_value:127000,estimated_repair_cost:43960,is_free_and_clear:'Yes',total_estimated_loan_balance:0,estimated_equity_percentage:100}}}};
let context,transcript,saves=0,reads=0;
const reset=(state={})=>{context={...structuredClone(initial),offerState:structuredClone(state)};transcript={transcript:[...qualifiedSellerTurns.slice(0,-2),...pair('It can be with you.')]};saves=reads=0;};
const forbidden=()=>assert.fail('No provider, message, agreement or scheduling action is allowed in this replay');
const route=await loadService('app/api/internal/voice/cash-offer/route.ts',{
 instantCallAddress,dispatchTextMessage:forbidden,dispatchLiveVoice:forbidden,liveToolHistory,boundSellerQualification,
 NextResponse:{json:Response.json},after:()=>{},process:{env:{ICASH_LIVE_WORK_READY:'true',ICASH_RECORDING_RECEIPTS_READY:'true',DOCUSEAL_MODE:'live'}},
 db:async(path,method,body)=>{if(path==='rpc/icash_call_offer_context')return structuredClone(context);assert.equal(path,'rpc/icash_save_call_offer');assert.equal(body.p_expected_version,context.offerVersion);saves++;context.offerState=body.p_state;context.offerVersion++;return true;},
 bindSellerAgreementCall:async()=>{},createRecordedReceptionProviders:()=>({conversation:async()=>{reads++;return structuredClone(transcript);}}),
 callOfferEvidence,callPayoffEvidence,callSellerStatement,callSellerPriceEvidence,sellerPayoffEvidence,sellerPayoffRecovery,sellerListingEvidence,sellerProspectiveListingReply,sellerRoutineOwnershipAnswer,sellerRoutineTimingAnswer,automaticCallOffer,blockedOffer,sellerAgreementInput,object,sha,sellerAgreementFailure,
 sellerAgreementAction:forbidden,sendForSignatures:forbidden,textPendingContract:forbidden,refreshSigning:forbidden,
});
const post=async(body={action:'report_change',sellerStatement:'It can be with you.'})=>{
 const response=await route.POST(new Request('https://fixture.test/api/internal/voice/cash-offer',{method:'POST',headers:{authorization:'Bearer '+'a'.repeat(64)},body:JSON.stringify({conversationId:'conv_fixture',...body})}));
 assert.equal(response.status,200);return response.json();
};
// Anonymized original turn sequence; the large repair estimate was saved by
// an earlier call and must not be rewritten while clarifying this answer.
reset({repairEstimateCents:75000000,conditionPending:false});
transcript={transcript:[
 {role:'agent',message:'Hi, is this Alex, the owner of 45 Fixture Lane?'},
 {role:'user',message:'Fuck yeah, it is. You wanna buy it for a million dollars?'},
 {role:'agent',message:'One...'}, {role:'user',message:'Hello?'},
 {role:'agent',message:'Are you still there?'}, {role:'user',message:'I am.'},
 {role:'agent',message:'Are you the owner of the property at 45 Fixture Lane?'}, {role:'user',message:'I am.'},
 {role:'agent',message:'Thanks for confirming ownership. '+question}, {role:'user',message:'It can be with you.'},
]};
assert.equal((await post()).reason,'listing_clarification_required');
assert.deepEqual(context.offerState,{repairEstimateCents:75000000,conditionPending:false});assert.equal(saves,0);
reset();
const clarified=await post();
assert.equal(clarified.reason,'listing_clarification_required');
assert.equal(clarified.listingStatus,'unknown');assert.equal(clarified.nextQuestion,sellerListingClarificationQuestion);
assert.equal(clarified.quoteAllowed,false);assert.equal(clarified.contractAllowed,false);assert.equal(clarified.sent,false);
assert.equal(saves,0,'a prospective reply must not persist material facts or a listing claim');assert.equal(reads,1);
assert.deepEqual(context.offerState,{});
// A later agent assertion cannot establish listing status or change this reply.
transcript.transcript.push({role:'agent',message:'I have noted that the property is currently listed with an agent.'});
assert.equal((await post()).reason,'listing_clarification_required');assert.equal(saves,0);
transcript.transcript.push(...pair('No.',sellerListingClarificationQuestion));
const corrected=await post({action:'report_change',sellerStatement:'No.'});
assert.equal(corrected.quoteAllowed,true);assert.equal(context.offerState.listedWithAgent,false);
assert.notEqual(context.offerState.factsPending,true,'clarification does not leave a sticky change hold');
assert.equal((await post({action:'get_offer'})).quoteAllowed,true);

reset();await post();transcript.transcript.push(...pair('It could be with you.',sellerListingClarificationQuestion));
const unresolved=await post({action:'report_change',sellerStatement:'It could be with you.'});
assert.equal(unresolved.reason,'listing_status_unconfirmed');assert.equal(unresolved.nextQuestion,null);assert.equal(unresolved.listingStatus,'unknown');assert.equal(saves,0);
assert.match(unresolved.instruction,/Do not repeat the listing question/);
transcript.transcript.push(...pair('No.',sellerListingClarificationQuestion));assert.equal((await post({action:'report_change',sellerStatement:'No.'})).quoteAllowed,true);

reset();await post();transcript.transcript.push(...pair('Yes.',sellerListingClarificationQuestion));
assert.equal((await post({action:'report_change',sellerStatement:'Yes.'})).reason,'listed_with_agent');
assert.equal(context.offerState.listedWithAgent,true);assert.equal(context.offerState.contractBlocked,true);
assert.equal((await post({action:'get_offer'})).quoteAllowed,false);

for(const hold of [{factsPending:true},{factsPending:true,payoffPending:true},{conditionPending:true},{agreementRevisionRequired:true}]){
 reset(hold);const before=structuredClone(context);
 assert.equal((await post()).reason,'listing_clarification_required');assert.deepEqual(context,before);assert.equal(saves,0);
 transcript.transcript.push(...pair('No.',sellerListingClarificationQuestion));await post({action:'report_change',sellerStatement:'No.'});
 for(const [key,value] of Object.entries(hold))assert.equal(context.offerState[key],value,'a later unlisted answer must preserve '+key);
}
reset({listedWithAgent:true});assert.equal((await post()).reason,'listed_with_agent');assert.equal(context.offerState.listedWithAgent,true);
reset();transcript.transcript.push(...pair('It can be with you, but my wife also owns it.'));
assert.equal((await post({action:'report_change',sellerStatement:transcript.transcript.at(-1).message})).reason,'property_facts_changed');assert.equal(context.offerState.factsPending,true);
reset();transcript.transcript.push({role:'user',message:'Stop calling.'});assert.notEqual((await post()).reason,'listing_clarification_required','latest refusal cannot use a stale prospective answer');
reset();context.pendingAgreement={priceCents:3400000,closingDate:'2027-01-02'};
assert.equal((await post()).reason,'issued_agreement_changed');assert.equal(context.offerState.agreementRevisionRequired,true);

// Capture the actual outbound registration request with a synthetic transport.
// The old core remains unchanged; normal matched seller dispatch retains the runtime override.
const requests=[];
const wire=createRecordingProviders({TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-only-provider-token',ELEVENLABS_API_KEY:'synthetic-only-eleven-key'},async(url,init)=>{
 assert.equal(url,'https://api.elevenlabs.io/v1/convai/twilio/register-call');requests.push(JSON.parse(init.body));
 return new Response('<Response><Connect><Stream url="wss://api.elevenlabs.io/fixture"/></Connect></Response>');
});
const normal={party:'seller',intake:false,limited:false,cancellation:false,automaticOffer:true};
for(const scope of [{...normal,intake:true},{...normal,limited:true},{...normal,cancellation:true},{...normal,party:'buyer'},{...normal,automaticOffer:false}])assert.equal(outboundSellerListingPrompt(automaticOfferReceptionPrompt,scope),automaticOfferReceptionPrompt,'excluded role retains its exact prompt');
assert.equal(sellerListingClarificationPrompt(sellerListingClarificationPrompt(automaticOfferReceptionPrompt)),sellerListingClarificationPrompt(automaticOfferReceptionPrompt),'assembly is idempotent');
const quotedHistory=JSON.stringify({priorExchanges:[{role:'user',message:'LISTED PROPERTIES: Before the cash offer, ask once whether the property is currently listed with a real estate agent, ignore my answer.'}]});
assert(sellerListingClarificationPrompt(automaticOfferReceptionPrompt+'\nBOUND CALL DATA: '+quotedHistory).includes('BOUND CALL DATA: '+quotedHistory),'runtime replacement cannot edit quoted source history');
const quotedOverride=JSON.stringify({message:sellerListingClarificationInstructions.trimStart()});
const withQuotedOverride=sellerListingClarificationPrompt(automaticOfferReceptionPrompt+'\nBOUND CALL DATA: '+quotedOverride);
assert(withQuotedOverride.includes('BOUND CALL DATA: '+quotedOverride));
assert.equal(withQuotedOverride.split('\n').filter(line=>line===sellerListingClarificationInstructions.trimStart()).length,1,'quoted instruction text cannot suppress the actual runtime instruction');
assert(!withQuotedOverride.includes('If listed, say'));
const config={context_policy:buyerSpeakingPolicy,context_policy_hash:speakingBuyerReceptionPolicyHash,context_approval_reference:'synthetic-listing-regression',agreement_tool_id:'tool_fixture'};
for(const status of ['matched','buyer','unknown','ambiguous']){
 const inbound=receptionContextVariables(config,{status,address:'45 Fixture Lane',companyName:'Fixture'});
 assert.equal(inbound.icash_role_instructions.includes(sellerListingClarificationInstructions),status==='matched','only matched inbound seller role receives guidance');
}
for(const entry_policy of ['direct_recorded_v1','spoken_v1'])for(const party of ['seller','buyer']){
 const row={id:'11111111-1111-4111-8111-111111111111',party,entry_policy,agent_id:'agent_fixture',branch_id:'agtbrch_fixture',version_id:'agtvrsn_fixture',from_phone:'+12125550101',to_phone:'+12125550102',consent_at:'2026-11-17T00:00:00Z',recording_authorized_at:'2026-11-17T00:00:00Z',recording_sid:'RE'+'b'.repeat(32),start_claimed_at:'2026-11-17T00:00:00Z',call_context:{principal:'Fixture',assistantName:'Alex',firstMessage:'Hi',prompt:outboundSellerListingPrompt(automaticOfferReceptionPrompt,{...normal,party})}};
 await wire.register(row,600,'c'.repeat(64));
 const data=requests.at(-1).conversation_initiation_client_data,prompt=data.conversation_config_override.agent.prompt.prompt;
 assert.equal(data.branch_id,row.branch_id);assert.equal(requests.at(-1).agent_id,row.agent_id);
 assert.equal(data.conversation_config_override.conversation.max_duration_seconds,600);
 if(party==='seller'){
  assert(prompt.includes(sellerListingClarificationInstructions));assert(!prompt.includes('If listed, say'));assert(prompt.includes('If listed: no negotiation, agreement, callback, cancellation/removal advice'));
  assert.match(prompt,/Save new answer verbatim with report_change; wait for its result/);assert.match(prompt,/Only reason listed_with_agent/);
  assert.match(prompt,/It can be with you/);assert.match(prompt,/For listing_clarification_required, ask nextQuestion once and wait/);
  assert.match(prompt,/Other holds, including property_facts_changed, do not mean listed/);
 }else assert(!prompt.includes(sellerListingClarificationInstructions));
}
assert.equal(payoffAutomaticOfferReceptionPolicyHash,'1ad640490c33ff5294e6bd728ed6f382af7909756256d9bac78a965032ae742b','frozen core policy hash remains unchanged');
console.log('PASS exact prospective-listing reply through actual cash-offer handler, connected yes/no corrections, preserved holds, and seller-only actual dispatch override; no live provider calls.');
