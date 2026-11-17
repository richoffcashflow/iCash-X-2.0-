import assert from 'node:assert/strict';
import {callOfferEvidence,spokenMoneyAmounts,spokenReadbackAmounts,negatedPriceReadback,priceReadbackMention} from '../lib/call-offer-evidence.ts';

const price=9000000,revision='reviewed-price',input={action:'accept_offer',priceCents:price,quoteRevision:revision};
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const receipt={role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,quoteRevision:revision,priceCents:price})}]};
const accepted=[receipt,a('Our cash offer is $90,000. Does that work?'),u('Yes.')];
const evidence=rows=>callOfferEvidence({transcript:rows},input);

assert(evidence(accepted));
for(const prompt of [
 'Old offer was $90,000 but now the purchase price is $60,000, does this cash price work?',
 'The old purchase price was ninety thousand dollars. The new cash offer is sixty thousand dollars. Does it work?',
 'Our cash offer is $60,000. Does that work?',
]){
 assert.equal(evidence([receipt,a(prompt),u('Yes.')]),false,'the presence of an old amount cannot authorize it: '+prompt);
 assert.equal(evidence([...accepted,a(prompt),u('Yes.')]),false,'a new readback invalidates prior acceptance: '+prompt);
 assert.equal(evidence([...accepted,a(prompt)]),false,'an unanswered new readback still invalidates prior acceptance: '+prompt);
}
assert.equal(evidence([...accepted,a('The cash price is now $60,000.'),a('The original cash price is $90,000. Does it work?')]),false,'returning to the old price needs another answer');
assert(evidence([...accepted,a('The cash price is now $60,000.'),a('The original cash price is $90,000. Does it work?'),u('Yes.')]),'fresh exact acceptance may restore the unchanged server quote');
assert(evidence([...accepted,a('The purchase price remains $90,000.')]),'identical readback preserves prior acceptance');
assert(evidence([...accepted,a('What is your full legal name?'),u('Jane Seller.'),a('What closing date works?'),u('December 15, 2026.')]),'ordinary identity and date answers preserve acceptance');

for(const prompt of [
 'We can do $60,000. Does that work?',
 'We can pay $60,000. Does that work?',
 'I could pay sixty thousand dollars. Does that work?',
 'We will buy for $60,000. Does that work?',
 'I would do sixty thousand dollars. Does that work?',
]){
 assert(priceReadbackMention(prompt),prompt);
 assert.equal(evidence([...accepted,a(prompt),u('Yes.')]),false,'an explicit payment commitment changes the prior quote: '+prompt);
 assert.equal(evidence([...accepted,a(prompt)]),false,'a trailing payment commitment invalidates the old answer: '+prompt);
}
for(const prompt of ['We can do $90,000. Does that work?','I would pay ninety thousand dollars. Does that work?'])assert(evidence([receipt,a(prompt),u('Yes.')]),'the same exact payment commitment can be accepted');
for(const prompt of ['We can do a 10-day inspection.','We can do 10 days.','We can do December 15, 2026.','What do you pay for inspections?']){
 assert.equal(priceReadbackMention(prompt),false,'timing and ordinary questions are not payment commitments: '+prompt);
 assert(evidence([...accepted,a(prompt)]),'nonprice statements preserve acceptance');
}

for(const prompt of [
 'Our cash offer is not $90,000. Does that work?',
 'Our purchase price is not ninety thousand dollars. Does that work?',
 'Our cash offer isn’t $90,000. Does that work?',
 'We cannot offer $90,000 cash. Does that work?',
 'We can’t pay $90,000. Does that work?',
 'We will not pay you ninety thousand dollars. Does that work?',
 "We can't do $90,000.",
 'We can’t do ninety thousand dollars. Does that work?',
 'We cannot buy for $90,000.',
 'I could not buy for ninety thousand dollars. Does that work?',
 'We won’t do $90,000. Does that work?',
 'I couldn’t pay you $90,000. Does that work?',
 'The cash offer is no longer $90,000.',
 'The purchase price will no longer be ninety thousand dollars. Does that work?',
]){
 assert(priceReadbackMention(prompt),'a refused purchase still discusses the price: '+prompt);
 assert(negatedPriceReadback(prompt),prompt);
 assert.equal(evidence([receipt,a(prompt),u('Yes.')]),false,'a negated amount is not a price readback: '+prompt);
 assert.equal(evidence([...accepted,a(prompt),u('Yes.')]),false,'negating an already accepted amount reopens confirmation: '+prompt);
 assert.equal(evidence([...accepted,a(prompt)]),false,'a trailing agent denial invalidates the old answer: '+prompt);
 assert(evidence([...accepted,a(prompt),a('Our cash offer is $90,000. Does that work?'),u('Yes.')]),'a fresh positive exact readback can restore acceptance');
}
for(const prompt of [
 'Our cash offer is $90,000, with no financing and no earnest money. Does that work?',
 'Our cash offer is $90,000, not contingent on financing. Does that work?',
 'No, the cash offer is $90,000. Does that work?',
 'Our cash offer is $90,000. Closing is not December 15, 2026. Does that cash price work?',
 'Our cash offer is $90,000. We cannot do financing. Does that cash price work?',
 'Our cash offer is $90,000. We can’t pay your fees. Does that cash price work?',
 'Our cash offer is $90,000. We cannot do 10 days. Does that cash price work?',
 'Our cash offer is $90,000. We cannot buy for another person. Does that cash price work?',
 'Our cash offer is $90,000. Closing is no longer December 15, 2026. Does that cash price work?',
]){
 assert.equal(negatedPriceReadback(prompt),false,'unrelated negation is not price denial: '+prompt);
 assert(evidence([receipt,a(prompt),u('Yes.')]),prompt);
 assert(evidence([...accepted,a(prompt)]),'unchanged price with unrelated negation preserves acceptance');
}

for(const prompt of [
 'The purchase price is $90,000 cash, closing 2026-12-15, with a 10-day inspection period. Does that cash price work?',
 'The purchase price is ninety thousand dollars cash, closing December 15, 2026, with a ten-day inspection period. Does that cash price work?',
 'The purchase price is ninety thousand dollars, closing December fifteenth, twenty twenty-six, with a ten-day inspection period. Does that cash price work?',
 'The purchase price is $90,000 cash, closing 12/15/2026, with a 0-day inspection period. Does that cash price work?',
]){
 assert.deepEqual(spokenReadbackAmounts(prompt),[price],prompt);
 assert(evidence([receipt,a(prompt),u('Yes.')]),'calendar/duration numbers cannot manufacture a conflicting price: '+prompt);
}
assert.deepEqual(spokenReadbackAmounts('The purchase price is zero dollars with a 10-day inspection.'),[0],'zero dollars remains an amount');
assert.equal(evidence([...accepted,a('The cash purchase price is zero dollars with a 10-day inspection.')]),false,'zero-dollar price is a real change');
assert.deepEqual(spokenMoneyAmounts('Repairs cost $10,000 and the mortgage is $40,000.'),[1000000,4000000],'debt and repair extraction stays unchanged');
console.log('PASS exact spoken price readbacks, changed/ambiguous agent turns, original quote continuity and calendar/duration separation.');
