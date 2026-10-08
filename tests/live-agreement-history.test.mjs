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
console.log('PASS live acceptance history, withdrawal, revision, presence check and provider-reserved history source.');
