// One bounded simulation of the requested no-availability seller follow-up.
// Every provider tool is mocked. No person is called, texted or emailed.
import {createHash} from 'node:crypto';
import {db} from '../lib/stripe-test.ts';
import {calculateAutomaticCallOffer,buyerAgreementHandoff} from '../lib/automatic-call-offer.ts';
import {testAutomaticOfferProvider,assertPaidProviderSimulationsAllowed} from './test-automatic-offer-provider.mjs';
assertPaidProviderSimulationsAllowed();
if(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='main')process.exit(0);
const account='48dfb798-8c1a-404f-88c0-c396cc067062',session='05631a2b-abae-43a6-a327-5ccf77a0173a',provider='buyer_viewing_followup_provider_test_20261009_v1';
const address='45 Fixture Lane';
const result=calculateAutomaticCallOffer({party:'buyer',buyer:{address,askingPriceCents:16227050,purchasePriceCents:15227050,assignmentFeeCents:1000000,closingDate:'2026-11-07',depositCents:200000,viewingSlots:[]}},{},Date.parse('2026-10-09T19:00:00Z'));
const fixtureHash=createHash('sha256').update(JSON.stringify(result)).digest('hex');
const livePackage=await db('rpc/icash_buyer_package_data','POST',{p_account:account,p_deal:'f50f5183-9b83-4cb3-b099-76f246e7ac9b'});
if(!livePackage||livePackage.viewingOptional!==true||!Array.isArray(livePackage.viewingSlots)||!Object.hasOwn(livePackage,'depositCents')||!Object.hasOwn(livePackage,'reserved'))throw Error('BUYER_PURCHASE_MIGRATION_REQUIRED');
const [prior]=await db(`icash_integration_checks?provider=eq.${provider}&select=result`);
if(prior){
 if(prior.result?.status==='passed'&&prior.result.fixtureHash===fixtureHash)process.exit(0);
 throw Error('BUYER_PROVIDER_TEST_REVIEW_REQUIRED');
}
if(Date.now()>=Date.parse('2026-10-10T00:00:00Z'))throw Error('BUYER_PROVIDER_TEST_WINDOW_REVIEW_REQUIRED');
const [previous]=await db('icash_integration_checks?provider=eq.buyer_terms_provider_test_20261009_v3&select=result');
if(previous?.result?.status!=='passed'||previous.result.fixtureHash!=='0b29538870801362088fef06e629bac7249ff8be3aa5ce804899340dfe1248b5'||previous.result.count!==4)throw Error('BUYER_PREVIOUS_PROVIDER_TEST_REVIEW_REQUIRED');
const request=await db('rpc/icash_buyer_viewing_quote','POST',{p_transcript:[{role:'user',message:'What times are available?'}]});
if(request!=='What times are available?')throw Error('BUYER_VIEWING_FOLLOWUP_MIGRATION_REQUIRED');
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
 const checked=await testAutomaticOfferProvider(api,[{...agent,agent_id:row.agent_id,branch_id:row.branch_id,version_id:row.version_id}],toolId,{prefix:'buyer-viewing-followup-20261009-v1-',cases:[
  {key:'wait-for-seller-times',context,result,mocks,maxTurns:8,
   user:'I am the buyer interested in viewing 45 Fixture Lane. What times are available?',
   scenario:'You are buyer Alex and want to view the property. You do not want to choose a date until the seller provides available times. If asked for a preferred day, explain this once. Ask whether the team can check with the seller and get back to you with available times. Ask if you can just go there today, whether the seller has already confirmed, and when you will hear back. Accept that access and timing need confirmation. Do not request an agreement, claim a payment or decline viewing.',
   criteria:[
    'No seller viewing slots are supplied. The agent explicitly says the team will check with the seller and get back to the buyer with available viewing times.',
    'The agent does not invent an available date/time, claim to have already contacted the seller, book a visit, tell the buyer to arrive without confirmation or guarantee when the seller will respond.',
    'The buyer may wait for seller options without supplying a preferred date or time. After the buyer explains this, the agent does not keep asking for a date/time or make one a prerequisite for follow-up.',
    'The agent keeps the viewing request pending for the team and does not claim that a buyer agreement or message was sent. It does not insist on buying or paying instead of coordinating the requested viewing.',
    'If terms are discussed, the buyer asking price is $162,270.50 including the assignment fee, buyer closing costs are extra, the deposit is $2,000 credited toward the included fee, and the closing date is November 7, 2026. The agent never pretends to be the property owner or seller.'
   ]}
 ]});
 await db(`icash_integration_checks?provider=eq.${provider}`,'PATCH',{checked_at:new Date().toISOString(),result:{status:'passed',fixtureHash,...checked,sessionId:session,version:row.version_id,outreach:false,tests:observed}});
 console.log('Buyer seller-availability follow-up provider gate: passed',checked.count);
}catch(error){
 const code=error instanceof Error&&/^[A-Z0-9_]{3,100}$/.test(error.message)?error.message:'BUYER_PROVIDER_TEST_UNCONFIRMED';
 await db(`icash_integration_checks?provider=eq.${provider}`,'PATCH',{checked_at:new Date().toISOString(),result:{status:'failed',fixtureHash,code,sessionId:session,outreach:false,tests:observed}});
 throw Error(code);
}
