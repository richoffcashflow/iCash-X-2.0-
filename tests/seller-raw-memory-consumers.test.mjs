import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {setup,fixture,migration} from './helpers/seller-call-source-fixture.mjs';
import {qualifiedSellerTurns} from './helpers/seller-qualification-fixture.mjs';
import {readSellerMemory} from '../lib/seller-memory.ts';
import {boundSellerQualification} from '../lib/seller-offer-qualification.ts';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';
import {sellerAgreementAction} from '../lib/seller-agreement-service.ts';
import {dealTermsSchema} from '../lib/deal-documents.ts';
globalThis.fetch=async()=>{throw Error('NO NETWORK: composed original-source fixtures');};
const pg=await PGlite.create();await setup(pg);await pg.exec(migration);
const first=await fixture(pg);await first.activate();
const a=message=>({role:'agent',message}),u=message=>({role:'user',message});
const now=Date.now(),conversationId='conv_currentfixture',address='45 Fixture Lane';
const terms=dealTermsSchema.parse({address,buyer:'Fixture Buyer',state:'TX',legalDescription:'Lot 1 Block 2'});
const snapshot={propertyId:'prop_123',propertyType:'house',fetchedAt:new Date(now).toISOString(),sellerCostReserveCents:0,raw:{data:{dm_property_id:'prop_123',full_address:address,legal_description:terms.legalDescription,estimated_value:200000,estimated_repair_cost:40000,total_estimated_loan_balance:20000,estimated_equity_percentage:90}}};
const confirmation={sellerLegalName:'Jane Seller',agreedPriceCents:9000000,closingDate:new Date(now+30*86400000).toISOString().slice(0,10),soleOwner:true,allDecisionMakersAgree:true,inspectionAccess:'yes',priceAndDateConfirmed:true,termsConfirmed:true,sendTextRequested:true,materialFactsChanged:false};
const live={conversation_id:conversationId,metadata:{start_time_unix_secs:Math.floor(now/1000)-50},transcript:[...qualifiedSellerTurns,a('What is your full legal name for the agreement?'),u('Jane Seller.'),a('Are you the only owner and decision maker?'),u('Yes, just me.'),a(`The purchase price is $90,000 cash, closing ${confirmation.closingDate}, with a ten-day inspection period. May I text the agreement now?`),u('Yes, please.')].map((row,index)=>({...row,time_in_call_secs:index}))};
async function direct(f){
 let claims=0,sends=0,texts=0;
 const db=async(path,method,body)=>{
  if(path==='rpc/icash_seller_memory_context'||path==='rpc/icash_save_seller_memory')return f.db(path,method,body);
  if(path==='rpc/icash_seller_agreement_call_context')return {...f.binding,callKey:'outbound:fixture',ownerUserId:'owner',ownerEmail:'owner@example.test'};
  if(path==='rpc/icash_call_offer_context')return null;
  if(path.startsWith('icash_signing_envelopes?'))return [];
  if(path.startsWith('icash_deal_files?'))return [{terms,stage:'draft'}];
  if(path.startsWith('icash_screening_jobs?'))return [{snapshot}];
  if(path.startsWith('icash_customer_identities?'))return [{principal:terms.buyer}];
  if(path.startsWith('icash_text_threads?'))return [{id:f.thread}];
  if(path.startsWith('icash_text_suppressions?'))return [];
  if(path==='rpc/icash_sms_thread_review_current')return true;
  if(path==='rpc/icash_claim_seller_agreement'){claims++;assert.equal(body.p_memory_fingerprint,(await f.context()).fingerprint);return {id:'confirmation',claimed:true,envelopeId:null};}
  if(path==='rpc/icash_finish_seller_agreement')return true;
  throw Error(path);
 };
 const result=await sellerAgreementAction('a'.repeat(64),{action:'confirm_and_send',conversationId,confirmation},{db,bind:async()=>{},history:async()=>live,now:()=>now,send:async()=>{sends++;return {id:'envelope',testMode:false};},text:async()=>{texts++;return {sent:true,status:'accepted',instruction:'Accepted'};},refresh:async()=>assert.fail('No poll')});
 return {result,claims,sends,texts};
}
for(const clocked of [false,true]){
 const f=await fixture(pg),original=await f.outbound(qualifiedSellerTurns.map((row,index)=>({...row,...(clocked?{time_in_call_secs:index}:{})})));
 if(!clocked)original.raw.metadata={};assert.equal(await original.capture(),true);
 const context=await f.context();assert.equal(context.complete,false);assert.equal(context.receiptSourceComplete,false);assert.equal(context.callSourceComplete,true);
 const memory=await readSellerMemory(f.db,f.binding);assert.equal(memory.complete,true,'typed coverage remains whole');assert.equal(memory.state.qualification.ready,clocked,'only real user clocks grant source facts');assert.equal(memory.sourceHold,undefined);
 assert.equal((await boundSellerQualification(f.db,f.binding,live)).ready,true,'later verified live clarification resolves ordinary clock gaps');
 if(clocked){const sent=await direct(f);assert.equal(sent.result.sent,true);assert.equal(sent.claims,1);assert.equal(sent.sends,1);assert.equal(sent.texts,1);}
}
for(const phrase of ['Please stop calling.','I need to speak to a human before proceeding.','The property has fire damage.','I sold the house.','I have another mortgage.'])for(const clocked of [false,true]){
 const f=await fixture(pg),quote='Background detail. '.repeat(650)+phrase+' Please retain my complete statement.';
 const rows=[a('Anything else?'),u(quote),...qualifiedSellerTurns].map((row,index)=>({...row,...(clocked?{time_in_call_secs:index}:{})}));
 const original=await f.outbound(rows,{result:{transcript:qualifiedSellerTurns}});if(!clocked)original.raw.metadata={};assert.equal(await original.capture(),true);
 const raw=await f.context();assert.equal(raw.callSourceComplete,true);assert.equal(raw.conversations.find(c=>c.channel==='voice').transcript[1].message,quote,'full original middle quote survives SQL projection');
 const memory=await readSellerMemory(f.db,f.binding);assert.equal(memory.complete,true);assert(memory.sourceHold,phrase);assert.equal(memory.state.qualification.ready,false);assert.equal((await boundSellerQualification(f.db,f.binding,live)).ready,false);
 assert.equal((await processSellerTextOffer(f.binding,{db:f.db,send:async()=>assert.fail('No document'),text:async()=>assert.fail('No text'),dispatch:async()=>assert.fail('No dispatch')})).status,'seller_memory_source_review_required');
 const held=await direct(f);assert.equal(held.result.sent,false);assert.equal(held.claims,0);assert.equal(held.sends,0);assert.equal(held.texts,0);
}
await pg.close();
console.log('PASS actual raw capture SQL → typed canonical reader → voice qualification/text/direct agreement; full long holds, unknown-clock clarification, and verified ordinary progression. No provider calls.');
