import assert from 'node:assert/strict';
import {planSellerTextOffer} from '../lib/seller-text-offer.ts';
import {processSellerTextOffer} from '../lib/seller-text-offer-service.ts';

globalThis.fetch=async()=>{throw Error('Offline seller reply replay only');};
const now=Date.parse('2026-11-14T18:00:00Z');
let id=0;
const incoming=body=>({id:String(++id),direction:'incoming',state:'received',body,providerId:null});
const outgoing=(body,action,extra={})=>({id:String(++id),direction:'outgoing',state:'delivered',providerId:'fixture-receipt',body,action,...extra});
const base={accountId:'fixture-account',jobId:'fixture-job',threadId:'fixture-thread',dealId:'fixture-deal',screeningId:'fixture-screen',phone:'+12125550123',ownerUserId:'fixture-owner',ownerEmail:'fixture@example.invalid',principal:'Fixture Homes',address:'123 Example Road',snapshot:{},terms:{},offerState:{textThreadId:'fixture-thread',quotedPriceCents:9000000},offerVersion:4,fingerprint:'source-fingerprint',conversionEnabled:true};
const context=messages=>({...base,messages,sourceId:messages.at(-1).id});
const scenarios=[
 {ask:'Your offer is too low',action:'explain_cash_price',old:'The cash proposal reflects current value, repairs and holding costs. What property detail do you think the estimate is missing?',expected:'Our cash proposal factors in property value, repairs and holding costs. What recent work or other detail should we take into account?'},
 {ask:'Who pays closing costs?',action:'explain_costs',old:'The purchase terms cover buyer-paid transaction closing costs. Seller debts and required charges are handled at closing; net proceeds need title confirmation.',expected:'The buyer pays transaction closing costs. Mortgages, liens and required seller charges can reduce your payout; the title company must confirm the final amount.'},
 {ask:'How does this work?',action:'explain_process',old:'We confirm property details and a cash price, agree on written terms, then coordinate signatures and title. What part would you like to discuss?',expected:'We check the property details, agree on a cash price and written terms, then sign. The title company checks ownership and handles closing.'},
];
for(const s of scenarios){
 const c=context([incoming(s.ask)]),before=structuredClone(c);
 const p=planSellerTextOffer(c,now);
 assert.equal(p.kind,'message');assert.equal(p.action,s.action);assert.equal(p.body,s.expected);
 assert(p.body.length<=160,'Preserve the single-segment reviewed copy budget');
 assert((p.body.match(/\?/g)??[]).length<=1,'One useful question at most');
 assert.equal(p.state.acceptedPriceCents??null,null,'An informational answer never accepts an offer');
 assert.deepEqual(c,before,'Never rewrite source messages or their receipts');
 // A copy refresh cannot restart the existing two-delivered-reply limit.
 for(const bodies of [[s.old,s.old],[s.old,s.expected],[s.expected,s.expected]]){
  const history=bodies.flatMap(body=>[outgoing(body,s.action),incoming(s.ask)]);
  const stopped=planSellerTextOffer(context(history),now);
  assert.equal(stopped.kind,'review','Do not send a third equivalent answer');
  assert.equal(stopped.reason,'seller_answer_unclear');
 }
 // Preserve one useful answer, and do not conflate custom replies or other actions.
 for(const prior of [[outgoing(s.old,s.action)],[outgoing('Different useful answer',s.action),outgoing(s.old,s.action)],[outgoing(s.old,'other'),outgoing(s.old,s.action)]]){
  assert.equal(planSellerTextOffer(context([...prior,incoming(s.ask)]),now).kind,'message');
 }
 const pending=context([outgoing(s.old,s.action,{state:'accepted',updatedAt:new Date(now-1000).toISOString()}),incoming(s.ask)]);
 assert.equal(planSellerTextOffer(pending,now).kind,'wait','Unknown delivery never creates a resend');
 for(const refusal of ['STOP','Not interested','Please do not contact me'])assert.equal(planSellerTextOffer(context([incoming(refusal+'. '+s.ask)]),now).kind,'review','Refusal wins over a friendly answer');
 // Exercise the real application service through its existing save + dispatch boundary.
 for(const sourceCurrent of [true,false]){
  let saved,dispatches=0;
  const result=await processSellerTextOffer(c,{
   now:()=>now,
   db:async(path,method,body)=>{
    if(path==='rpc/icash_seller_memory_context')return null;
 if(path==='rpc/icash_seller_prior_call_context')return [];
    assert.equal(path,'rpc/icash_save_seller_text_offer');saved=body;
    return sourceCurrent?{messageId:'fixture-message'}:null;
   },
   dispatch:async(account,message)=>{assert.equal(account,c.accountId);assert.equal(message,'fixture-message');dispatches++;return {status:'fixture-dispatch'};},
   send:async()=>{throw Error('No agreement is authorized');},text:async()=>{throw Error('No agreement delivery is authorized');}
  });
  assert.equal(saved.p_plan.body,s.expected);assert.equal(saved.p_plan.action,s.action);
  assert.equal(saved.p_account,c.accountId);assert.equal(saved.p_job,c.jobId);assert.equal(saved.p_fingerprint,c.fingerprint);assert.equal(saved.p_version,c.offerVersion);
  assert.equal(dispatches,sourceCurrent?1:0);assert.equal(result.status,sourceCurrent?'fixture-dispatch':'text_ai_context_changed');
 }
}
const process=planSellerTextOffer(context([incoming('What happens next?')]),now);
assert.equal(process.body,scenarios[2].expected);
assert(!process.body.includes('?'),'A complete process answer need not end with a generic question');
const fees=planSellerTextOffer(context([incoming('Are there any fees?')]),now);
assert.equal(fees.body,scenarios[1].expected);
assert(!/guarantee|no fees|no costs|you will receive|sent|booked/i.test(fees.body));
console.log('PASS helpful seller texts: three real reply paths, source-bound service dispatch, unchanged offer authority, legacy repeat budget, opt-outs and uncertain receipts. No live sends.');
