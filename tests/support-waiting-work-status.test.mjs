import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
const snapshot={screened:31,callsStarted:4,textsSent:8,textReplies:1,progress:{status:'paced',health:{status:'ok'}}};
const ask=(q,extra={})=>replyToSupport({kind:'account',messages:[o('Earlier research resumed, but the reported experience remains unresolved.'),u(q)],handedOff:true,allowAI:false,evidence:[{key:'work',status:'ok',code:'not_paused'},{key:'outreach',status:'ok',outreach:snapshot}],...extra},async()=>{throw Error('Paid model forbidden');});
for(const q of ['So it says "Waiting for Eligible Work"','My workspace still shows Waiting for eligible work.','What does “Waiting for eligible work” mean?','Why does my bot say Waiting for eligible work?','Waiting for eligible work']){
 const r=await ask(q);assert.match(r.reply,/status label/i);assert.match(r.reply,/eligible task/i);assert.doesNotMatch(r.reply,/will (?:start|resume)|no (?:eligible )?(?:leads|properties)|just add|fixed/i);assert.equal(r.status,'open');
}
const blocked=await ask('It says Waiting for eligible work',{evidence:[{key:'work',status:'ok',code:'not_paused'},{key:'outreach',status:'ok',outreach:{...snapshot,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}}]});
assert.match(blocked.reply,/recent work as blocked/);assert.match(blocked.reply,/31 properties checked/);assert.equal(blocked.managementReview,true);assert.doesNotMatch(blocked.reply,/no work (?:ever )?completed|latest check.*waiting for eligible work/i);
const paused=await ask('It says Waiting for eligible work',{evidence:[{key:'work',status:'attention',code:'paused'}]});assert.match(paused.reply,/currently paused/i);assert.doesNotMatch(paused.reply,/switched on|select Run/i);
const unknown=await ask('It says Waiting for eligible work',{evidence:[]});assert.match(unknown.reply,/can.t verify/i);assert.doesNotMatch(unknown.reply,/latest.*clear|switched on/i);
const unavailable=await ask('It says Waiting for eligible work',{evidence:[{key:'outreach',status:'ok',outreach:{...snapshot,progress:{status:'paced',health:{status:'unavailable'}}}}]});assert.match(unavailable.reply,/can.t verify/i);
const pending=await ask('It says Waiting for eligible work',{evidence:[{key:'outreach',status:'ok',outreach:{...snapshot,progress:{status:'ready',health:{status:'blocked',reason:'pending_work'}}}}]});assert.match(pending.reply,/earlier work awaiting confirmation/);assert.equal(pending.managementReview,true);
const guest=await ask('It says Waiting for eligible work',{kind:'access'});assert.match(guest.reply,/guest chat/i);assert.doesNotMatch(guest.reply,/31|switched on|your latest/i);
const changed=await ask('It says Waiting for eligible work',{evidence:[{key:'work',status:'ok',code:'not_paused'},{key:'outreach',status:'ok',outreach:{...snapshot,progress:{status:'ready',health:{status:'ok'}}}}]});assert.match(changed.reply,/different from the quoted label/i);assert.doesNotMatch(changed.reply,/working now|fixed/i);
for(const q of ['Cancel my subscription.','Where is my course?','My seller is waiting for work.','I am waiting for eligible work in my job search.','It no longer says Waiting for eligible work.']){
 const r=await ask(q,{messages:[u('It says Waiting for eligible work'),u(q)]});assert.doesNotMatch(r.reply,/That status label means|different from the quoted label/i);
}
console.log('PASS fictional waiting-work status: fresh evidence, operator history, guest, Pause, unknown and topic boundaries');
