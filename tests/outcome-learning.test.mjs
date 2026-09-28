import assert from 'node:assert/strict';
import {summarizeOutcomes} from '../lib/outcome-learning.ts';
const now=Date.parse('2026-09-28T00:00:00Z');
const c={account_id:'a',deal_id:'d',mode:'live',strategy_key:'s1',market:'Dallas',channel:'voice',assigned_at:'2026-01-01T00:00:00Z'};
const e=(kind,id='op1',cost=0)=>({account_id:'a',deal_id:'d',event_key:kind+id,operation_id:id,kind,occurred_at:'2026-02-01T00:00:00Z',provider_cost_micros:cost});
const events=[e('attempt'),e('attempt','op2'),e('connected'),e('response'),e('response','op2'),e('contract'),e('closed'),e('cost','op1',1000),e('cost','op2',2000)];
const [r]=summarizeOutcomes('a',[c],[...events,events[0]],now);
assert.equal(r.attempts,2);assert.equal(r.responseRate,1);assert.equal(r.connectionRate,.5);assert.equal(r.providerCostMicros,3000);assert.equal(r.contracts,1);assert.equal(r.maxSuggestedShift,0);
assert.deepEqual(summarizeOutcomes('a',[{...c,mode:'test'}],events,now),[]);
assert.throws(()=>summarizeOutcomes('b',[c],events,now));
assert.equal(summarizeOutcomes('a',[c],[e('attempt')],now)[0].attemptCostsComplete,false);
assert.equal(summarizeOutcomes('a',[c],[],now)[0].responseRate,null);
assert.equal(summarizeOutcomes('a',[c],[e('attempt'),e('opt_out')],now)[0].recommendation,'review_outreach');
assert.equal(summarizeOutcomes('a',[c],[e('attempt'),{...e('response'),occurred_at:'2027-01-01'}],now)[0].responded,0);
console.log('Outcome learning isolation, deduplication, denominators and budget gates passed');

const recent={...c,deal_id:'recent',assigned_at:'2026-09-27T00:00:00Z'};
assert.equal(summarizeOutcomes('a',[c,recent],events,now).length,2);
