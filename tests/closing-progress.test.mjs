import assert from 'node:assert/strict';
import {closingUpdateSchema,closingSummary} from '../lib/closing-progress.ts';
const id='12345678-1234-4234-8234-123456789abc';
const update={dealId:id,replyId:id,kind:'title_opened',confirmed:true,effectiveDate:null,amountCents:null,fileReference:''};
assert(closingUpdateSchema.safeParse(update).success);
for(const patch of [{confirmed:false},{kind:'paid'},{kind:'deposit_received'},{kind:'closing_scheduled'},{effectiveDate:'2026-02-30'},{amountCents:-1}])assert(!closingUpdateSchema.safeParse({...update,...patch}).success);
assert(closingSummary([]).label.includes('Waiting'));
assert.equal(closingSummary([{kind:'closed'}]).next,'Review your closing statement for your fee and payment timing.');
console.log('Closing milestones require reviewed evidence, valid amounts/dates and do not imply proceeds paid.');
