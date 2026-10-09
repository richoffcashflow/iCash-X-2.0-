import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
import {renderBuyerPackage} from '../lib/buyer-disposition.ts';
import {buyerReceptionVariables} from '../lib/buyer-reception-context.ts';
const now=Date.parse('2026-10-09T19:00:00Z');
const buyer={address:'45 Fixture Lane',purchasePriceCents:15227050,assignmentFeeCents:1000000,askingPriceCents:16227050,depositCents:200000,closingDate:'2026-11-07'};
test('impossible closing dates are not spoken as rolled-over dates',()=>{
 for(const closingDate of ['2026-02-30','2026-11-31','2026-13-07','tomorrow',null]){
  const r=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,closingDate}},{},now);
  assert.equal(r.closingDate,null);assert.match(r.spokenOffer,/closing date needs confirmation/);
 }
 const stale=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,closingDate:'2026-10-01'}},{},now);
 assert.equal(stale.quoteAllowed,false);assert.equal(stale.reason,'buyer_terms_stale');
});
test('oversized or corrupt buyer prices fail closed without throwing during a call',()=>{
 for(const askingPriceCents of [100000000001,NaN,Infinity,-1,1.5,'16227050'])assert.equal(calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,askingPriceCents}},{},now).quoteAllowed,false);
});
test('voice receives supplied photo counts and research estimates, never raw attachments',()=>{
 const b={...buyer,latitude:30.03,longitude:-97.79,sellerPhotos:[{url:'https://api.contiguity.com/attachments/fixture.jpg',mime:'image/jpeg'},{url:'https://untrusted.example/a.jpg',mime:'image/jpeg'}],arvCents:25000000,repairsCents:2000000};
 const r=calculateAutomaticCallOffer({party:'buyer',buyer:b},{},now);
 assert.equal(r.propertyPhotoCount,2);assert.equal(r.sellerPhotoCount,1);assert.equal(r.estimatedArvCents,25000000);assert.equal(r.estimatedRepairsCents,2000000);
 assert(!JSON.stringify(r).includes('https://api.contiguity.com'));assert.match(r.instruction,/not guarantees or an inspection/);
 const empty=calculateAutomaticCallOffer({party:'buyer',buyer},{},now);assert.equal(empty.propertyPhotoCount,0);assert.equal(empty.estimatedArvCents,null);
});
test('unconfirmed title and buyer exceptions have explicit review boundaries',()=>{
 const r=calculateAutomaticCallOffer({party:'buyer',buyer:{...buyer,titleSelectionStatus:'needs_confirmation'}},{},now);
 assert.match(r.instruction,/title contact is recorded but needs confirmation/);assert.match(r.instruction,/not an accepted change/);assert.match(r.instruction,/forfeited under every circumstance/);assert.match(r.instruction,/cannot text\/email a package/);
});
test('buyer package, call tool and model context omit acquisition cost and spread',()=>{
 const quote=calculateAutomaticCallOffer({party:'buyer',buyer},{},now);
 for(const key of ['purchasePriceCents','assignmentFeeCents'])assert(!Object.hasOwn(quote,key),key);
 assert(!/15227050|1000000|152,270\.50|10,000/.test(JSON.stringify(quote)));
 const variables=buyerReceptionVariables({...buyer,status:'buyer'});
 assert(!/purchasePriceCents|assignmentFeeCents|15227050|1000000/.test(variables.icash_property_context));
 for(const details of [buyer,{...buyer,purchasePriceCents:undefined,assignmentFeeCents:undefined}]){
  const html=renderBuyerPackage({...details,principal:'Fixture',repairsCents:null,arvCents:null,businessPhone:null,fetchedAt:null});
  assert.match(html,/\$162,270\.50/);assert.match(html,/\$2,000\.00/);
  assert(!/\$152,270\.50|\$10,000|Purchase contract<\/dt>|Assignment fee<\/dt>|fee shown above/.test(html));
 }
});
