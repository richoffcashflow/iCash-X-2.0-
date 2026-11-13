import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
const evidence=[{key:'work',status:'ok',code:'not_paused'},{key:'voice',status:'attention',code:'voice_business_number_mismatch',detail:'The latest saved call had a business-number mismatch. That does not establish the current cause.'},{key:'outreach',status:'ok',outreach:{screened:16,callsStarted:2,textsSent:6,textsDelivered:3,textReplies:1,progress:{status:'ready',health:{status:'ok'}}}}];
let paid=0;
const ask=(q,extra={})=>replyToSupport({kind:'account',messages:[o('A prior calling issue remains open.'),u(q)],evidence,handedOff:true,allowAI:false,...extra},async()=>{paid++;throw Error('Paid calls forbidden');});
for(const q of ['What current issues does my account have?','I found the messages. What problems are affecting my bot right now?','I can view the texts now but what current issues does the software have on my side?']){
 const r=await ask(q);assert.match(r.reply,/business-number mismatch/i);assert.match(r.reply,/3 of 6 texts.*overall/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);assert.doesNotMatch(r.reply,/everything is working|fixed now|will start|which property/i);
 const guest=await ask(q,{kind:'access'});assert.match(guest.reply,/can.t verify/i);assert.doesNotMatch(guest.reply,/3 of 6|business-number mismatch/);
 const unknown=await ask(q,{evidence:[]});assert.match(unknown.reply,/can.t verify/i);assert.doesNotMatch(unknown.reply,/no issues|no problems|3 of 6/);
}
const q='What current issues does my account have?';
const clear=await ask(q,{evidence:[evidence[0],evidence[2]]});assert.match(clear.reply,/do not identify a specific current fault/i);assert.doesNotMatch(clear.reply,/business-number mismatch|everything is working/);
const partial=await ask(q,{evidence:[evidence[2],{key:'voice',status:'unknown'}]});assert.match(partial.reply,/checks are unavailable/i);assert.doesNotMatch(partial.reply,/no issues|everything is working/);
const paused=await ask(q,{evidence:[{key:'work',code:'paused',status:'attention'},evidence[2]]});assert.match(paused.reply,/paused/i);assert.doesNotMatch(paused.reply,/press Run|select Run/);
const blocked=await ask(q,{evidence:[evidence[0],{...evidence[2],outreach:{...evidence[2].outreach,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}}]});assert.match(blocked.reply,/recent|current/i);assert.doesNotMatch(blocked.reply,/no work ever|no completed work/i);
for(const tail of ['Where is my course?','Cancel my subscription.','What current issues does my seller have?','What current issues does my account have with its subscription?','The software issue is fixed now.']){
 const r=await ask(tail,{messages:[u(q),o('A later finding concerns a different topic.'),u(tail)]});assert.doesNotMatch(r.reply,/3 of 6 texts|These checks do not identify a specific current fault/);
}
const newer=await ask(q,{messages:[o('The old business-number issue was repaired; a different call needs review.'),u(q)],evidence:[evidence[0],{key:'voice',status:'attention',detail:'The latest saved call ended before recording began.'},evidence[2]]});assert.match(newer.reply,/ended before recording/);assert.doesNotMatch(newer.reply,/business-number mismatch/);
assert.equal(paid,0);
console.log('PASS fictional current-issue questions, fresh evidence, unknown/guest/Pause/operator/topic boundaries');
