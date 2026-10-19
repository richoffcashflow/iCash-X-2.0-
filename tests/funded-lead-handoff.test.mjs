// Local verified-funding simulation only. No Stripe or outreach provider traffic.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {fundingSessionMatches} from '../lib/funding-policy.ts';
const id='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
let order,calls,warnings,balance,settlementFails,preparationFailure;
function reset(){order={id,account_id:account,mode:'live',state:'pending',credited_at:null,price_cents:10000,credit_cents:10000,stripe_session_id:'cs_live_fixture'};calls=[];warnings=[];balance=0;settlementFails=false;preparationFailure=null;}
const session=()=>({id:order.stripe_session_id,livemode:order.mode==='live',mode:'payment',status:'complete',payment_status:'paid',currency:'usd',amount_total:10000,payment_intent:'pi_fixture',customer_details:{email:'simulation@example.invalid'},metadata:{icash_funding_order:id,icash_prepaid_work:'true'}});
const deps={fundingSessionMatches,fundingMode:()=> 'live',guestHash:()=> 'fixture',Stripe:class{constructor(){throw Error('No Stripe requests allowed');}},console:{warn:value=>warnings.push(value)},activateAutoRecharge:async()=>calls.push('activate_auto_recharge'),db:async(path,method,body,signal)=>{
 calls.push({path,method,body,signal});
 if(path.startsWith('icash_funding_orders?'))return [structuredClone(order)];
 if(path==='rpc/icash_settle_taxed_funding'){
  if(settlementFails)throw Error('Funding settlement unavailable');
  if(!order.credited_at){balance+=order.credit_cents;order.credited_at=new Date().toISOString();order.state='paid';}
  return null;
 }
 if(path==='rpc/icash_apply_prepaid_purchase')return null;
 if(path==='rpc/icash_project_operational_sms_contacts'){
  assert.equal(balance,10000,'credit committed before optional preparation');
  assert.equal(order.state,'paid');assert.equal(body.p_account,account,'tenant remains exact');
  assert(signal instanceof AbortSignal,'database wrapper receives its supported fourth-argument signal');
  if(preparationFailure)throw preparationFailure;
  return 0; // Empty real inventory stays empty; never fabricate a lead or reply.
 }
 throw Error('Unexpected database operation '+path);
}};
globalThis.__fundedHandoff=deps;
const source=readFileSync(new URL('../lib/funding.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const {settleFunding}=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(deps).join(',')+'}=globalThis.__fundedHandoff;\n'+code).toString('base64'));
const handoffs=()=>calls.filter(c=>c.path==='rpc/icash_project_operational_sms_contacts');
reset();await settleFunding(session());assert.equal(balance,10000);assert.equal(handoffs().length,1);assert.equal(calls.at(-1),'activate_auto_recharge');
assert(calls.findIndex(c=>c.path==='rpc/icash_apply_prepaid_purchase')<calls.findIndex(c=>c.path==='rpc/icash_project_operational_sms_contacts'),'normal prepaid setup completes first');
await settleFunding(session());assert.equal(balance,10000);assert.equal(handoffs().length,1,'duplicate credited webhook does not rescan');
for(const error of [new Error('Projection temporarily unavailable'),new DOMException('Fixture timeout','TimeoutError')]){
 reset();preparationFailure=error;await settleFunding(session());
 assert.equal(balance,10000,'optional handoff cannot undo verified funding');assert(order.credited_at);assert.equal(warnings.length,1);assert.equal(calls.at(-1),'activate_auto_recharge');
}
reset();settlementFails=true;await assert.rejects(settleFunding(session()),/Funding settlement unavailable/);assert.equal(balance,0);assert.equal(handoffs().length,0);
for(const change of [{payment_status:'unpaid'},{amount_total:1},{livemode:false},{status:'open'},{metadata:{icash_funding_order:'33333333-3333-4333-8333-333333333333'}}]){
 reset();await assert.rejects(settleFunding({...session(),...change}));assert.equal(balance,0);assert.equal(handoffs().length,0,'unverified payment never prepares work');
}
reset();order.mode='test';order.stripe_session_id='cs_test_fixture';await settleFunding(session());assert.equal(handoffs().length,0,'test funding never prepares production candidates');
reset();order.account_id=null;await settleFunding(session());assert.equal(handoffs().length,0,'unclaimed guest funding cannot select an account');
assert.match(source,/AbortSignal\.timeout\(2000\)/,'optional handoff has a two-second bound');
assert.doesNotMatch(source,/icash_assign_seller|icash_next_acquisition|dispatchLiveVoice|dispatchTextMessage/,'funding never invokes global paid allocation or providers');
console.log('Verified funding handoff: committed credits survive failure/timeout; exact account, bounded nonpaid projection, duplicate skip, empty inventory and unpaid/test/guest exclusion passed.');
