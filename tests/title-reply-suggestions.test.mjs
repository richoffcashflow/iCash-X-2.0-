import assert from 'node:assert/strict';
import {titleReplySuggestions} from '../lib/title-reply-suggestions.ts';
const suggest=body_text=>titleReplySuggestions({id:'reply',sender:'title@example.invalid',subject:'File update',body_text,received_at:'2026-10-10T12:00:00Z'});
assert.equal(suggest('We opened your title file.')[0].kind,'title_opened');
assert.deepEqual(suggest('Closing is scheduled for October 22, 2026.')[0],{replyId:'reply',kind:'closing_scheduled',effectiveDate:'2026-10-22',amountCents:null,fileReference:'',evidence:'Closing is scheduled for October 22, 2026.'});
assert.equal(suggest('We received the $2,000.00 earnest money deposit.')[0].amountCents,200000);
assert.equal(suggest('The transaction has closed on 2026-10-22.')[0].kind,'closed');
assert.equal(suggest('Proceeds of $8,000 were sent on 2026-10-23, payment reference: ABC-123.')[0].fileReference,'ABC-123');
assert.equal(suggest('Closing is set for February 30, 2027.')[0].effectiveDate,null);
assert.equal(suggest('Closing is scheduled for tomorrow.')[0].effectiveDate,null);
assert.equal(suggest('Deposit received: $2,000 and $500.')[0].amountCents,null);
for(const body of ['We have not received the deposit.','The deposit will be received tomorrow.','If the funds are sent, we can close.','We expect the transaction to be closed on October 22, 2026.','Has the deposit been received?','Closing is not scheduled.','Please review.\nOn Monday, Title wrote:\nThe transaction has closed.','Thanks\n> We received the $2000 deposit.'])assert.equal(suggest(body).length,0,body);
for(const body of ["The deposit wasn't received.","The funds weren't disbursed.","We didn't receive the deposit.","The title file isn't open.","The transaction hasn’t closed.","The deposit wasn’t received.","We won’t say the transaction closed.","The payment can't be marked sent."]){
 assert.deepEqual(suggest(body),[],body);
}
// A request for verification is not the verification itself, even without a question mark.
for(const body of [
 'Please confirm the deposit was received.',
 'We need to confirm the deposit was received.',
 'We require to verify that the title file is open.',
 'Please provide written confirmation that the deposit was received.',
 'Can you confirm the funds were sent.',
 'We need confirmation that the transaction has closed.',
 'Please verify that the title file is open.',
 'Confirm the closing is scheduled for 2026-11-22.',
 'Has the deposit been received.',
 'We require written confirmation that payment was sent.',
 'The funds may have been sent.',
 'The payment might already have been sent.',
 'The funds can be sent on 2026-11-22.',
])assert.deepEqual(suggest(body),[],body);

// Reversed funds and conflicting updates must never retain the first positive suggestion.
for(const body of [
 'The deposit was received but it was returned to the buyer.',
 'Correction: the funds were sent in error and returned.',
 'The deposit was received. The deposit was returned to the buyer.',
 'The payment was sent. It was reversed.',
 'The payment was sent. It was delayed.',
 'The deposit was received. It was never received.',
 'The deposit was received. Please provide confirmation that the deposit was received.',
 'Deposit received $2,000. Correction: amount was $1,000.',
 'The payment was sent. Correction: that statement was incorrect.',
 'Closing is scheduled for 2026-11-22. Closing is canceled.',
 'Closing is scheduled for Nov. 22, 2026. The closing date was changed to Dec. 3, 2026.',
 'Closing is scheduled for Nov. 22, 2026. The date moved to Dec. 3, 2026.',
 'The deposit was received. The deposit was not received.',
 'Closing is scheduled for 2026-12-15. Correction: closing is scheduled for 2026-12-18.',
 'We received the $2,000 deposit. Correction: we received the $1,000 deposit.',
 'Proceeds were sent, payment reference: ABC-123. Proceeds were sent, payment reference: ABC-456.',
])assert.deepEqual(suggest(body),[],body);

// Keep other supported milestones and consistent repetition; do not combine unrelated evidence.
assert.deepEqual(suggest('We opened your title file. Please confirm the deposit was received.').map(s=>s.kind),['title_opened']);
assert.deepEqual(suggest('We opened your title file. The deposit was received. The deposit was returned.').map(s=>s.kind),['title_opened']);
assert.equal(suggest('The deposit was received. We received the $2,000 deposit.')[0].amountCents,200000);
assert.equal(suggest('The deposit was received. The deposit was received.').length,1);
assert.equal(suggest('We confirm the deposit was received.')[0].kind,'deposit_received');
assert.equal(suggest('The deposit was received. We returned a copy of the agreement to the buyer.')[0].kind,'deposit_received');
assert.equal(suggest('We opened your title file. Signed documents were returned to the seller.')[0].kind,'title_opened');
assert.equal(suggest('The deposit was received. This mailbox is not monitored.')[0].kind,'deposit_received');
assert.equal(suggest('The deposit was received. That document was returned to the seller.')[0].kind,'deposit_received');
assert.equal(suggest('We opened your title file. The buyer corrected their mailing address.')[0].kind,'title_opened');
assert.equal(suggest('We can confirm that payment was sent.')[0].kind,'funds_disbursed');
for(const [date,expected] of [['Nov. 22, 2026','2026-11-22'],['Sept. 3, 2026','2026-09-03'],['May 3, 2027','2027-05-03']]){
 const body=`Closing is scheduled for ${date}.`;
 assert.equal(suggest(body)[0].effectiveDate,expected,body);
 assert.equal(suggest(body)[0].evidence,body,body);
}
assert.deepEqual(suggest('The deposit was received '+(' '.repeat(1000))+'on 2026-11-22.'),[]);
assert.deepEqual(suggest('The deposit was received.\n'+(' '.repeat(16000))+'The deposit was returned.'),[]);
assert.equal(suggest('The deposit was received.\nOn Monday, Title wrote:\nThe deposit was returned.')[0].kind,'deposit_received');
console.log('Title suggestions: requests, reversals, conflicting corrections, complete evidence, dates and ordinary confirmation fixtures passed.');
