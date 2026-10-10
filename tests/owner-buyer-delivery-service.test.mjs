import assert from 'node:assert/strict';
import {processOwnerBuyerDelivery} from '../lib/owner-buyer-delivery-service.ts';
globalThis.fetch=async()=>{throw Error('NETWORK DISABLED');};
const env={VERCEL_ENV:'production',ICASH_SMS_WORK_READY:'true'};
function fixture(outcome='accepted',valid=true){
 let state=null,dispatches=0,reads=0;
 const d={db:async(path,method,body)=>{
  reads++;
  if(path.startsWith('icash_owner_buyer_tests?')){assert(path.includes('send_email=eq.false'));assert(path.includes('expires_at=gt.'));return [{id:'request',account_id:'account',thread_id:'thread'}];}
  if(path.startsWith('icash_text_messages?'))return state?[{id:'message',state}]:[];
  if(path==='rpc/icash_owner_buyer_test_content')return valid?{sms:'Canonical package'}:null;
  if(path==='rpc/icash_queue_buyer_package_text'){assert.equal(body.p_body,'Canonical package');state??='ready';return 'message';}
  throw Error(path);
 },dispatch:async(account,id)=>{assert.equal(account,'account');assert.equal(id,'message');if(state!=='ready')return {status:'message_held'};state='dispatching';dispatches++;state=outcome;return {status:outcome==='accepted'?'message_accepted':'message_delivery_needs_review'};}};
 return {d,stats:()=>({state,dispatches,reads})};
}
const off=fixture();await processOwnerBuyerDelivery(off.d,{...env,VERCEL_ENV:'preview'});await processOwnerBuyerDelivery(off.d,{VERCEL_ENV:'production'});assert.equal(off.stats().reads,0);
const invalid=fixture('accepted',false);await processOwnerBuyerDelivery(invalid.d,env);assert.equal(invalid.stats().dispatches,0);
const sent=fixture();await Promise.all([processOwnerBuyerDelivery(sent.d,env),processOwnerBuyerDelivery(sent.d,env)]);await processOwnerBuyerDelivery(sent.d,env);assert.equal(sent.stats().dispatches,1);
const unknown=fixture('needs_review');await processOwnerBuyerDelivery(unknown.d,env);await processOwnerBuyerDelivery(unknown.d,env);assert.equal(unknown.stats().dispatches,1);
console.log('PASS owner delivery: approved current SMS only, one message, concurrent dispatch claim, no uncertain retries, preview/off disabled. Zero provider calls.');
