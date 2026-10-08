import assert from 'node:assert/strict';
import test from 'node:test';
import {sellerOfferPresentation,sellerQualificationAndOfferInstructions} from '../lib/seller-offer-presentation.ts';
import {sellerOfferReceptionVariables,sellerOfferReceptionPolicy,sellerOfferReceptionPolicyHash,sellerOfferReceptionPrompt} from '../lib/seller-offer-reception.ts';
import {receptionContextPrompt,receptionContextVariables,propertyReceptionEnabled} from '../lib/reception-property-context.ts';
import {buyerReceptionPolicyHash,buyerReceptionPrompt} from '../lib/buyer-reception-context.ts';
import {sellerCallPrompt} from '../lib/seller-call-context.ts';
const now=Date.parse('2026-10-08T05:00:00Z'),address='45 Oak Road';
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now-60000).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90,owner_ssn:'NEVER_FORWARD',has_active_lien:false,is_tax_delinquent:false}}};
const source={status:'matched',address,screeningSnapshot:snapshot,dealStage:'draft',agreementPending:false};
const config={context_policy:sellerOfferReceptionPolicy,context_policy_hash:sellerOfferReceptionPolicyHash,context_approval_reference:'Synthetic approved seller proposal'};
test('public proposal uses exact fresh formula and excludes private underwriting',()=>{
 const proposal=sellerOfferPresentation(snapshot,address,now);
 assert.equal(proposal.priceCents,10200000);assert.equal(proposal.repairEstimateCents,4000000);assert.equal(proposal.asIs,true);assert.equal(proposal.payment,'cash');
 const v=sellerOfferReceptionVariables(source,now),data=JSON.parse(v.icash_property_context);
 assert.equal(data.sellerOffer.priceCents,proposal.priceCents);
 for(const privateField of ['NEVER_FORWARD','screeningSnapshot','loan_balance','assignmentFee','maxOffer','owner_ssn'])assert(!JSON.stringify(v).includes(privateField));
});
test('wrong property, stale research, financial holds and pending agreements never produce an offer',()=>{
 for(const value of [{...snapshot,fetchedAt:new Date(now-86400001).toISOString()},{...snapshot,raw:{data:{...snapshot.raw.data,estimated_repair_cost:null}}},{...snapshot,raw:{data:{...snapshot.raw.data,has_active_lien:true}}},{...snapshot,raw:{data:{...snapshot.raw.data,total_estimated_loan_balance:150000}}}])assert.equal(sellerOfferPresentation(value,address,now),null);
 assert.equal(sellerOfferPresentation(snapshot,'46 Oak Road',now),null);
 for(const extra of [{agreementPending:true},{agreementPending:undefined},{dealStage:'under_contract'},{screeningSnapshot:null}])assert.equal(JSON.parse(sellerOfferReceptionVariables({...source,...extra},now).icash_property_context).sellerOffer,null);
 const ambiguous=sellerOfferReceptionVariables({...source,status:'ambiguous'},now);assert(!ambiguous.icash_property_context.includes('10200000'));
});
test('seller policy is separately bound and preserves existing buyer routing and v1 script',()=>{
 assert(propertyReceptionEnabled(config));assert(!propertyReceptionEnabled({...config,context_policy_hash:'wrong'}));assert.equal(receptionContextPrompt(config),sellerOfferReceptionPrompt);
 assert.equal(receptionContextPrompt({context_policy:'buyer_seller_v1',context_policy_hash:buyerReceptionPolicyHash,context_approval_reference:'Synthetic previous review'}),buyerReceptionPrompt);
 const buyer={status:'buyer',address,purchasePriceCents:10200000,assignmentFeeCents:1000000,askingPriceCents:11200000,...{screeningSnapshot:snapshot}};
 const v=receptionContextVariables(config,buyer);assert.equal(JSON.parse(v.icash_property_context).askingPriceCents,11200000);assert(!v.icash_property_context.includes('sellerOffer'));
});
test('outbound presents the calculated price after qualification and preserves an agreed price',()=>{
 const context={address,principal:'Fixture Homes',assistantName:'Robin',history:null};
 const proposal=sellerOfferPresentation(snapshot,address,now);
 const prompt=sellerCallPrompt(context,proposal.priceCents,null,true,proposal.priceCents,proposal);
 assert(prompt.includes('"priceCents":10200000'));assert(prompt.includes('"repairEstimateCents":4000000'));
 assert(!prompt.includes('Never automatically offer the maximum'));assert(!prompt.includes('not a default opening offer'));
 assert(prompt.includes("What's going on with the property?"));assert(prompt.includes('What has you looking to sell?'));assert(prompt.includes('as is, all cash. How does that sound?'));
 assert(sellerQualificationAndOfferInstructions.includes('Holding and resale costs are general pricing considerations'));
 assert.throws(()=>sellerCallPrompt(context,proposal.priceCents,null,true,proposal.priceCents,{...proposal,priceCents:1}),/CALL_OFFER_AUTHORITY_INVALID/);
});
