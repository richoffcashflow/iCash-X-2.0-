// Fictional replays only. No customer records or paid model/provider calls.
import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}), agent=content=>({role:'assistant',content});
const history=[user('My bot has not done anything.'),agent('Your case is still in management review. I have not confirmed a fix.')];
const answer=(q,messages=history,extra={})=>replyToSupport({kind:'account',messages:[...messages,user(q)],handedOff:true,allowAI:false,...extra});
for(const kind of ['account','access']){
 for(const q of ['Should I pause my bot?','Can I pause the bot?','How do I pause my bot?']){
  const r=await answer(q,history,{kind});
  assert.match(r.reply,/Pause bot/,q);
  assert.match(r.reply,/new (?:automatic )?work/,q);
  assert.match(r.reply,/already.started work|work already started/i,q);
  assert.doesNotMatch(r.reply,/I(?:’|')ve paused|fixed|will restart|buy more/i,q);
  assert.equal(r.status,'open');
 }
 const first=await answer('Should I pause my bot?',history,{kind});
 const follow=await answer('Pause then?',[...history,user('Should I pause my bot?'),agent(first.reply)],{kind});
 assert.match(follow.reply,/Pause bot/);assert.equal(follow.status,'open');
 const vip=await answer('Should I upgrade to VIP?',history,{kind});
 assert.match(vip.reply,/Standard/);assert.match(vip.reply,/not.*(?:repair|fix)|isn’t.*(?:repair|fix)/i);
 assert.doesNotMatch(vip.reply,/upgrade (?:now|to fix)|guarantee(?:s|d) (?:leads|deals)/i);
 assert.equal(vip.status,'open');
 const explanation=await answer('What unresolved issue?',history,{kind});
 assert.match(explanation.reply,/work is delayed or missing/);assert.equal(explanation.managementReview,true);
}
// A brief continuation must be bound to the immediately preceding bot question.
for(const messages of [[],[user('Should I pause the training video?'),agent('Use the video player.')],[...history,user('Should I pause my bot?'),{role:'operator',content:'We are checking your payment.'}],[...history,user('Should I pause my bot?'),agent('Use Pause bot.'),user('Where is the course?'),agent('Open Course.')]]){
 const r=await answer('Pause then?',messages);assert.doesNotMatch(r.reply,/choose Pause bot/i);
}
const operatorBreak=await answer('Pause then?',[...history,user('Should I pause my bot?'),{role:'operator',content:'The current review is about the missing payment.'},agent('We are checking that issue.')]);
assert.doesNotMatch(operatorBreak.reply,/choose Pause bot/i);
for(const q of ['Do not pause my bot.','I paused my bot but it is still calling.','Should I pause the training video?','How do I cancel my subscription?','I paid for VIP but it is not active.']){
 const r=await answer(q);assert.doesNotMatch(r.reply,/If you want to stop new automatic work, choose Pause bot/);
 if(q.includes('cancel'))assert.match(r.reply,/Cancel subscription/);
 if(q.includes('paid'))assert.match(r.reply,/purchase|receipt|VIP access/i);
}
const changed=await answer('How do I change my bot voice?',[...history,user('Should I pause my bot?'),agent('Choose Pause bot.')]);
assert.match(changed.reply,/Custom voice/);assert.doesNotMatch(changed.reply,/choose Pause bot/);
const active=await answer('Should I upgrade to VIP?',history,{evidence:[{key:'vip',source:'icash_vip_features_active',status:'ok',code:'vip_active',detail:'VIP active',observedAt:new Date().toISOString()}]});
assert.match(active.reply,/already.*VIP|VIP.*already/i);assert.match(active.reply,/do not need to buy|don’t need to buy/i);
const changedIssue=await answer('What unresolved issue?',[...history,user('My sign-in access is blocked.'),agent('Your case is still in management review.')]);
assert.match(changedIssue.reply,/sign-in access/);assert.doesNotMatch(changedIssue.reply,/work is delayed/);
for(const boundary of [{role:'operator',content:'The earlier work is complete. The payment check remains open.'},user('That worked.')]){
 const r=await answer('What unresolved issue?',[...history,boundary,agent('Your case is still in management review.')]);
 assert.doesNotMatch(r.reply,/work is delayed or missing/);assert.equal(r.status,'open');
}
console.log('Passed review follow-up product guidance and topic boundaries.');

// Fictional setup questions after an unresolved handoff answer the current control question.
const oldRunEnv={...process.env};
Object.assign(process.env,{ICASH_SUPPORT_AI_ENABLED:"true",OPENAI_API_KEY:"fictional",ICASH_SUPPORT_AI_MODEL:"fictional"});
let runModelCalls=0;
try{
for(const kind of ['account','access'])for(const handedOff of [false,true])for(const q of ['How do I get my bot to run?','How can I get the bot to start?','How do I turn on my bot?']){
 const r=await replyToSupport({kind,handedOff,allowAI:true,messages:[...history,{role:'operator',content:'The subscription and separate work credits were explained; recovery is unconfirmed.'},user(q)]},async()=>{runModelCalls++;throw new Error('Model calls forbidden for control guidance');});
 assert.match(r.reply,/Add money to start/);assert.match(r.reply,/Run bot/);assert.match(r.reply,/not.*(?:proof|guarantee)/i);assert.equal(r.status,'open');
 assert.doesNotMatch(r.reply,/will start|have started|fixed|resolved/i);
}
assert.equal(runModelCalls,0);
}finally{for(const k of Object.keys(process.env))if(!(k in oldRunEnv))delete process.env[k];Object.assign(process.env,oldRunEnv);}
const {supportRunControlsReply}=await import('../lib/support-run-controls.ts');
for(const q of ['My bot will not run.','How do I get my bot to run? I paid twice.','How do I get my bot to run a report?','Do not turn on my bot.','Where is the course?','It worked.','How do I turn on my bot voice?','How do I cancel?'])assert.equal(supportRunControlsReply({kind:'account',messages:[...history,user('How do I get my bot to run?'),{role:'operator',content:'Keep the payment review open.'},user(q)]}),null,q);
