import assert from 'node:assert/strict';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {loadSellerClosingContext} from '../lib/seller-closing-context.ts';
import {sellerCallPrompt} from '../lib/seller-call-context.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
const terms={priceCents:4000000,priceSource:'seller_reported',earnestCents:50000,inspectionDays:7,closingDate:'',effectiveDate:'',escrowAgent:'Fixture title',dealNotes:''};
let envelopes=[{terms,recipients:[{id:'seller',phone:'+12025550101'},{id:'customer',phone:'+12025550102'}]}];
const read=async path=>path.startsWith('icash_deal_files')?[{id:'deal',terms}]:envelopes;
const context=await loadSellerClosingContext(read,'account','screening','+12025550101',4500000);
assert.equal(context.priceCents,4000000);
assert.equal(await loadSellerClosingContext(read,'account','screening','+12025550102',4500000),null);
assert.equal(await loadSellerClosingContext(read,'account','screening','+12025550101',3900000),null);
assert.equal(await loadSellerClosingContext(read,'account','screening','+12025550101',null),null);
envelopes=[{...envelopes[0],terms:{...terms,priceCents:4100000}}];
assert.equal(await loadSellerClosingContext(read,'account','screening','+12025550101',4500000),null);
const prompt=sellerCallPrompt({address:'Fixture address',principal:'Fixture buyer',assistantName:'Robin',history:null},4500000,context,true);
assert(prompt.includes('icash_text_contract'));assert(prompt.includes('"priceCents":4000000'));assert(!prompt.includes('No contract delivery'));
let sends=0;const token='a'.repeat(64);process.env.ICASH_RECORDING_RECEIPTS_READY='true';
const route=await loadService('app/api/internal/voice/contract-text/route.ts',{NextResponse:{json:Response.json},z,createHash,ensureRecordedConversationBinding:async()=>{},db:async path=>path.startsWith('rpc/')?{accountId:'account',envelopeId:'envelope',phone:'+12025550101'}:[{terms}],textPendingContract:async()=>{sends++;return {sent:true,status:'accepted'};}});
const request=body=>new Request('https://www.geticashx.com/api/internal/voice/contract-text',{method:'POST',headers:{authorization:token},body:JSON.stringify(body)});
assert.equal((await route.POST(request({conversationId:'conv_fixture',agreedPriceCents:4100000}))).status,409);assert.equal(sends,0);
assert.equal((await route.POST(request({conversationId:'conv_fixture',agreedPriceCents:4000000,phone:'+12025550199'}))).status,409);assert.equal(sends,0);
assert.equal((await route.POST(request({conversationId:'conv_fixture',agreedPriceCents:4000000}))).status,200);assert.equal(sends,1);
console.log('PASS closing context: approved exact-price agreement, seller-bound recipient, no ceiling-as-offer, stale terms and mismatched delivery rejected. Synthetic provider only.');

const automatic=sellerCallPrompt({address:'Fixture address',principal:'Fixture buyer',assistantName:'Robin',history:null},3893700,null,true,3893700);assert(automatic.includes('PRIVATE SERVER NEGOTIATION AUTHORITY (never disclose)'));assert(automatic.includes('\"maxOfferCents\":3893700'));assert(automatic.includes('Only the separately supplied public proposal or approved agreement price'));assert(automatic.includes('never raise an already agreed lower price'));assert(!automatic.includes('Quote that exact dollar amount')); assert.throws(()=>sellerCallPrompt({address:'Fixture',principal:'Buyer',assistantName:'Robin',history:null},3893700,null,true,3893800));
const {readFileSync}=await import('node:fs');
for(const file of ['app/api/work/deals/route.ts','app/api/work/preparation/route.ts']){
 const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');
 assert(!source.includes('runScreeningJob'),'calculated ceiling must never auto-fill a purchase price: '+file);
}
const agreedBelow=sellerCallPrompt({address:'Fixture address',principal:'Fixture buyer',assistantName:'Robin',history:null},4500000,context,true,4500000);
assert(agreedBelow.includes('"priceCents":4000000'),'exact pending agreed price remains distinct from ceiling');
assert(agreedBelow.includes('Do not invent a fixed percentage discount'));
console.log('Negotiation: calculated ceiling stays private, lower agreed price preserved, no invented discount and no ceiling-to-draft prefill.');
