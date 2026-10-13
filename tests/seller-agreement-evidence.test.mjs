import assert from 'node:assert/strict';
import {sellerAgreementEvidence,sellerAgreementConfirmationHold} from '../lib/seller-agreement-evidence.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
const terms=dealTermsSchema.parse({seller:'Trey Young',priceCents:7400000,closingDate:'2026-11-11',inspectionDays:10});
const agent=message=>({role:'agent',message}),user=message=>({role:'user',message});
const now=Date.parse('2026-10-13T20:00:00Z');
const check=(turns,t=terms,at=now)=>sellerAgreementEvidence({transcript:turns},t,at);
const question=sellerAgreementConfirmationHold(terms).nextQuestion;
assert(!check([agent('What closing date works?'),user('Thirty days from now.')]));
assert(!check([agent(question)]),'the bot cannot supply its own consent');
for(const yes of ['Yes.','Yeah, please text it.','Sure.','Please send the agreement.','Um, yeah, that works.'])assert(check([agent(question),user(yes)]),yes);
for(const objection of ['No.','Yes, but I need to think.','Wait for my spouse.','Do not text me.','Maybe tomorrow.'])assert(!check([agent(question),user(objection)]),objection);
for(const date of ['November 11th, 2026','November eleventh, twenty twenty-six','November eleven, two thousand and twenty-six','2026-11-11','11/11/2026','November eleventh','the eleventh of November','eleventh November, twenty twenty-six']){
 assert(check([agent(`The cash price is seventy-four thousand dollars, closing ${date}, with a ten-day inspection period. Shall I text it now?`),user('Yes.')]),date);
}
for(const wrong of [question.replace('$74,000','$75,000'),question.replace('November 11','November 12'),question.replace('10-day','5-day'),question.replace('November 11, 2026','30 days from now'),question.replace('may I text you the agreement for review now','is this a good time')])assert(!check([agent(wrong),user('Yes.')]),wrong);
assert(!check([agent(question),user('Yes.'),user('Wait, I changed my mind.')]));
assert(!check([agent(question),user('Yes, $75,000.')]));
assert(!check([agent(question),user('Yes.'),agent(question.replace('10-day','5-day')),user('Yes.')]));
assert(!check([agent(question),user('Yes.')],{...terms,inspectionDays:14}));
assert(!check([agent(question),user('Yes.')],{...terms,closingDate:'2026-11-12'}));
assert(check([agent(question),user('Yes.'),{role:'tool',tool_results:[{result_value:'saved'}]},agent('One moment.')]),'tool receipts and preparation do not erase authorization');
assert(check([agent(question),user('Yes.'),agent(question)]),'rereading the same terms must not erase the seller answer');
const ownershipQuestion='Does anyone else own the property or need to agree to sell?';
assert(check([agent(question),user('Yes.'),agent(ownershipQuestion),user('No, there are no other owners or decision makers.')]),'a clear answer denying additional owners is not withdrawal of agreed terms');
assert(!check([agent(question),user('Yes.'),agent(ownershipQuestion),user('No, there are no other owners. Do not text the agreement.')]));
for(const wrongYear of ['November 11, 2027','November eleventh, twenty twenty-seven','the eleventh of November, two thousand and twenty-seven']){
 assert(!check([agent(`The cash price is $74,000, closing ${wrongYear}, with a ten-day inspection period. May I text the agreement?`),user('Yes.')]));
}
const observedReadback='The agreed price is seventy-four thousand dollars cash. The closing date we have is twenty-sixth of October, ten-day inspection period, and the legal name on the contract will be yours alone. Does that all look right, and should I text the agreement now?';
const observedTerms={...terms,closingDate:'2026-10-26'};
assert(check([agent(observedReadback),user('That looks... Text the agreement.')],observedTerms),'observed natural date and direct text request authorize those exact terms');
assert(!check([agent(observedReadback),user('That looks... Text the agreement.')],{...observedTerms,closingDate:'2027-10-26'}),'omitted year cannot approve the same month/day a year later');
assert(check([agent(observedReadback),user('That looks... Text the agreement.')],{...observedTerms,closingDate:'2027-10-26'},Date.parse('2026-12-31T20:00:00Z')),'year rollover resolves only the next occurrence');
assert(check([agent(observedReadback),user('That looks... Text the agreement.')],observedTerms,Date.parse('2026-10-27T02:00:00Z')),'omitted year uses the Chicago date before local midnight, not the UTC next day');
for(const answer of ['That looks... Do not text the agreement.','That looks... Text the agreement if my wife agrees.','That looks... Text the agreement tomorrow.'])assert(!check([agent(observedReadback),user(answer)],observedTerms));
console.log('PASS exact spoken terms and text consent, natural dates, missing readback, wrong terms and later withdrawal. No external contacts.');
