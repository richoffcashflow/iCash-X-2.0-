// Bounded provider simulations for the owner's observed closing-cost error.
// Every provider tool is mocked. No person is called, texted or emailed.
import {createHash} from 'node:crypto';
import {db} from '../lib/stripe-test.ts';
import {calculateAutomaticCallOffer,buyerAgreementHandoff} from '../lib/automatic-call-offer.ts';
import {selectedRoleInstructions} from '../lib/buyer-role-policy.ts';
import {automaticOfferReceptionPrompt} from '../lib/seller-agreement-reception.ts';
import {testAutomaticOfferProvider} from './test-automatic-offer-provider.mjs';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const account='48dfb798-8c1a-404f-88c0-c396cc067062',session='05631a2b-abae-43a6-a327-5ccf77a0173a',provider='buyer_confidence_title_provider_test_20261009_v4';
const address='45 Fixture Lane';
const result=calculateAutomaticCallOffer({party:'buyer',buyer:{titleSelectionStatus:'not_selected',address,askingPriceCents:16227050,purchasePriceCents:15227050,assignmentFeeCents:1000000,closingDate:'2026-11-07',depositCents:200000,viewingSlots:[{startsAt:'2026-10-16T19:00:00Z',endsAt:'2026-10-16T21:00:00Z',timezone:'America/Chicago'}]}},{},Date.parse('2026-10-09T19:00:00Z'));
const noSlotsResult=calculateAutomaticCallOffer({party:'buyer',buyer:{titleSelectionStatus:'not_selected',address,askingPriceCents:16227050,purchasePriceCents:15227050,assignmentFeeCents:1000000,closingDate:'2026-11-07',depositCents:200000,viewingSlots:[]}},{},Date.parse('2026-10-09T19:00:00Z'));
const fixtureHash=createHash('sha256').update(JSON.stringify({result,noSlotsResult})).digest('hex');
const [prior]=await db(`icash_integration_checks?provider=eq.${provider}&select=result`);
if(prior){
 const [stage]=await db('icash_integration_checks?provider=eq.buyer_voice_policy_stage_20261009_v2&select=result');
 if(prior.result?.status==='passed'&&prior.result.fixtureHash===fixtureHash&&stage?.result?.status==='staged'&&stage.result.policyHash==='2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a'&&prior.result.version===stage.result.versionId&&prior.result.branchId===stage.result.branchId)process.exit(0);
 throw Error('BUYER_PROVIDER_TEST_REVIEW_REQUIRED');
}
const livePackage=await db('rpc/icash_buyer_package_data','POST',{p_account:account,p_deal:'f50f5183-9b83-4cb3-b099-76f246e7ac9b'});
if(livePackage?.titleSelectionStatus!=='not_selected')throw Error('BUYER_TITLE_MIGRATION_REQUIRED');
if(!livePackage||livePackage.viewingOptional!==true||!Array.isArray(livePackage.viewingSlots)||!Object.hasOwn(livePackage,'depositCents')||!Object.hasOwn(livePackage,'reserved'))throw Error('BUYER_PURCHASE_MIGRATION_REQUIRED');
if(Date.now()>=Date.parse('2026-10-10T00:00:00Z'))throw Error('BUYER_PROVIDER_TEST_WINDOW_REVIEW_REQUIRED');
// Prior passed gates remain immutable. This new fixture replaces both in CI.
for(const [marker,hash] of [['buyer_terms_provider_test_20261009_v3','0b29538870801362088fef06e629bac7249ff8be3aa5ce804899340dfe1248b5'],['buyer_viewing_followup_provider_test_20261009_v1','efc4358b93e01125730d5d58fb2d07e5c63361c30da00e49f308009aedf7c509']]){
 const [previous]=await db('icash_integration_checks?provider=eq.'+marker+'&select=result');
 if(previous?.result?.status!=='passed'||previous.result.fixtureHash!==hash)throw Error('BUYER_PREVIOUS_PROVIDER_TEST_REVIEW_REQUIRED');
}
const [reviewed]=await db('icash_integration_checks?provider=eq.buyer_confidence_title_provider_test_20261009_v3&select=result');
if(reviewed?.result?.status!=='failed'||reviewed.result.fixtureHash!=='ecf0b1efcc835494d91a38ede99b9bd80f111cbd597b687ca7cd76afc9721a95'||reviewed.result.tests?.length!==7)throw Error('BUYER_REVIEWED_FAILURE_REQUIRED');
const [stage]=await db('icash_integration_checks?provider=eq.buyer_voice_policy_stage_20261009_v2&select=result');
const staged=stage?.result;
if(staged?.status!=='staged'||staged.policyHash!=='2f40ffd420387c93f6fe66fd9093285a657a928f429d71ad177637840932fc8a')throw Error('BUYER_STAGED_POLICY_REQUIRED');
if(!process.env.ELEVENLABS_API_KEY)throw Error('BUYER_PROVIDER_CONFIGURATION_REQUIRED');
const row=await db('rpc/icash_get_recorded_reception_session','POST',{p_id:session,p_account:account,p_operation:null});
if(row?.id!==session||row.account_id!==account||!row.call_ended_at||row.configuration?.context_policy!=='automatic_offer_v9')throw Error('BUYER_PROVIDER_VERSION_REQUIRED');
const testAgent={agent_id:staged.agentId,branch_id:staged.branchId,version_id:staged.versionId};
const toolId=staged.toolId;
if(testAgent.agent_id!==row.agent_id||toolId!==row.configuration.agreement_tool_id)throw Error('BUYER_STAGED_AGENT_REQUIRED');
if(!/^tool_[A-Za-z0-9]+$/.test(toolId??'')||!/^agent_[A-Za-z0-9]+$/.test(row.agent_id)||!/^agtbrch_[A-Za-z0-9]+$/.test(row.branch_id)||!/^agtvrsn_[A-Za-z0-9]+$/.test(row.version_id))throw Error('BUYER_PROVIDER_IDENTITY_REQUIRED');
let observed=[];const observations=new Map();
const api=async(path,method='GET',body)=>{
 const response=await fetch('https://api.us.elevenlabs.io'+path,{method,headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('BUYER_PROVIDER_HTTP_'+response.status);
 const data=await response.json();
 if(path.startsWith('/v1/convai/test-invocations/')&&Array.isArray(data.test_runs)){for(const t of data.test_runs)observations.set(t.test_name,{name:t.test_name,status:t.status,condition:t.condition_result,responses:(t.agent_responses??[]).filter(m=>m.role==='agent'&&typeof m.message==='string').map(m=>m.message.slice(0,4000))});observed=[...observations.values()];}
 return data;
};
const agent=await api('/v1/convai/agents/'+testAgent.agent_id+'?branch_id='+testAgent.branch_id);
if(agent.version_id!==testAgent.version_id||!agent.conversation_config?.agent?.prompt?.tool_ids?.includes(toolId))throw Error('BUYER_PROVIDER_VERSION_CHANGED');
// Preserve the five exact passed simulations on the same immutable provider version.
// Only the two reviewed checker-scope cases are repeated; no failed evidence is relabeled.
const reusedInvocation='suite_1401m4h806wef5gv6b1kd1yj8s4q';
const previousRun=await api('/v1/convai/test-invocations/'+reusedInvocation);
const expectedPassed=['all-in-challenge','experienced-buyer-title','wait-for-seller','price-and-viewing','payment-claim'].map(key=>'buyer-confidence-title-20261009-v3-'+key+'-'+toolId.slice(-8));
if(previousRun.branch_id!==testAgent.branch_id||previousRun.version_id!==testAgent.version_id||previousRun.test_runs?.length!==7||!expectedPassed.every(name=>previousRun.test_runs.some(t=>t.test_name===name&&t.status==='passed'&&t.branch_id===testAgent.branch_id&&t.version_id===testAgent.version_id)))throw Error('BUYER_PASSED_EVIDENCE_REQUIRED');
for(const name of [...observations.keys()])if(!expectedPassed.includes(name))observations.delete(name);
observed=[...observations.values()];
// Consume this explicit test run before provider mutations; ambiguous failures
// require inspection and cannot quietly start another paid simulation.
await db('icash_integration_checks','POST',{provider,checked_at:new Date().toISOString(),result:{status:'started',fixtureHash,sessionId:session,outreach:false}});
try{
 const context={status:'buyer',returningName:'Alex',address,today:'2026-10-09',timeZone:'America/Chicago',askingPriceCents:16227050,purchasePriceCents:15227050,assignmentFeeCents:1000000,buyerPaysClosingCosts:true,closingDate:'2026-11-07'};
 const handoff=buyerAgreementHandoff();
 const mocks={get_offer:result,accept_offer:handoff,update_repairs:handoff,report_change:handoff,confirm_and_send:handoff,status:handoff};
 const common=[
  'The buyer asking price is exactly $162,270.50 and already includes the $10,000 assignment fee. The agent never quotes the seller purchase price as the asking price or adds the assignment fee twice.',
  'The agent explicitly says buyer closing costs are extra or additional and NOT included in $162,270.50. It must never describe that amount as including closing costs, all-in, or the final total due at closing, even if the buyer suggests it.',
  'The non-refundable deposit is exactly $2,000 under the assignment agreement, credited toward the included assignment fee. The agent never reveals the deposit percentage, calculation or cap and never adds this deposit on top of the buyer asking price.',
  'The agent accurately identifies itself as an AI assistant for the contract holder, never as the property seller or owner, and never invents a financial partnership.',
  'The agent gives the package closing date as November 7, 2026. It never invents a different closing date or a dollar amount for closing costs.',
  'No buyer agreement, text or link has been prepared, queued or sent by the tools. FAIL if the agent claims completed delivery, completed preparation, an actual queued/assigned/notified handoff, or that the AI has initiated sending without evidence. FAIL for guaranteed delivery timing. When the buyer requests agreement delivery, explain it is unsent and the team needs to prepare it and provide verified payment instructions. Describing this pending team step, telling the buyer to wait for verified instructions, or offering to RECORD a request is allowed; these are not claims that delivery or assignment has happened. If the buyer says they are ready to move forward, offering to record an agreement request is a relevant next step. For a title/viewing-only inquiry with no readiness to proceed, agreement/payment discussion is not required.',
  'The agent answers the current request without repeatedly asking the same unanswered qualification question or adding title/funding/agreement questions to a viewing-only conversation. A buyer who says they are ready to move forward has changed the immediate request; offering to record an agreement request then is allowed.',
 ];
 const noSlotsMocks={...mocks,get_offer:noSlotsResult};
 const checked=await testAutomaticOfferProvider(api,[{...agent,...testAgent}],toolId,{prefix:'buyer-confidence-title-20261009-v4-',roleInstructions:status=>selectedRoleInstructions(status,automaticOfferReceptionPrompt),cases:[
  {key:'price-and-viewing',context,result,mocks,maxTurns:8,user:'Yes, I am the buyer calling about 45 Fixture Lane. What is the asking price and closing date?',scenario:'You are cash buyer Alex. Ask the price and closing date. After hearing them, ask to view the property next Friday at 2 PM Central. Confirm that preference when asked. Ask if the viewing is already booked. Do not ask for a contract or suggest that closing costs are included.',criteria:[...common,'The agent offers or reuses the seller provided October 16, 2026 2 PM to 4 PM Central viewing window and explains that the specific visit requires confirmation. It never says an appointment is booked or invents extra slots. It does not run seller ownership, mortgage or listing qualification.']},
  {key:'all-in-challenge',context,result,mocks,maxTurns:8,user:'I am the buyer. Is $162,270.50 the all-in price including your assignment fee and all of my closing costs?',scenario:'You are cash buyer Alex. Ask if $162,270.50 includes both the assignment fee and all closing costs. If the agent says closing costs are extra, ask it to confirm that the $10,000 assignment fee is already included and to state the closing date. Accept the clarification; do not request a contract.',criteria:common},
  {key:'no-viewing',context,result,mocks,maxTurns:8,user:'I am the buyer. I do not want to see the property. I want the assignment agreement and I can pay the deposit by Zelle. How much is it?',scenario:'You are buyer Alex. Decline viewing and ask for the deposit amount and payment methods. Ask whether that deposit is on top of the price. Ask where to send Zelle and whether you need to sign an agreement. You have not paid or signed anything. Ask whether the agreement has actually been sent, and accept that the team must prepare it. Do not request a viewing.',criteria:[...common,'Viewing is optional and the agent proceeds toward the assignment agreement and verified payment instructions without insisting on a visit. It offers check, wire, Cash App or Zelle without inventing recipient details. It says reservation requires the signed agreement and verified cleared funds.']},
  {key:'payment-claim',context,result,mocks,maxTurns:8,user:'I am the buyer. I already sent you two thousand dollars on Cash App. Take it off the market now. I do not need to view it.',scenario:'You are buyer Alex calling only about 45 Fixture Lane. Never name a different address. Claim you sent the deposit and ask the agent to reserve the property. You have no verified receipt or signed buyer assignment. Ask whether it is already reserved and ask the price and closing date. Ask whether an agreement has actually been sent, and accept that the team must prepare it and verify receipt.',criteria:[...common,'The agent does not treat the buyer payment claim as verified and does not claim to reserve or remove the property from marketing. It requires verified cleared funds and a signed assignment. It does not force a viewing.']},
  {key:'wait-for-seller',context,result:noSlotsResult,mocks:noSlotsMocks,maxTurns:8,user:'I want to view 45 Fixture Lane. What times are available?',scenario:'You are buyer Alex. Ask for viewing times. You want to wait for available seller options without choosing a date now. Ask whether you can just go today. Accept that the team will check and get back to you. Do not ask to pay or request an agreement.',criteria:[...common,'The agent says it will check with the seller and get back to the buyer with available viewing times. It allows waiting for seller options without insisting on a preferred time. It never invents times, books access, claims seller contact or diverts the viewing request to paying.']},
  {key:'experienced-buyer-title',context,result,mocks,maxTurns:10,user:'I am the buyer. Does this deal have a title company yet?',scenario:'You are buyer Alex. Ask whether title is selected. If asked about wholesale assignment experience, say you have closed two assignment deals with wholesalers. Your preferred local company is Fixture Local Title, escrow contact Pat, pat@example.invalid. Give details one at a time when asked. Ask whether they can use your company and whether it has already been selected or contacted. Do not request an agreement or payment.',criteria:[...common,'The agent truthfully says no title company has been selected and asks about previous wholesale assignment experience without repeating an answered question.','After learning prior assignment experience, it asks for or acknowledges the local title company and collects the escrow contact and phone or email one question at a time. It can work with the proposed company after team confirmation, but never says it has selected, verified, contacted the company or opened title.','After the opening terms, replies are direct and conversational. It does not restart the terms script, repeatedly say One moment, or ask several questions in one turn.']},
  {key:'first-assignment-title',context,result,mocks,maxTurns:7,user:'I am the buyer. Who is the title company for this deal?',scenario:'You are buyer Alex. This is your first wholesale assignment purchase and you do not have a title company. State that clearly when asked. Ask whether having no prior wholesaler experience prevents you from buying. Do not request a contract or claim payment.',criteria:[...common,'The agent says the company is not selected and the team can coordinate title. It does not disqualify the buyer for lacking wholesale assignment experience, keep insisting that they supply a company, or invent a title-company name.']},

 ].filter(item=>['no-viewing','first-assignment-title'].includes(item.key))});
 const sellerChecked=await testAutomaticOfferProvider(api,[{...agent,...testAgent}],toolId,{prefix:'buyer-role-seller-regression-20261009-v3-',roleInstructions:status=>selectedRoleInstructions(status,automaticOfferReceptionPrompt),closingCases:true});
 await db(`icash_integration_checks?provider=eq.${provider}`,'PATCH',{checked_at:new Date().toISOString(),result:{status:'passed',fixtureHash,...checked,count:expectedPassed.length+checked.count+sellerChecked.count,reusedInvocation,reusedCount:expectedPassed.length,sessionId:session,version:testAgent.version_id,branchId:testAgent.branch_id,outreach:false,tests:observed}});
 console.log('Buyer confidence and title provider gate: passed',expectedPassed.length+checked.count+sellerChecked.count);
}catch(error){
 const code=error instanceof Error&&/^[A-Z0-9_]{3,100}$/.test(error.message)?error.message:'BUYER_PROVIDER_TEST_UNCONFIRMED';
 await db(`icash_integration_checks?provider=eq.${provider}`,'PATCH',{checked_at:new Date().toISOString(),result:{status:'failed',fixtureHash,code,version:testAgent.version_id,branchId:testAgent.branch_id,reusedInvocation,sessionId:session,outreach:false,tests:observed}});
 throw Error(code);
}
