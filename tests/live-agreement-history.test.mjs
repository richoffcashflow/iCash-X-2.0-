import assert from 'node:assert/strict';
import {liveToolHistory} from '../lib/live-tool-history.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
import {automaticOfferToolConfig,legacyAutomaticOfferToolConfig,sellerAgreementToolMatches} from '../lib/seller-agreement-tool.ts';
const revision='a'.repeat(64),input={action:'accept_offer',priceCents:4812800,quoteRevision:revision};
const quoted={role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,priceCents:4812800,quoteRevision:revision})}]};
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const history=entries=>liveToolHistory(JSON.stringify({'x-elevenlabs-history':true,entries}));
// Replays the observed interruption, acceptance, and subsequent closing answers.
const entries=[quoted,a('Our cash offer is forty-eight thousand one hundred twenty-eight dollars. Does that work?'),u('Could you do fifty thousand?'),a('Our current cash offer is forty-eight thousand one hundred twenty-eight dollars. Are you ready to proceed?'),a('Are you still there?'),u("Yes, let’s do it. Yes."),a('What closing date works?'),u('November 11th, 2026.'),a('Are you the only owner?'),u("I'm the only owner."),a('Your legal name?'),u('Jane Seller.')];
assert(callOfferEvidence(history(entries),input),'later legal-name answer must not erase actual price acceptance');
const acceptedReceipt={role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,contractAllowed:true,priceCents:input.priceCents,quoteRevision:revision,status:'verbally_accepted'})}]};
const acknowledged=[...entries.slice(0,6),acceptedReceipt,...entries.slice(6)];
assert(callOfferEvidence(history(acknowledged),input),'saving acceptance must not make its own receipt erase the seller answer');
assert(callOfferEvidence(history([...acknowledged,quoted,a('What closing date works?'),u('Thirty days from now.')]),input),'rereading the same quote preserves acceptance');
assert(!callOfferEvidence(history([quoted,acceptedReceipt,u('Jane Seller.')]),input),'a tool receipt without a seller acceptance is not consent');
for(const withdrawal of ['I changed my mind.','Do not text the agreement.','Yes, but I need $50,000.']){
 assert(!callOfferEvidence(history([...acknowledged,u(withdrawal)]),input),'receipt does not hide a later withdrawal: '+withdrawal);
}
const changedReceipt={role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,priceCents:4900000,quoteRevision:'b'.repeat(64)})}]};
const combinedReceipt={...acceptedReceipt,role:'agent',message:'One moment.'};
assert.deepEqual(history([combinedReceipt]).transcript[0].tool_results,acceptedReceipt.tool_results,'spoken provider entries preserve their tool-result receipts');
assert(callOfferEvidence(history([...acknowledged,combinedReceipt]),input),'unchanged receipt with spoken message preserves acceptance');
assert(!callOfferEvidence(history([...acknowledged,{...changedReceipt,role:'agent',message:'One moment.'}]),input),'changed quote in a spoken provider entry must invalidate old acceptance');
assert(callOfferEvidence(history([{...quoted,role:'agent',message:'Our cash offer is $48,128. Does that work?'},u('Yes.')]),input),'initial same-entry receipt and spoken price retain the question for actual acceptance');
const nextInput={...input,priceCents:4900000,quoteRevision:'b'.repeat(64)};
const nextSpokenQuote={...changedReceipt,role:'agent',message:'Our current cash offer is $49,000. Does that work?'};
assert(!callOfferEvidence(history([...acknowledged,nextSpokenQuote]),nextInput),'a new same-entry quote still needs a fresh real answer');
assert(callOfferEvidence(history([...acknowledged,nextSpokenQuote,u('Yes.')]),nextInput),'fresh acceptance after the new same-entry quote approves only its revision');
assert(!callOfferEvidence(history([{...quoted,role:'agent',message:'One moment.'},u('Yes.')]),input),'receipt and an unrelated agent message cannot supply a price confirmation');
assert(!callOfferEvidence(history([...acknowledged,changedReceipt,quoted,u('Jane Seller.')]),input),'returning to an old quote after a different revision requires new acceptance');
assert(!callOfferEvidence(history([quoted,a('Our cash offer is $48,128. Does that work?'),u('Yes, $50,000.')]),input),'a different amount is not acceptance');
assert(!callOfferEvidence(history(entries.slice(0,5).concat(u('Yes.'))),input),'presence check alone does not accept an offer');
for(const withdrawal of ['I changed my mind.','I do not accept.','Yes, but I need $50,000.','Only if you close tomorrow.']){
 assert(!callOfferEvidence(history(entries.concat(u(withdrawal))),input),withdrawal);
}
assert(!callOfferEvidence(history(entries.concat({...quoted,tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,priceCents:4900000,quoteRevision:'b'.repeat(64)})}]})),input),'old acceptance cannot approve a new revision');
assert.equal(liveToolHistory(undefined),null);
for(const value of [{entries},JSON.stringify({entries}),JSON.stringify({'x-elevenlabs-history':true,entries:Array(501).fill(u('yes'))})])assert.throws(()=>liveToolHistory(value),/invalid_call_history/);
assert(sellerAgreementToolMatches({id:'tool_new',tool_config:automaticOfferToolConfig},undefined,'automatic_offer_v9'));
assert(sellerAgreementToolMatches({id:'tool_old',tool_config:legacyAutomaticOfferToolConfig},undefined,'automatic_offer_v8'));
assert(!sellerAgreementToolMatches({id:'tool_old',tool_config:legacyAutomaticOfferToolConfig},undefined,'automatic_offer_v9'));
const tampered=structuredClone(automaticOfferToolConfig);delete tampered.api_schema.request_body_schema.properties.conversationHistory.dynamic_variable;
assert(!sellerAgreementToolMatches({id:'tool_new',tool_config:tampered},undefined,'automatic_offer_v9'),'model-authored history must not pass provider configuration review');
const observedInput={action:'accept_offer',priceCents:7400000,quoteRevision:'0d6de2ad2caa0687c559ece38852664d4063c6d3d98cb76651f45c62f18b2d2e'};
const receipt=status=>({role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,contractAllowed:true,priceCents:observedInput.priceCents,quoteRevision:observedInput.quoteRevision,status})}]});
const observed=[receipt('calculated_proposal'),a('We can offer seventy-four thousand dollars cash. Does that price work?'),u('Yeah, that price works for me.'),receipt('verbally_accepted'),a('The agreed price is seventy-four thousand dollars cash. The closing date we have is twenty-sixth of October, ten-day inspection period, and the legal name on the contract will be yours alone. Does that all look right, and should I text the agreement now?'),u('That looks... Text the agreement.'),receipt('verbally_accepted')];
assert(callOfferEvidence(history(observed),observedInput),'observed contract text request after same-price readback preserves saved acceptance');
for(const request of ['That looks good. Please text the agreement.','Yes, you can text the agreement.'])assert(callOfferEvidence(history([...observed.slice(0,-2),u(request)]),observedInput));
for(const refusal of ['That looks... Do not text the agreement.','That looks... Text the agreement if my wife agrees.','That looks... Text the agreement tomorrow.'])assert(!callOfferEvidence(history([...observed.slice(0,-2),u(refusal)]),observedInput));
assert(!callOfferEvidence(history([receipt('calculated_proposal'),observed[4],observed[5]]),observedInput),'a delivery request alone does not invent price acceptance');
console.log('PASS live acceptance history, withdrawal, revision, presence check and provider-reserved history source.');
