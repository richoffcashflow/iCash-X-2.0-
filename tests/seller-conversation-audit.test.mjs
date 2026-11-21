import assert from 'node:assert/strict';
import {callContactEvidence} from '../lib/call-contact-evidence.ts';
import {sellerCallDisposition} from '../lib/seller-response-policy.ts';
import {callSellerPriceEvidence} from '../lib/call-offer-evidence.ts';

const reply=(question,message)=>[{role:'agent',message:question},{role:'user',message}];
for(const prompt of ['See if this person is available.','Revisare si esta persona esta disponible.',
 '1234567 is not in service at this time. Please check the number and dial again, or call your operator for assistance.']){
 const turns=reply('Hello?',prompt);
 assert.equal(callContactEvidence(turns),'automated_answer');
 assert.equal(callContactEvidence([...turns,{role:'user',message:'Yes, I own it.'}]),'human_response');
 assert.equal(sellerCallDisposition([...turns,{role:'user',message:'Stop calling me.'}]),'opt_out');
}
assert.equal(callContactEvidence(reply('Hello?','I will see if this person is available.')),'human_response');
assert.equal(sellerCallDisposition(reply('Are you currently looking to sell the property?','No.')),'declined');
assert.equal(sellerCallDisposition(reply('Are you currently looking to sell for $500,000?','No.')),null);
assert.equal(sellerCallDisposition(reply('Does it need repairs?','No.')),null);
const opener='Would you consider selling 45 Oak Road for all cash?';
for(const [question,answer,want] of [
 [opener,'Yes 500,000 cash.',50000000],[opener,'Yes, $500k cash.',50000000],
 [opener,'Yes, 500,000 cash after fees.',null],[opener,'Yes 400,000 or 500,000 cash.',null],
 ['Would you consider selling for $500,000 cash?','Yes 500,000 cash.',null],
 ['How much is the mortgage payoff?','Yes 500,000 cash.',null],
]){
 assert.equal(callSellerPriceEvidence({transcript:reply(question,answer)},{action:'report_change',sellerStatement:answer}),want);
}
