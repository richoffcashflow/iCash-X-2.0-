import assert from 'node:assert/strict';
import {sellerAgreementEvidence,sellerAgreementConfirmationHold} from '../lib/seller-agreement-evidence.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
const terms=dealTermsSchema.parse({seller:'Trey Young',priceCents:7400000,closingDate:'2026-11-11',inspectionDays:10});
const agent=message=>({role:'agent',message}),user=message=>({role:'user',message});
const check=(turns,t=terms)=>sellerAgreementEvidence({transcript:turns},t);
const question=sellerAgreementConfirmationHold(terms).nextQuestion;
assert(!check([agent('What closing date works?'),user('Thirty days from now.')]));
assert(!check([agent(question)]),'the bot cannot supply its own consent');
for(const yes of ['Yes.','Yeah, please text it.','Sure.','Please send the agreement.','Um, yeah, that works.'])assert(check([agent(question),user(yes)]),yes);
for(const objection of ['No.','Yes, but I need to think.','Wait for my spouse.','Do not text me.','Maybe tomorrow.'])assert(!check([agent(question),user(objection)]),objection);
for(const date of ['November 11th, 2026','November eleventh, twenty twenty-six','November eleven, two thousand and twenty-six','2026-11-11','11/11/2026']){
 assert(check([agent(`The cash price is seventy-four thousand dollars, closing ${date}, with a ten-day inspection period. Shall I text it now?`),user('Yes.')]),date);
}
for(const wrong of [question.replace('$74,000','$75,000'),question.replace('November 11','November 12'),question.replace('10-day','5-day'),question.replace('November 11, 2026','30 days from now'),question.replace('may I text you the agreement for review now','is this a good time')])assert(!check([agent(wrong),user('Yes.')]),wrong);
assert(!check([agent(question),user('Yes.'),user('Wait, I changed my mind.')]));
assert(!check([agent(question),user('Yes, $75,000.')]));
assert(!check([agent(question),user('Yes.'),agent(question.replace('10-day','5-day')),user('Yes.')]));
assert(!check([agent(question),user('Yes.')],{...terms,inspectionDays:14}));
assert(!check([agent(question),user('Yes.')],{...terms,closingDate:'2026-11-12'}));
assert(check([agent(question),user('Yes.'),{role:'tool',tool_results:[{result_value:'saved'}]},agent('One moment.')]),'tool receipts and preparation do not erase authorization');
console.log('PASS exact spoken terms and text consent, natural dates, missing readback, wrong terms and later withdrawal. No external contacts.');
