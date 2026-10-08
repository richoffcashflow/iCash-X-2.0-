import assert from 'node:assert/strict';
import {confirmedSellerTerms,sellerAgreementInput,sellerAgreementFlowInstructions} from '../lib/seller-agreement-flow.ts';
import {sellerAgreementAction,sellerAgreementFailure} from '../lib/seller-agreement-service.ts';
import {sellerAgreementToolConfig,sellerAgreementToolMatches,noEmdAgreementToolConfig} from '../lib/seller-agreement-tool.ts';
import {sellerAgreementReceptionVariables,sellerAgreementReceptionPrompt,noEmdReceptionPrompt,sellerAgreementReceptionPolicyHash} from '../lib/seller-agreement-reception.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
import {loadSellerClosingContext} from '../lib/seller-closing-context.ts';
const now=Date.now(),date=new Date(now+14*86400000).toISOString().slice(0,10);
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:9000000,closingDate:date,soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'no',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
const terms=dealTermsSchema.parse({address:'45 Oak Road',buyer:'Fixture buyer',state:'TX',legalDescription:'Lot 1 block 2',earnestCents:0});
const context={address:terms.address,principal:terms.buyer,legalDescription:terms.legalDescription,ceilingCents:10200000,now};
const filled=confirmedSellerTerms(terms,confirmation,context);
assert.equal(filled.priceCents,9000000);assert.equal(filled.closingDate,date);assert.equal(filled.seller,'Jane Seller');assert.equal(filled.inspectionDays,10);assert.equal(filled.dealNotes,'');
const closing=await loadSellerClosingContext(async path=>path.startsWith('icash_deal_files')?[{id:'deal',terms:filled}]:[{terms:filled,recipients:[{phone:'+12125550199'},{email:'buyer@example.test'}]}],'account','screen','+12125550199',10200000);
assert.equal(closing.priceCents,9000000,'returning calls retain the exact pending contract when EMD is absent');assert.equal(closing.earnestCents,undefined);
for(const [patch,reason] of [[{soleOwner:false},'all_owners'],[{allDecisionMakersAgree:false},'all_owners'],[{priceAndDateConfirmed:false},'confirmation'],[{termsConfirmed:false},'confirmation'],[{sendTextRequested:false},'confirmation'],[{materialFactsChanged:true},'updated_property'],[{agreedPriceCents:10300000},'price_review'],[{closingDate:'2000-01-01'},'closing_date']])assert.throws(()=>confirmedSellerTerms(terms,{...confirmation,...patch},context),new RegExp(reason));
assert.equal(confirmedSellerTerms({...terms,earnestCents:null},confirmation,context).earnestCents,null);
assert.equal(confirmedSellerTerms({...terms,earnestCents:10000},confirmation,context).earnestCents,null);
assert.equal(sellerAgreementReceptionPolicyHash,'b2f3791d6af9a3468684a65dd25427a8168dd604f4b1a0b28a7ee4ef5b06e1e8','existing live policy hash must remain valid during rollout');
assert(!noEmdReceptionPrompt.includes('including earnest money'));assert(sellerAgreementFlowInstructions.includes('do not hold the agreement for those items'));
assert(sellerAgreementToolMatches({id:'tool_noemd',tool_config:noEmdAgreementToolConfig}));
assert.throws(()=>confirmedSellerTerms({...terms,priceCents:8000000,priceSource:'seller_reported'},confirmation,context),/existing_price/);
assert(!sellerAgreementInput.safeParse({action:'status',conversationId:'conv_fixture',phone:'+12125550100'}).success);
const tool={id:'tool_fixture',tool_config:structuredClone(sellerAgreementToolConfig)};
assert(sellerAgreementToolMatches(tool));
const serialized=structuredClone(tool);
function defaults(s){if(s.properties){for(const p of Object.values(s.properties))defaults(p);}else Object.assign(s,{description:s.description??'',enum:s.enum??null,is_system_provided:false,dynamic_variable:s.dynamic_variable??'',allowed_values:null,allowed_values_dynamic_variable:'',constant_value:'',is_omitted:false});}
defaults(serialized.tool_config.api_schema.request_body_schema);serialized.tool_config.dynamic_variables={dynamic_variable_placeholders:{}};
assert(sellerAgreementToolMatches(serialized),'neutral provider defaults must preserve the exact tool schema');
for(const patch of [{is_system_provided:true},{is_omitted:true},{constant_value:1},{dynamic_variable:'price'},{allowed_values:['yes']},{allowed_values_dynamic_variable:'choices'}]){const changed=structuredClone(serialized);Object.assign(changed.tool_config.api_schema.request_body_schema.properties.confirmation.properties.agreedPriceCents,patch);assert(!sellerAgreementToolMatches(changed));}
for(const change of [t=>t.tool_config.api_schema.url='https://example.com',t=>t.tool_config.api_schema.request_headers.Authorization.variable_name='other',t=>t.tool_config.api_schema.request_body_schema.properties.confirmation.properties.agreedPriceCents.dynamic_variable='price']){const bad=structuredClone(tool);change(bad);assert(!sellerAgreementToolMatches(bad));}
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:terms.address,legal_description:terms.legalDescription,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const scope={accountId:'account',ownerUserId:'owner',ownerEmail:'owner@example.test',dealId:'deal',screeningId:'screen',phone:'+12125550199',callKey:'inbound:fixture'};
let envelopes=[],savedTerms=terms,providerSends=0,texts=0,status='awaiting_counterparty',claim=null;
const d={now:()=>now,bind:async()=>{},db:async(path,method,body)=>{
 if(path==='rpc/icash_seller_agreement_call_context')return scope;
 if(path==='rpc/icash_call_offer_context')return null;
 if(path.startsWith('icash_signing_envelopes?'))return envelopes;
 if(path.startsWith('icash_deal_files?'))return [{terms:savedTerms,stage:'draft'}];
 if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
 if(path.startsWith('icash_customer_identities?'))return [{principal:terms.buyer}];
 if(path==='rpc/icash_claim_seller_agreement'){if(claim)return {...claim,claimed:false};savedTerms=body.p_terms;claim={id:'claim',claimed:true,envelopeId:null};return claim;}
 if(path==='rpc/icash_finish_seller_agreement'){claim.envelopeId=body.p_envelope;return true;}
 if(path==='rpc/icash_fail_seller_agreement')return null;
 throw Error(path);
 },send:async i=>{providerSends++;assert.equal(i.phoneLinkOnly,true);assert.equal(i.signers[0].phone,scope.phone);envelopes=[{id:'envelope',state:'awaiting_counterparty',test_mode:false,terms:savedTerms,recipients:[{name:confirmation.sellerLegalName,phone:scope.phone},{name:terms.buyer}]}];return {id:'envelope',testMode:false};},text:async()=>{texts++;return {sent:true,status:'accepted',instruction:'Accepted, not yet delivered.'};},refresh:async()=>({status})};
