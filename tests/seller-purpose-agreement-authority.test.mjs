import assert from 'node:assert/strict';
import {sellerContactPurposeQuestion} from '../lib/seller-contact-purpose.ts';
import {sellerAgreementEvidence} from '../lib/seller-agreement-evidence.ts';
import {sellerAgreementIdentityEvidence} from '../lib/seller-agreement-identity.ts';
import {sellerIdentityInterruption,sellerPropertyAnswer} from '../lib/seller-answer-evidence.ts';
import {sellerPayoffEvidence} from '../lib/seller-payoff.ts';
globalThis.fetch=async()=>{throw Error('Offline purpose authority replay only');};
const agent=message=>({role:'agent',message}),user=message=>({role:'user',message});
const terms={priceCents:7000000,closingDate:'2027-01-15',inspectionDays:10};
const now=Date.parse('2026-11-17T05:00:00Z');
const ownerQuestion='Are you the only owner and decision maker, or does anyone else need to agree?';
const nameQuestion='Is your full legal name Jane Seller for the purchase agreement?';
const readback='$70,000 cash; closing 2027-01-15; 10-day inspection. Do these terms work, and may I text the agreement now?';
const empty={legalNameConfirmed:false,soleOwnerConfirmed:false,allDecisionMakersConfirmed:false,otherSignersRequired:false};
const phrases=['How may I help','How can I help you today?','What is this for?','What is this about?','Why are you calling?','Why are you texting?'];
let checks=0;
for(const prefix of ['', 'Yes, ', 'Yeah, ', 'Yep, ', 'Sure, ', 'Okay, ', 'Ok, ', 'Correct, ', 'Right, ', 'Absolutely, ', 'Um, yes, ', 'Well, ', 'Um-yes, '])for(const phrase of phrases){
 const purpose=prefix+phrase;assert(sellerContactPurposeQuestion(purpose));assert(sellerIdentityInterruption(purpose));
 const coverage='Can you cover the $20,000 shortfall at closing?';
 assert.equal(sellerPayoffEvidence({transcript:[agent(coverage),user(purpose)]},{action:'report_change',sellerStatement:purpose}),null,'purpose cannot promise money for a shortfall');
 assert.equal(sellerPayoffEvidence({transcript:[agent(coverage),user(purpose),user('Yes')]},{action:'report_change',sellerStatement:'Yes'}),null,'purpose breaks old shortfall-question association');
 assert.deepEqual(sellerPayoffEvidence({transcript:[agent(coverage),user(purpose),agent(coverage),user('Yes')]},{action:'report_change',sellerStatement:'Yes'}),{coveredShortfallCents:2000000,coverageDeclined:false},'fresh actual shortfall answer remains a seller report');
 for(const kind of ['condition','occupancy','timing','situation'])assert.equal(sellerPropertyAnswer(kind,purpose),false);
 for(const question of [ownerQuestion,nameQuestion]){
  assert.deepEqual(sellerAgreementIdentityEvidence({transcript:[agent(question),user(purpose)]},'Jane Seller'),empty,purpose+' grants no identity authority');
  assert.deepEqual(sellerAgreementIdentityEvidence({transcript:[agent(question),user(purpose),user('Yes')]},'Jane Seller'),empty,'unanswered association breaks');
 }
 assert.equal(sellerAgreementEvidence({transcript:[agent(readback),user(purpose)]},terms,now),false,purpose+' grants no terms or text permission');
 assert.equal(sellerAgreementEvidence({transcript:[agent(readback),user(purpose),user('Yes')]},terms,now),false,'unprompted later yes is not the old readback answer');
 assert.equal(sellerAgreementEvidence({transcript:[agent(readback),user(purpose),agent(readback),user('Yes, send the agreement.')]},terms,now),true,'fresh full readback and real answer still work');
 const genuine=[agent(nameQuestion),user('Yes'),agent(ownerQuestion),user('Yes, just me')];
 const actual=sellerAgreementIdentityEvidence({transcript:genuine},'Jane Seller');assert(actual.legalNameConfirmed&&actual.soleOwnerConfirmed&&actual.allDecisionMakersConfirmed);
 assert.deepEqual(sellerAgreementIdentityEvidence({transcript:[...genuine,agent(ownerQuestion),user(purpose)]},'Jane Seller'),actual,'informational interruption preserves original real identity evidence');
 assert.equal(sellerAgreementEvidence({transcript:[agent(readback),user('Yes, send the agreement.'),agent('Do you have a question?'),user(purpose)]},terms,now),true,'informational interruption preserves original real terms evidence');
 const after=sellerAgreementIdentityEvidence({transcript:[agent(ownerQuestion),user(purpose),agent(ownerQuestion),user('Yes, just me')]},'Jane Seller');assert(after.soleOwnerConfirmed&&after.allDecisionMakersConfirmed);
 checks++;
}
for(const body of ['Yes, what is this for? But my wife is also an owner.','What is this for? My spouse must agree.']){
 assert.equal(sellerContactPurposeQuestion(body),false,'mixed ownership changes are not hidden by purpose');
 assert.equal(sellerAgreementIdentityEvidence({transcript:[agent(ownerQuestion),user('Yes'),user(body)]},'Jane Seller').otherSignersRequired,true);
}
for(const body of ['Yes, what is this for? Stop.','What is this about? I changed my mind.','How can I help? Only if the price is higher.']){
 assert.equal(sellerContactPurposeQuestion(body),false,'mixed withdrawal remains material');
 assert.equal(sellerAgreementEvidence({transcript:[agent(readback),user('Yes'),user(body)]},terms,now),false);
}
console.log(`PASS ${checks} purpose/affirmative combinations: no new name, owner, signer, terms or text authority; pending associations break, fresh answers work and earlier genuine evidence survives. No providers.`);
