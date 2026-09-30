import assert from 'node:assert/strict';
import {dealTermsSchema,renderDealDocument} from '../lib/deal-documents.ts';
import {acceptedFundingTerms,fundingTermsVersion} from '../lib/funding-consent.ts';
const terms=dealTermsSchema.parse({buyer:'Example LLC',seller:'Seller <script>alert(1)</script>',priceCents:15000000,address:'Fixture only'});
for(const kind of ['purchase','assignment','buyer_package','title_packet']){const html=renderDealDocument(kind,terms);assert.match(html,/UNSIGNED DRAFT/);assert.doesNotMatch(html,/<script>/);assert.match(html,/No signature, deposit, title acceptance or closing is confirmed/);}
assert.match(renderDealDocument('purchase',terms),/\$150,000.00/);
assert.match(renderDealDocument('assignment',terms),/Deposit is refundable if/);
assert.match(renderDealDocument('assignment',terms),/contractual purchaser interest only/);
assert.match(renderDealDocument('title_packet',terms),/preference only/);
assert.throws(()=>dealTermsSchema.parse({priceCents:-100}));assert.throws(()=>dealTermsSchema.parse({inspectionDays:1000}));
assert.equal(acceptedFundingTerms({accepted:true,version:fundingTermsVersion}),true);assert.equal(acceptedFundingTerms({accepted:false,version:fundingTermsVersion}),false);assert.equal(acceptedFundingTerms({accepted:true,version:'old'}),false);
console.log('Draft terms, XSS escaping, deposit exceptions, missing terms and explicit versioned consent passed');
const {planningEstimate}=await import('../lib/funding-forecast.ts');
assert.deepEqual(planningEstimate(2000,{lookup_cents:10,voice_minute_cents:100,lookup_share_percent:20,call_minutes_low:2,call_minutes_high:5}),{lookups:40,minutes:16,callsLow:3,callsHigh:8});
assert.throws(()=>planningEstimate(999,{lookup_cents:10,voice_minute_cents:100,lookup_share_percent:20,call_minutes_low:2,call_minutes_high:5}));