const send={action:'confirm_and_send',conversationId:'conv_fixture',confirmation},token='a'.repeat(64);
assert.equal((await sellerAgreementAction(token,send,d)).sent,true);assert.equal(providerSends,1);assert.equal(savedTerms.priceCents,9000000);assert.equal(savedTerms.closingDate,date);
assert.equal((await sellerAgreementAction(token,send,d)).sent,true);assert.equal(providerSends,1,'retry must reuse the exact envelope');
assert.equal((await sellerAgreementAction(token,{action:'status',conversationId:'conv_fixture'},d)).status,'signature_pending');
status='customer_signature_needed';assert.equal((await sellerAgreementAction(token,{action:'status',conversationId:'conv_fixture'},d)).status,'seller_signed');
status='completed';assert.equal((await sellerAgreementAction(token,{action:'status',conversationId:'conv_fixture'},d)).status,'fully_signed');
assert.equal(sellerAgreementFailure(Error('confirmation_required')).reason,'confirmation_required');
await assert.rejects(sellerAgreementAction(token,{...send,confirmation:{...confirmation,closingDate:new Date(now+15*86400000).toISOString().slice(0,10)}},d),/agreement_changed/);
assert.equal(providerSends,1);
const variables=sellerAgreementReceptionVariables({status:'matched',address:terms.address,dealStage:'draft',agreementPending:false,screeningSnapshot:snapshot,purchaseTerms:{earnestCents:0,inspectionDays:10,legalDescriptionAvailable:true,secret:'NEVER SEND'},pendingAgreement:null},now);
assert.equal(JSON.parse(variables.icash_property_context).purchaseTerms.earnestCents,undefined);assert(!JSON.stringify(variables).includes('NEVER SEND'));
assert(sellerAgreementReceptionPrompt.includes('icash_seller_agreement'));assert(!sellerAgreementReceptionPrompt.includes('You cannot send a contract'));
console.log('PASS seller agreement: confirmed price/date, all owners, optional visit, immutable prepared terms, exact recipient, one provider creation, status evidence and private data filtering. No external messages.');

const v6=await import('../lib/seller-agreement-reception.ts');
assert.equal(v6.legacyAutomaticOfferReceptionPolicyHash,'1fca2735e85b914b8c934985834def9bd6e698eba33bae7d8d9262067bdea734');
assert.notEqual(v6.automaticOfferReceptionPolicyHash,v6.legacyAutomaticOfferReceptionPolicyHash);
const {legacyAutomaticOfferGuardrail,automaticOfferGuardrails,automaticOfferGuardrailMatches}=await import('../lib/automatic-offer-policy.ts');
const prior=automaticOfferGuardrails();prior.custom.config.configs=[legacyAutomaticOfferGuardrail];
assert(automaticOfferGuardrailMatches(prior,'automatic_offer_v5'));
assert(!automaticOfferGuardrailMatches(prior,'automatic_offer_v6'));
assert(automaticOfferGuardrailMatches(automaticOfferGuardrails(),'automatic_offer_v6'));
assert(!automaticOfferGuardrailMatches(automaticOfferGuardrails(),'automatic_offer_v5'));
