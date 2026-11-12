import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportLeadImportQuestion} from '../lib/support-lead-policy.ts';
const user=content=>({role:'user',content});
const ask=(kind,messages)=>replyToSupport({kind,messages,allowAI:false},async()=>{throw Error('Paid model calls forbidden');});
for(const kind of ['account','access']){
 for(const q of ['Why does adding funds not guarantee leads?','Does adding more funds guarantee a seller response?','Does funding my bot guarantee a deal?']){
  const r=await ask(kind,[user(q)]);
  assert.match(r.reply,/Work credits pay for the work performed/);
  assert.match(r.reply,/does not guarantee a deal/);
  assert.doesNotMatch(r.reply,/import|upload|pay again|will start/);
 }
 const history=[user('Why does adding funds not guarantee leads?'),{role:'assistant',content:'Work credits pay for eligible research.'}];
 const unresolved=await ask(kind,[user('My calls have stopped.'),{role:'operator',content:'The calling issue remains unresolved.'},user('Does adding funds guarantee leads?')]);
 assert.match(unresolved.reply,/does not guarantee a deal/);assert.notEqual(unresolved.status,'resolved');
 const changed=await ask(kind,[...history,user('Can I import my own seller list?')]);
 assert.match(changed.reply,/cannot add, upload or import/);
 assert.doesNotMatch(changed.reply,/Work credits pay for the work performed/);
 const fault=await ask(kind,[...history,{role:'operator',content:'The payment issue remains unresolved.'},user('I added funds but the payment failed and my credits are missing.')]);
 assert.notEqual(fault.status,'resolved');
 assert.doesNotMatch(fault.reply,/cannot add, upload or import|Work credits pay for the work performed/);
 for(const q of ['Does adding funds guarantee leads? Cancel my subscription.','Does adding funds guarantee leads? My calls are not working.','Does the seller purchase price guarantee a deal?','Does my monthly subscription guarantee a deal?']){
  const r=await ask(kind,[user(q)]);
  assert.doesNotMatch(r.reply,/Work credits pay for the work performed/);
 }
}
assert.equal(supportLeadImportQuestion('Why does adding funds not guarantee leads?'),false);
assert.equal(supportLeadImportQuestion('Can I upload my own property list?'),true);
console.log('PASS fictional funding expectations, faults, payment, import and topic boundaries; no provider calls');
