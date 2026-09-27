import assert from 'node:assert/strict';
import { milestoneMessage, creditPrompt } from '../lib/engagement.ts';
assert.equal(milestoneMessage({id:'e1',kind:'contract_signed',opportunityId:'o1',verifiedAt:1,source:'signed_document'}).title,'Deal under contract');
assert.throws(()=>milestoneMessage({id:'',kind:'contract_signed',opportunityId:'o1',verifiedAt:1,source:'signed_document'}));
assert.equal(creditPrompt({balanceCents:100,nextRequiredChargeCents:900,activeOpportunities:1,pausedForCredits:true})?.minimumTopUpCents,2000);
assert.equal(creditPrompt({balanceCents:100,nextRequiredChargeCents:900,activeOpportunities:0,pausedForCredits:true}),null);
assert.equal(creditPrompt({balanceCents:100,nextRequiredChargeCents:900,activeOpportunities:1,pausedForCredits:false}),null);
console.log('engagement checks passed');
