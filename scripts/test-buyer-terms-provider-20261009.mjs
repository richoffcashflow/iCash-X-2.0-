// Bounded provider simulations for the owner's observed closing-cost error.
// Every provider tool is mocked. No person is called, texted or emailed.
import {createHash} from 'node:crypto';
import {db} from '../lib/stripe-test.ts';
import {calculateAutomaticCallOffer,buyerAgreementHandoff} from '../lib/automatic-call-offer.ts';
import {testAutomaticOfferProvider} from './test-automatic-offer-provider.mjs';
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const account='48dfb798-8c1a-404f-88c0-c396cc067062',session='05631a2b-abae-43a6-a327-5ccf77a0173a',provider='buyer_terms_provider_test_20261009_v3';
const address='45 Fixture Lane';
const result=calculateAutomaticCallOffer({party:'buyer',buyer:{address,askingPriceCents:16227050,purchasePriceCents:15227050,assignmentFeeCents:1000000,closingDate:'2026-11-07',depositCents:200000,viewingSlots:[{startsAt:'2026-10-16T19:00:00Z',endsAt:'2026-10-16T21:00:00Z',timezone:'America/Chicago'}]}},{},Date.parse('2026-10-09T19:00:00Z'));
const fixtureHash=createHash('sha256').update(JSON.stringify(result)).digest('hex');
const livePackage=await db('rpc/icash_buyer_package_data','POST',{p_account:account,p_deal:'f50f5183-9b83-4cb3-b099-76f246e7ac9b'});
if(!livePackage||livePackage.viewingOptional!==true||!Array.isArray(livePackage.viewingSlots)||!Object.hasOwn(livePackage,'depositCents')||!Object.hasOwn(livePackage,'reserved'))throw Error('BUYER_PURCHASE_MIGRATION_REQUIRED');
const [prior]=await db(`icash_integration_checks?provider=eq.${provider}&select=result`);
if(prior){
 if(prior.result?.status==='passed'&&prior.result.fixtureHash===fixtureHash)process.exit(0);
 throw Error('BUYER_PROVIDER_TEST_REVIEW_REQUIRED');
}
if(Date.now()>=Date.parse('2026-10-10T00:00:00Z'))throw Error('BUYER_PROVIDER_TEST_WINDOW_REVIEW_REQUIRED');
const [previous]=await db('icash_integration_checks?provider=eq.buyer_terms_provider_test_20261009_v1&select=result');
if(previous?.result?.status!=='passed'||previous.result.fixtureHash!=='c73df6f091dd4f96fc9cdd0986810cdb043be7d16495ddd081ee8c21728a454b')throw Error('BUYER_PREVIOUS_PROVIDER_TEST_REVIEW_REQUIRED');
// One reviewed correction of the terminal v2 run; never reset or replay it.
const [reviewed]=await db('icash_integration_checks?provider=eq.buyer_terms_provider_test_20261009_v2&select=result');
if(reviewed?.result?.status!=='failed'||reviewed.result.fixtureHash!=='03d8766fd5f6033a7e8b2478c93549229946ff027112498864f0fbf7eb10e180'||reviewed.result.code!=='AUTOMATIC_OFFER_PROVIDER_TESTS_REQUIRED'||reviewed.result.tests?.length!==4||!reviewed.result.tests.every(t=>t.status==='failed'))throw Error('BUYER_REVIEWED_FAILURE_REQUIRED');
if(!process.env.ELEVENLABS_API_KEY)throw Error('BUYER_PROVIDER_CONFIGURATION_REQUIRED');
const row=await db('rpc/icash_get_recorded_reception_session','POST',{p_id:session,p_account:account,p_operation:null});
if(row?.id!==session||row.account_id!==account||!row.call_ended_at||row.configuration?.context_policy!=='automatic_offer_v9')throw Error('BUYER_PROVIDER_VERSION_REQUIRED');
const toolId=row.configuration.agreement_tool_id;
if(!/^tool_[A-Za-z0-9]+$/.test(toolId??'')||!/^agent_[A-Za-z0-9]+$/.test(row.agent_id)||!/^agtbrch_[A-Za-z0-9]+$/.test(row.branch_id)||!/^agtvrsn_[A-Za-z0-9]+$/.test(row.version_id))throw Error('BUYER_PROVIDER_IDENTITY_REQUIRED');
let observed=[];
const api=async(path,method='GET',body)=>{
 const response=await fetch('https://api.us.elevenlabs.io'+path,{method,headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('BUYER_PROVIDER_HTTP_'+response.status);
 const data=await response.json();
 if(path.startsWith('/v1/convai/test-invocations/')&&Array.isArray(data.test_runs))observed=data.test_runs.map(t=>({name:t.test_name,status:t.status,condition:t.condition_result,responses:(t.agent_responses??[]).filter(m=>m.role==='agent'&&typeof m.message==='string').map(m=>m.message.slice(0,4000))}));
 return data;
};
const agent=await api('/v1/convai/agents/'+row.agent_id+'?branch_id='+row.branch_id);
if(agent.version_id!==row.version_id||!agent.conversation_config?.agent?.prompt?.tool_ids?.includes(toolId))throw Error('BUYER_PROVIDER_VERSION_CHANGED');
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
  'No buyer agreement, text or link has been prepared, queued or sent by the tools. The agent must not claim delivery or promise to send it itself. When agreement delivery is discussed, it explains that the team must prepare the buyer assignment and verified payment instructions.',
 ];
 const checked=await testAutomaticOfferProvider(api,[{...agent,agent_id:row.agent_id,branch_id:row.branch_id,version_id:row.version_id}],toolId,{prefix:'buyer-terms-20261009-v3-',cases:[
  {key:'price-and-viewing',context,result,mocks,maxTurns:8,user:'Yes, I am the buyer calling about 45 Fixture Lane. What is the asking price and closing date?',scenario:'You are cash buyer Alex. Ask the price and closing date. After hearing them, ask to view the property next Friday at 2 PM Central. Confirm that preference when asked. Ask if the viewing is already booked. Do not ask for a contract or suggest that closing costs are included.',criteria:[...common,'The agent offers or reuses the seller provided October 16, 2026 2 PM to 4 PM Central viewing window and explains that the specific visit requires confirmation. It never says an appointment is booked or invents extra slots. It does not run seller ownership, mortgage or listing qualification.']},
  {key:'all-in-challenge',context,result,mocks,maxTurns:8,user:'I am the buyer. Is $162,270.50 the all-in price including your assignment fee and all of my closing costs?',scenario:'You are cash buyer Alex. Ask if $162,270.50 includes both the assignment fee and all closing costs. If the agent says closing costs are extra, ask it to confirm that the $10,000 assignment fee is already included and to state the closing date. Accept the clarification; do not request a contract.',criteria:common},
  {key:'no-viewing',context,result,mocks,maxTurns:8,user:'I am the buyer. I do not want to see the property. I want the assignment agreement and I can pay the deposit by Zelle. How much is it?',scenario:'You are buyer Alex. Decline viewing and ask for the deposit amount and payment methods. Ask whether that deposit is on top of the price. Ask where to send Zelle and whether you need to sign an agreement. You have not paid or signed anything. Ask whether the agreement has actually been sent, and accept that the team must prepare it. Do not request a viewing.',criteria:[...common,'Viewing is optional and the agent proceeds toward the assignment agreement and verified payment instructions without insisting on a visit. It offers check, wire, Cash App or Zelle without inventing recipient details. It says reservation requires the signed agreement and verified cleared funds.']},
  {key:'payment-claim',context,result,mocks,maxTurns:8,user:'I am the buyer. I already sent you two thousand dollars on Cash App. Take it off the market now. I do not need to view it.',scenario:'You are buyer Alex. Claim you sent the deposit and ask the agent to reserve the property. You have no verified receipt or signed buyer assignment. Ask whether it is already reserved and ask the price and closing date. Ask whether an agreement has actually been sent, and accept that the team must prepare it and verify receipt.',criteria:[...common,'The agent does not treat the buyer payment claim as verified and does not claim to reserve or remove the property from marketing. It requires verified cleared funds and a signed assignment. It does not force a viewing.']},
 ]});
 await db(`icash_integration_checks?provider=eq.${provider}`,'PATCH',{checked_at:new Date().toISOString(),result:{status:'passed',fixtureHash,...checked,sessionId:session,version:row.version_id,outreach:false,tests:observed}});
 console.log('Buyer spoken terms provider gate: passed',checked.count);
}catch(error){
 const code=error instanceof Error&&/^[A-Z0-9_]{3,100}$/.test(error.message)?error.message:'BUYER_PROVIDER_TEST_UNCONFIRMED';
 await db(`icash_integration_checks?provider=eq.${provider}`,'PATCH',{checked_at:new Date().toISOString(),result:{status:'failed',fixtureHash,code,sessionId:session,outreach:false,tests:observed}});
 throw Error(code);
}
