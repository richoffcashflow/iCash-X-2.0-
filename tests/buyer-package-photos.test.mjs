import assert from 'node:assert/strict';
import {buyerPackagePhotos} from '../lib/buyer-package-photos.ts';
import {renderBuyerPackage} from '../lib/buyer-disposition.ts';
import {calculateAutomaticCallOffer} from '../lib/automatic-call-offer.ts';
const seller={url:'https://api.contiguity.com/attachments/property-photo',mime:'image/jpeg'};
const photos=buyerPackagePhotos({latitude:30.03,longitude:-97.79,sellerPhotos:[seller,seller,{...seller,url:'https://evil.invalid/attachments/pic.jpg'},{...seller,mime:'image/svg+xml'},{url:'https://api.contiguity.com/attachments/contract.pdf',mime:'application/pdf'},{url:'https://api.contiguity.com/attachments/interior.png',filename:'interior.png'}]});
assert.equal(photos.length,3);assert(photos[0].url.startsWith('https://img.dealmachine.com/sv/30.03,-97.79'));
assert.equal(photos[1].caption,'Seller-provided property photo');
assert.deepEqual(buyerPackagePhotos({latitude:0,longitude:0}),[]);
const html=renderBuyerPackage({address:'123 Main <Street>',principal:'Fixture',purchasePriceCents:15227050,assignmentFeeCents:1000000,askingPriceCents:16227050,repairsCents:null,arvCents:null,closingDate:'2026-11-07',businessPhone:'+12145550188',fetchedAt:null,latitude:30.03,longitude:-97.79,sellerPhotos:[seller]});
assert(html.includes('Property photos'));assert(html.includes('123 Main &lt;Street&gt;'));assert.equal((html.match(/<img /g)||[]).length,2);assert(html.includes('$162,270.50'));assert(!html.includes('onerror'));
const quote=calculateAutomaticCallOffer({party:'buyer',buyer:{askingPriceCents:16227050,purchasePriceCents:15227050,assignmentFeeCents:1000000,address:'123 Main',closingDate:'2026-11-07'}},{});
assert.equal(quote.closingDateSpoken,'November 7, 2026');assert.equal(quote.viewingStatus,'needs_confirmation');assert.match(quote.spokenViewingFollowup,/check with the seller and get back/);
// The October 9 handset test incorrectly combined the included assignment fee
// with additional buyer closing costs. Supply an explicit, server-written line.
assert.equal(quote.closingCostsIncluded,false);assert.equal(quote.buyerPaysClosingCosts,true);
assert.match(quote.spokenOffer,/AI assistant for the contract holder/);assert.match(quote.spokenOffer,/one hundred sixty-two thousand two hundred seventy dollars and fifty cents/);assert.match(quote.spokenOffer,/closing costs separately/);assert.match(quote.spokenOffer,/November 7, 2026/);assert(!/152,270|10,000|purchasePriceCents|assignmentFeeCents/.test(JSON.stringify(quote)));
assert(quote.instruction.includes(quote.spokenOffer));assert.match(quote.instruction,/Read spokenOffer exactly/);
console.log('Buyer gallery and spoken terms: exact price/date, seller raster images, escaping, CDN allowlist and pending viewing language passed.');
