import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content}),o=content=>({role:'operator',content});
const evidence=[{key:'work',code:'not_paused',status:'ok',detail:'On',source:'fixture',observedAt:'2026-11-11T18:00:00Z'},{key:'outreach',code:'fixture',status:'attention',source:'fixture',observedAt:'2026-11-11T18:00:00Z',detail:'Saved checks',outreach:{screened:0,callsStarted:0,textsSent:0,textReplies:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}}];
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
const history=[u('My bot is not working.'),a('Your case is still in management review.')];
let calls=0;const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,handedOff:true,evidence,...extra},async()=>{calls++;throw Error('Paid model forbidden');});
for(const q of ['Can u confirm?','Can you confirm that?','Please check again.','Is it fixed yet?','Why has this not been fixed?']){
 const r=await ask([...history,u(q)]);assert.match(r.reply,/no completed work/i,q);assert.equal(r.managementReview,true);assert.equal(r.status,'open');
 assert.doesNotMatch(r.reply,/will start|will restart|working normally|you need to buy more|which page|what are you trying/i);
 assert.ok(r.reply.length<650);
 const repeat=await ask([...history,u(q),a(r.reply),u('Can you confirm?')]);assert.match(repeat.reply,/no completed work/i);
}
const delayed=[u('My workspace has been running all day without progress.'),a('Your case is still in management review.'),u('I need to speak to a live support agent.'),a('This is automated support. Your case is still in management review.'),u('Why?'),a('Your case is still in management review.')];
for(const q of ['Why has my bot not looked up new properties today?','My bot has not researched any properties today.','The bot did not find any leads today.']){
 const r=await ask([u(q)],{handedOff:false});assert.match(r.reply,/no completed work/i);assert.match(r.reply,/overall/);assert.match(r.reply,/do not prove.*recent/i);assert.equal(r.managementReview,true);assert.equal(r.status,'open');
 const follow=await ask([u(q),a(r.reply),u('Can you confirm?')]);assert.match(follow.reply,/latest activity check/i);
}
for(const q of ['Has my bot looked up properties today?','My bot has researched properties today.','The seller has not looked up properties today.','How long until my bot finds a deal?']){
 const r=await ask([u(q)],{allowAI:false,handedOff:false});assert.doesNotMatch(r.reply,/lack of progress is frustrating/i);
}
assert.match((await ask([...delayed,u('Why hasn’t this been rectified?')])).reply,/no completed work/i);
const paused=await ask([...history,u('Is it fixed yet?')],{evidence:[{...evidence[0],code:'paused',status:'attention'},evidence[1]]});assert.match(paused.reply,/currently paused/i);assert.match(paused.reply,/before/i);assert.doesNotMatch(paused.reply,/resume|unpaused/i);
const pending=await ask([...history,u('Can you confirm?')],{evidence:[evidence[0],{...evidence[1],outreach:{...evidence[1].outreach,progress:{status:'settling',health:{status:'blocked',reason:'pending_work'}}}}]});assert.match(pending.reply,/earlier work.*confirmation/i);assert.doesNotMatch(pending.reply,/charged|no completed work/i);
const unknown=await ask([...history,u('Can you confirm?')],{evidence:[]});assert.match(unknown.reply,/can.t verify/i);assert.doesNotMatch(unknown.reply,/no completed work|working normally/);
const positive=await ask([...history,u('Is it fixed yet?')],{evidence:[evidence[0],{...evidence[1],outreach:{...evidence[1].outreach,callsStarted:4,textsSent:7,progress:{status:'ready',health:{status:'ok'}}}}]});assert.match(positive.reply,/4 call attempts and 7 texts.*overall/i);assert.match(positive.reply,/do not confirm/i);assert.equal(positive.status,'open');
for(const tail of [
 [u('Where is the course?'),a('Open Course.'),u('Can u confirm?')],
 [o('The purchase correction still needs review.'),u('Can u confirm?')],
 [u('It is working now.'),a('Glad that worked.'),u('Can u confirm?')],
 [u('Can you confirm my subscription was cancelled?')],
 [u('Why has the seller not signed?')],
 [u('Cancel my subscription.')],
 [u('What is my credit balance?')]
])assert.doesNotMatch((await ask([...history,...tail],{allowAI:false})).reply,/latest activity check|still flags no completed work/i);
for(const messages of [[u('Can u confirm?')],[u('Does the bot work in Oregon?'),a('Markets vary.'),u('Can u confirm?')]])assert.doesNotMatch((await ask(messages,{allowAI:false})).reply,/latest activity check|still flags no completed work/i);
assert.doesNotMatch((await ask([...history,u('Can u confirm?')],{kind:'access'})).reply,/latest activity check|still flags no completed work/i);
const operatorReview=[u('My bot has done no work.'),o('No completed research, calls or texts are recorded. This needs investigation; the case remains open with no confirmed restart time.')];
for(const q of ['Will the issue be fixed so my bot can start working?','So the problem is going to be fixed so I can start getting leads and the bot can start working','When will this be repaired?']){
 const r=await ask([...operatorReview,u(q)]);assert.match(r.reply,/no completed work/i,q);assert.equal(r.managementReview,true);assert.equal(r.status,'open');
 assert.doesNotMatch(r.reply,/add listings|upload properties|will start|will be fixed|guarantee/i);
 const repeated=await ask([...operatorReview,u(q),a(r.reply),u('When will this be repaired?')]);assert.match(repeated.reply,/no completed work/i);
}
for(const messages of [
 [u('Will the issue be fixed so my bot can start working?')],
 [o('Your payment receipt is under review.'),u('When will this be repaired?')],
 [o('No completed research was recorded before the repair. The issue is now resolved.'),u('When will this be repaired?')],
 [...operatorReview,u('It worked'),u('When will this be repaired?')],
 [...operatorReview,u('Where is the course?'),u('When will this be repaired?')],
 [...operatorReview,u('When will the seller contract be fixed?')],
])assert.doesNotMatch((await ask(messages,{allowAI:false})).reply,/latest activity check|still flags no completed work/i);
assert.doesNotMatch((await ask([...operatorReview,u('When will this be repaired?')],{kind:'access',allowAI:false})).reply,/latest activity check|still flags no completed work/i);
assert.doesNotMatch((await ask([a(operatorReview[1].content),u('When will this be repaired?')],{allowAI:false})).reply,/latest activity check|still flags no completed work/i);
assert.equal(calls,0);
console.log('PASS fictional activity confirmation, repeat, current evidence, guest/operator/topic boundaries; no provider calls');
