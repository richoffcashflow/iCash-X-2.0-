import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const history=[u('I paid but no sign-in code arrived'),a('Please check the inbox.'),u('Still no code'),a('Your access is unresolved.'),u('Can I have a refund?'),a('The access issue remains open.')];
const noModel=async()=>{throw Error('Paid models forbidden');};
for(const kind of ['access','account']){
 for(const q of ['Do you just keep my $75 then?','How do I get a code to sign in after paying?']){
  const r=await replyToSupport({kind,allowAI:false,messages:[...history,u(q)]},noModel);
  assert.match(r.reply,/code|access/);assert.doesNotMatch(r.reply,/enter the newest code|prepaid work credits/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
 }
 for(const q of ['How do work credits work?','How do I change my voice?','Cancel my subscription','I received the code and signed in']){
  const r=await replyToSupport({kind,allowAI:false,messages:[...history,u(q)]},noModel);
  assert.doesNotMatch(r.reply,/Code delivery remains unconfirmed/);
 }
 const r=await replyToSupport({kind,allowAI:false,messages:[...history,{role:'operator',content:'Ownership review needs the original receipt.'},u('How do I get a code to sign in after paying?')]},noModel);
 assert.doesNotMatch(r.reply,/Code delivery remains unconfirmed/);
}
const detailed=[u('No email code is arriving'),a('Does your receipt email match?'),u('I paid but neither email nor code arrived'),a('Request one fresh code.'),u('Still no code'),a('What does the button say?'),u('Sign in'),a('The code requests have not restored access. What are the payment date and amount on your receipt?'),u('$[number removed]/22. 009'),a('What are you trying to do?'),u('Nothing happens, it will not send a code'),a('Flagged for review.'),u('Can I have a refund?'),a('The access issue remains unresolved.'),u('Do you just keep my $75 then?'),a('Credits pay for work.')];
const detailedReply=await replyToSupport({kind:'access',allowAI:false,messages:[...detailed,u('How can I get a code to sign in? I already paid')]},noModel);
assert.match(detailedReply.reply,/Code delivery remains unconfirmed/);
for(const reset of ['How do seller contracts work?','I received the code','I signed in','I have not paid']){
 const r=await replyToSupport({kind:'access',allowAI:false,messages:[...history,u(reset),a('Details saved.'),u('How can I get a code to sign in?')]},noModel);
 assert.doesNotMatch(r.reply,/Code delivery remains unconfirmed/);
}
const redacted=await replyToSupport({kind:'access',allowAI:false,messages:detailed.slice(0,9)},noModel);
assert.match(redacted.reply,/automatically hidden/);assert.equal(redacted.status,'open');
console.log('paid code context passed');
