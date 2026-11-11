import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportAccountDetailsReply} from '../lib/support-account-details.ts';
const user=content=>({role:'user',content});
const noModel=async()=>{throw Error('Paid model calls forbidden');};
for(const kind of ['access','account']){
 const messages=[user('I need the V.I.P. link and I want to change my phone number.')];
 const result=await replyToSupport({kind,messages,evidence:[]},noModel);
 assert.match(result.reply,/Settings.*Phone.*Save details/);
 assert.match(result.reply,/https:\/\/www\.geticashx\.com\/\?upgrade=vip/);
 assert.equal(result.status,'open');
 assert.doesNotMatch(result.reply,/phone (?:has been|is now) changed|VIP (?:has been|is now) activated/i);
}
for(const kind of ['access','account']){
 for(const q of ['How do I change my own phone number?','Please update my number.','Where is the VIP link?','I need the V.I.P link.']){
  const r=await replyToSupport({kind,messages:[user(q)],evidence:[]},noModel);
  assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/not enough|trying to do|text code/i);
 }
 const prior=[user('I need to change my phone number.'),{role:'assistant',content:'Use Account details.'}];
 for(const q of ['Where are my VIP leads?', 'Where do I find VIP calls?', 'Where is the course?','Cancel my subscription','I was charged twice','Change the seller phone number','What number does my bot call from?','I do not want to change my number','I already changed my number','It worked','I cannot sign in','I cannot change my phone number','My VIP payment failed','I paid for VIP and the link is missing','Change my number and refund me']){
  assert.equal(supportAccountDetailsReply({kind,messages:[...prior,user(q)],evidence:[]}),null,q);
 }
 const operator=[...prior,{role:'operator',content:'The identity save is unconfirmed; review is ongoing.'},user('What next?')];
 assert.equal(supportAccountDetailsReply({kind,messages:operator,evidence:[]}),null);
 const active={key:'vip',source:'icash_vip_features_active',status:'ok',code:'vip_active',detail:'VIP active',observedAt:'2026-01-01T00:00:00Z'};
 const r=await replyToSupport({kind,messages:[user('Where is the VIP link?')],evidence:[active]},noModel);
 if(kind==='account'){assert.match(r.reply,/VIP is active/);assert.doesNotMatch(r.reply,/upgrade=vip/);}
 else{assert.doesNotMatch(r.reply,/check shows VIP is active/);assert.match(r.reply,/upgrade=vip/);}
 const mixed=await replyToSupport({kind,messages:[user('I paid and need to change my phone number and need the V.I.P. link.')],evidence:[]},noModel);
 assert.match(mixed.reply,/Settings/);assert.match(mixed.reply,/do not pay again/);assert.equal(mixed.status,'open');
}
console.log('PASS account details: direct phone/VIP requests, account/guest evidence, billing, failure, negative, topic and operator boundaries.');
