import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content}),o=content=>({role:'operator',content});
const evidence=[{key:'work',code:'not_paused',status:'ok',detail:'On',source:'fixture',observedAt:'2026-11-12T10:00:00Z'},{key:'outreach',status:'ok',source:'fixture',observedAt:'2026-11-12T10:00:00Z',detail:'Saved results',outreach:{screened:6,callsStarted:0,textsSent:0,textReplies:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}}];
let paid=0;
const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,handedOff:true,allowAI:false,...extra},async()=>{paid++;throw Error('Paid model forbidden');});
const history=[u('My bot is not working.'),a('Your case remains in management review.')];
for(const messages of [[u('Are automated seller calls available?')],[u('My bot has not researched any properties today.')],[...history,u('Can you confirm?')]]){
 const r=await ask(messages);
 assert.doesNotMatch(r.reply,/no completed work|confirms the missing progress/i);
 assert.match(r.reply,/6 properties checked.*overall/i);
 assert.match(r.reply,/recent|current/i);
 assert.match(r.reply,/not.*(?:cause|restart)|haven.t verified.*(?:cause|restart)/i);
 assert.equal(r.status,'open');
}
// Recorded outreach also defeats a lifetime-zero claim. It does not prove a repair.
const contacted=[evidence[0],{...evidence[1],outreach:{...evidence[1].outreach,screened:0,callsStarted:2,textsSent:5}}];
const calls=await ask([...history,u('Is it fixed yet?')],{evidence:contacted});
assert.match(calls.reply,/2 call attempts and 5 texts.*overall/i);assert.doesNotMatch(calls.reply,/no completed work|is fixed|working normally/i);
const zero=await ask([...history,u('Can you confirm?')],{evidence:[evidence[0],{...evidence[1],outreach:{...evidence[1].outreach,screened:0}}]});
assert.match(zero.reply,/no completed work/i);assert.doesNotMatch(zero.reply,/confirms the missing progress/i);
const unknown=await ask([...history,u('Can you confirm?')],{evidence:[evidence[0],{...evidence[1],status:'unknown'}]});
assert.doesNotMatch(unknown.reply,/6 properties|no completed work/i);assert.match(unknown.reply,/can.t verify/i);
const unknownDirect=await ask([u('Are automated seller calls available?')],{evidence:[evidence[0],{...evidence[1],status:'unknown'}]});
assert.doesNotMatch(unknownDirect.reply,/6 properties|no completed work/i);
for(const [state,reason,expected] of [['paused','no_completed_work',/paused/i],['settling','pending_work',/awaiting confirmation/i]]){
 const r=await ask([...history,u('Can you confirm?')],{evidence:[evidence[0],{...evidence[1],outreach:{...evidence[1].outreach,progress:{status:state,health:{status:'blocked',reason}}}}]});
 assert.match(r.reply,expected);assert.doesNotMatch(r.reply,/no completed work|6 properties/i);
}
for(const tail of [[u('Where is the course?'),a('Open Course.'),u('Can you confirm?')],[o('Your payment correction still needs review.'),u('Can you confirm?')],[u('It is working now.'),u('Can you confirm?')],[u('Cancel my subscription.')]]){
 assert.doesNotMatch((await ask([...history,...tail])).reply,/6 properties checked|saved progress check/i);
}
assert.doesNotMatch((await ask([...history,u('Can you confirm?')],{kind:'access'})).reply,/6 properties checked|saved progress check/i);
assert.equal(paid,0);
console.log('PASS fictional progress evidence, stale health, unknown data and topic boundaries; no paid calls');
