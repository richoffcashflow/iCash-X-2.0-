import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content});
const evidence=[{key:'work',status:'ok',code:'not_paused'},{key:'outreach',status:'ok',outreach:{callsStarted:4,textsSent:8,textReplies:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}}];
const ask=(q,extra={})=>replyToSupport({kind:'account',messages:[u(q)],evidence,handedOff:true,allowAI:false,...extra},async()=>{throw Error('Paid forbidden')});
for(const q of ['I expected my credits to be getting used by now.','I would think my credits would still be getting used up by now.']){
 const r=await ask(q);assert.match(r.reply,/current.*(?:work|activity)|completed work/i);assert.doesNotMatch(r.reply,/Added money becomes/);assert.equal(r.managementReview,true);assert.equal(r.status,'open');
 const g=await ask(q,{kind:'access'});assert.match(g.reply,/can.t verify/i);assert.doesNotMatch(g.reply,/4 call|8 text/);
 const unknown=await ask(q,{evidence:[]});assert.match(unknown.reply,/can.t verify/i);
 const paused=await ask(q,{evidence:[{key:'work',code:'paused',status:'attention'}]});assert.match(paused.reply,/paused/i);
}
for(const q of ['How do I add credits?','I expected a refund of my credits by now.','My credits are being used now.','Cancel my subscription.','The seller expected my credits to be used.']) assert.doesNotMatch((await ask(q)).reply,/Spending is evidence/);
console.log('PASS fictional idle-credit expectations and account/guest/Pause/topic boundaries');

const clear=await ask('I expected my credits to be used by now.',{evidence:[{key:'outreach',status:'ok',outreach:{callsStarted:4,textsSent:8,textReplies:0,progress:{status:'ready',health:{status:'ok'}}}}]});assert.doesNotMatch(clear.reply,/flags.*blocked|no completed work/);
for(const q of ['Where is the course?','How do I add credits?','Cancel my subscription.']){
 const r=await ask(q,{messages:[u('I expected my credits to be used by now.'),{role:'operator',content:'Earlier research remains delayed; no restart is confirmed.'},u(q)]});assert.doesNotMatch(r.reply,/Spending is evidence/);
}
const operator=await ask('I expected my credits to be used by now.',{messages:[{role:'operator',content:'Research was delayed; no restart confirmed.'},u('I expected my credits to be used by now.')]});assert.equal(operator.status,'open');assert.equal(operator.managementReview,true);
