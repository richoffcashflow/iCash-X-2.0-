// Explicit, bounded deployment check. Never part of the regular build. Every
// provider tool is mocked; these simulations cannot call, text or sign.
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {testAutomaticOfferProvider} from './test-automatic-offer-provider.mjs';
if(process.argv.includes('--deployment-gate')&&(process.env.VERCEL_ENV!=='production'||process.env.VERCEL_GIT_COMMIT_REF!=='fix/conditional-offer-simple-workspace'))process.exit(0);
const key=process.env.ELEVENLABS_API_KEY;
if(process.env.VERCEL_ENV!=='production'||!key)throw Error('TRUSTED_BUILD_CONFIGURATION_REQUIRED');
const api=async(path,method='GET',body)=>{
 const response=await fetch('https://api.us.elevenlabs.io'+path,{method,headers:{'xi-api-key':key,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw Error('SYNTHETIC_PROVIDER_CHECK_'+response.status);
 return response.json();
};
const address='45 Fixture Lane',now=Date.now();
const context={party:'seller',address,snapshot:{propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:180000,estimated_equity_percentage:10}}}};
const result={...calculateAutomaticCallOffer(context,{},now),quoteRevision:'a'.repeat(64)};
if(!result.quoteAllowed||result.priceCents!==10200000||result.contractAllowed!==false)throw Error('CONDITIONAL_OFFER_FIXTURE_REQUIRED');
const agents=[
 {agent_id:'agent_6701m406qmqjf1kr6ykw71vksjns',branch_id:'agtbrch_7601m4d7f3f4f73rd8djmm472caf',version_id:'agtvrsn_9801m4d7f3f3en3twpbc4gtm1551'},
];
await testAutomaticOfferProvider(api,agents,'tool_1201m4d6x0fbfastjt51rvb1ygjf',{
 prefix:'conditional-offer-20261008-v2-',cases:[{
  key:'mortgage-hold',context:{status:'matched',address,returningName:'Jane',dealStage:'draft',sellerOffer:null,purchaseTerms:{inspectionDays:10,legalDescriptionAvailable:true}},result,
  user:'I am Jane, the owner of 45 Fixture Lane. We already discussed the condition and my timeline. I want to sell. What is your exact cash offer?',
  scenario:'You are Jane. Ask the agent for its exact cash offer. Your mortgage estimate may be high, but you want to hear the price. Ask what needs to be checked next. Do not accept, ask for a contract, opt out or end the call.',
  criteria:['The agent calls icash_offer_and_contract and presents exactly $102,000 cash as is, even though the mortgage review is unresolved.','The agent clearly says the offer is subject to confirming the mortgage payoff or liens and asks for the current payoff balance.','The agent does not invent a different offer, promise net proceeds, say a contract was sent, or require reconciliation before saying the conditional price. It must not promise to prepare, text, or send an agreement while payoff review is unresolved; it should clearly explain that review comes first.'],
 }],
});
