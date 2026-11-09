import assert from 'node:assert/strict';
import {sellerContext,sellerTurn,now} from './helpers/course-funnel-fixture.mjs';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
globalThis.fetch=async()=>{throw Error('NETWORK DISABLED');};
const responses=[['Yes','accept'],['No','counter'],['No thanks','refusal'],['Stop texting me','refusal'],['Could you do $120,000?','counteroffer'],['Yes only if we close tomorrow','condition'],['I need $120,000 net','net'],['There is new foundation damage','changed'],['Who pays closing costs?','costs'],['How does this work?','process']];
let count=0;
for(const value of [100000,175000,200000,299999,300000,450000])for(const repairs of [0,10000,28000,60000])for(const payoff of [0,10000,80000]){
 const seed=sellerContext({value,repairs,payoff});const initial=sellerTurn(seed,'I need $900,000').plan;
 const ceilingCents=Math.floor(value*100*0.7)-repairs*100-(value>=300000?20000:10000)*100;
 if(ceilingCents<=0){
  assert.equal(initial.kind,'review');assert.equal(initial.reason,'calculation_required');
  assert.equal(initial.state.quotedPriceCents??null,null);assert.equal(initial.state.acceptedPriceCents??null,null);
  const acceptance=sellerTurn(seed,'Yes').plan;
  assert.equal(acceptance.kind,'review');assert.equal(acceptance.state.acceptedPriceCents??null,null);
  count++;continue;
 }
 assert(['cash_offer','payoff'].includes(initial.action),`${value}/${repairs}/${payoff}: ${initial.reason}`);
 for(const delivery of ['delivered','accepted','failed'])for(const [body,kind] of responses){
  const c=structuredClone(seed),outgoing=c.messages.at(-1);
  outgoing.state=delivery;
  if(delivery!=='delivered')outgoing.providerId=null;
  const {plan}=sellerTurn(c,body);
  const label=`${value}/${repairs}/${payoff}/${delivery}/${kind}`;
  assert.notEqual(plan.kind,'agreement',label+': no signing before exact identity/terms/text confirmation');
  if(delivery!=='delivered'){
   assert.equal(plan.kind,delivery==='accepted'?'wait':'review',label);
   assert.equal(plan.state.acceptedPriceCents,null,label+': a reply cannot accept an undelivered offer');
  }else if(kind==='refusal'){
   assert.equal(plan.kind,'review',label);assert.equal(plan.state.acceptedPriceCents,null,label);
  }else if(initial.action==='cash_offer'&&kind==='accept'){
   assert.equal(plan.action,'legal_name',label);assert.equal(plan.state.acceptedPriceCents,initial.state.quotedPriceCents,label);
  }else{
   assert.equal(plan.state.acceptedPriceCents,null,label+': a question/condition is not acceptance');
   if(initial.action==='cash_offer'&&kind==='counter')assert.equal(plan.action,'seller_counterprice',label);
   if(kind==='costs')assert.equal(plan.action,'explain_costs',label);
   if(kind==='process')assert.equal(plan.action,'explain_process',label);
  }
  if(plan.body)assert(plan.body.length<=160,label+': one-segment conversation');
  count++;
 }
}
// Course sequence: $175k value and $28k repairs -> $84k rounded proposal.
const course=sellerContext();let r=sellerTurn(course,'I do not have a price in mind');
assert.equal(r.plan.state.quotedPriceCents,8400000);assert.equal(r.plan.action,'cash_offer');
r=sellerTurn(course,'Yes');assert.equal(r.plan.action,'legal_name');
r=sellerTurn(course,'My full legal name is Tim Fixture');assert.equal(r.plan.action,'owners');
r=sellerTurn(course,'I am the sole owner and only decision maker');assert.equal(r.plan.action,'closing_date');
const close=new Date(now+30*86400000).toISOString().slice(0,10);
r=sellerTurn(course,close);assert.equal(r.plan.action,'inspection');
r=sellerTurn(course,'Yes');assert.equal(r.plan.action,'confirm_terms');
const confirm=structuredClone(course);
r=sellerTurn(course,'Yes, you can text the agreement');assert.equal(r.plan.kind,'agreement');assert.equal(r.plan.terms.priceCents,8400000);
for(const answer of ['No','Wait','Yes, but change the price','My brother also owns the property','Send it if we close tomorrow']){
 const c=structuredClone(confirm);assert.notEqual(sellerTurn(c,answer).plan.kind,'agreement',answer);count++;
}
// A low counteroffer resumes automatically; it is never accepted on the seller's behalf.
const counter=sellerContext();sellerTurn(counter,'I need $200,000');
assert.equal(sellerTurn(counter,'No').plan.action,'seller_counterprice');
r=sellerTurn(counter,'$80,000');assert.equal(r.plan.action,'cash_offer');assert.equal(r.plan.state.quotedPriceCents,8000000);assert.equal(r.plan.state.acceptedPriceCents,null);
assert.equal(sellerTurn(counter,'Yes').plan.action,'legal_name');
// No repeat loop: two delivered unanswered requests then a specific review step.
const repeated=structuredClone(counter);
for(let n=0;n<3;n++)r=sellerTurn(repeated,'hmm');
assert.equal(r.plan.kind,'review');assert.equal(r.plan.reason,'seller_answer_unclear');
// Receipt/research ages are checked without rewriting timestamps or source history.
const stale=sellerContext();sellerTurn(stale,'I need $200,000');
stale.snapshot.fetchedAt=new Date(now-2*86400000).toISOString();
const stalePlan=sellerTurn(stale,'Yes').plan;assert.equal(stalePlan.kind,'review');assert.equal(stalePlan.reason,'current_research_required');
assert.equal(planSellerTextOffer({...stale,sourceId:'missing'},now).reason,'source_required');
console.log(`PASS ${count} seller scenario combinations plus the course-to-agreement replay, lower counteroffer, bounded repetition and stale-source checks. Offline only.`);
