import assert from 'node:assert/strict';
import {sellerPayoffRecovery,sellerPayoffEvidence} from '../lib/seller-payoff.ts';
import {callOfferEvidence} from '../lib/call-offer-evidence.ts';
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const pair=[a('What is the current mortgage payoff balance?'),u('The payoff is $20,000.'),a('Are there any other loans, liens, unpaid taxes or HOA balances besides that mortgage?'),u('No.')];
const acceptance=[a('The cash offer is $85,000, subject to title verification. Does that work?'),u('Yes.')];
const evidence=turns=>sellerPayoffRecovery({transcript:turns},2000000,8500000);
assert.deepEqual(evidence(pair),{report:{mortgageCents:2000000,otherDebtCents:0},acceptedAfterReport:false});
assert.deepEqual(evidence([...pair,...acceptance]),{report:{mortgageCents:2000000,otherDebtCents:0},acceptedAfterReport:true});
assert.equal(evidence([...acceptance,...pair]).acceptedAfterReport,false,'acceptance before missing debt does not bridge revisions');
for(const answer of ['No, but there may be unpaid taxes.','Not sure.','No, except an unknown HOA balance.','Another $10,000.','No, maybe.','No, I think.','No, but I might owe a tax bill.','No, there could be another loan.']){
 assert.equal(evidence([...pair.slice(0,-1),u(answer),...acceptance]),null,answer);
}
for(const tail of [
 [u('Actually I owe another loan.')], [u('Actually there is a tax bill.')], [u('There is also a judgment for $80,000.')], [a('Are you certain there are no other financial obligations?'),u('I do not know.')], [u('I am not sure about the taxes.')],
 [a('Is there another mortgage?'),u('Not sure.')], [a('What is the current mortgage payoff balance?'),u('$25,000.')],
 [a('Are there unpaid taxes?'),u('Yes.')],
])assert.equal(evidence([...pair,...acceptance,...tail]),null,'later debt cannot reuse the earlier zero');
for(const tail of [[u('Wait, do not send it.')],[u('Yes, but I need $100,000.')],[u('I need my spouse to approve first.')]])assert.equal(evidence([...pair,...acceptance,...tail]).acceptedAfterReport,false,'later withdrawal prevents continuity');
const finalOwnerQuestion=[...pair];finalOwnerQuestion[2]=a('Are there any other loans, liens, unpaid taxes or HOA balances? Are you the only owner?');
assert.equal(evidence(finalOwnerQuestion),null,'the final question determines what no means');
const onlyLienQuestion=[...pair];onlyLienQuestion[2]=a('Are there any other liens?');assert.equal(evidence(onlyLienQuestion),null,'a lien-only question is not the complete debt inventory');
const missingMortgage=pair.slice(2);assert.equal(evidence(missingMortgage),null);
const wrongMortgage=[...pair];wrongMortgage[1]=u('$50,000.');assert.equal(evidence(wrongMortgage),null,'saved mortgage must match this call');
const repair=[...pair];repair[0]=a('What is the total repair budget?');assert.equal(evidence(repair),null);
const unknownBetween=[...pair.slice(0,2),a('Can you confirm the payoff?'),u('I do not know.'),...pair.slice(2)];assert.equal(evidence(unknownBetween),null);
const old='a'.repeat(64),current='b'.repeat(64),third='c'.repeat(64),priceCents=8500000;
const receipt=(quoteRevision,price=priceCents)=>({role:'tool',tool_results:[{tool_name:'icash_offer_and_contract',result_value:JSON.stringify({quoteAllowed:true,quoteRevision,priceCents:price})}]});
const call=rows=>callOfferEvidence({transcript:rows},{action:'accept_offer',priceCents,quoteRevision:current},{previousQuoteRevision:old});
assert.equal(call([receipt(old),...acceptance,receipt(current)]),true,'trusted two-revision continuation retains the original spoken answer');
assert.equal(call([receipt(old),...acceptance,receipt(third),receipt(current)]),false,'a third revision cannot bridge old acceptance');
assert.equal(call([receipt(old),...acceptance,receipt(current,9000000)]),false,'changed price cannot bridge');
assert.equal(call([receipt(old),...acceptance,receipt(current),u('Do not send it.')]),false);
assert.equal(callOfferEvidence({transcript:[receipt(old),...acceptance,receipt(current)]},{action:'accept_offer',priceCents,quoteRevision:current,previousQuoteRevision:old}),false,'model input cannot supply the trusted alias');
console.log('PASS missing-debt recovery bounds, final-question grounding, later unknown/correction/withdrawal, and server-only two-revision continuity.');

for(const answer of ['No, maybe.','No, I think.','No, but I might owe a tax bill.','No, there could be another loan.'])assert.equal(sellerPayoffEvidence({transcript:[pair[2],u(answer)]},{action:'report_change',sellerStatement:answer}),null,'explicit report must preserve uncertainty too');
