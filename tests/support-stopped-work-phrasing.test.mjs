import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportMissingActivityConcern,supportAccountReviewReply} from '../lib/support-account-review.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let modelCalls=0;
const work={key:'work',code:'not_paused',status:'ok',detail:'Switched on.',source:'fixture',observedAt:'2026-11-01T12:00:00Z'};
const saved={key:'outreach',status:'ok',source:'fixture',observedAt:'2026-11-01T12:00:00Z',outreach:{screened:18,contactProperties:12,callsStarted:7,textsSent:9,textsDelivered:4,textReplies:0,callsBudgetHeld:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'},remainingCents:1800,spentCents:200}}};
const ask=(messages,evidence=[work,saved],kind='account')=>replyToSupport({kind,messages,evidence},async()=>{modelCalls++;throw Error('No paid model');});
for(const q of ['Why did my bot stop when I did not pause it?','The bot is on but it is not running.','My bot stopped by itself.','Why is my bot taking so long to find a deal?','My bot is only showing leads from last week.']){
 assert.equal(supportMissingActivityConcern(q),true,q);
 const r=await ask([user(q)]);assert.match(r.reply,/switched on/);assert.match(r.reply,/recorded overall/);assert.match(r.reply,/blocked/);assert.equal(r.managementReview,true);assert.equal(r.status,'open');
 assert.doesNotMatch(r.reply,/no eligible deals|just means|keep watching|no way to speed|working normally/);
 const unknown=await ask([user(q)],[]);assert.match(unknown.reply,/can.t (?:confirm|verify)/);
 const pause=await ask([user(q)],[{...work,code:'paused',status:'attention'},saved]);assert.match(pause.reply,/bot is paused/);assert.doesNotMatch(pause.reply,/Select Run|press Run/);
 const course=await ask([user(q),assistant(r.reply),user('Where is the course?')]);assert.doesNotMatch(course.reply,/recorded overall|blocked/);
}
const h=[user('Why is my bot taking so long to find a deal?'),assistant('Do you see properties listed in Your leads?')];
const old=await ask([...h,user('Yes, but they are from last week.')]);assert.match(old.reply,/recorded overall/);assert.match(old.reply,/blocked/);
const short=await ask([user('Why is my bot taking so long to find a deal?'),assistant('Does the workspace say it is running?'),user('Yes'),assistant('Do you see any properties in Your leads?'),user('Yes but it is from last week.')]);assert.match(short.reply,/recorded overall/);assert.match(short.reply,/blocked/);
const stopped=await ask([user('Why did my bot stop when I did not pause it?'),assistant('Which part shows it stopped?'),user('It says its on but it is not running.')]);assert.match(stopped.reply,/recorded overall/);assert.match(stopped.reply,/blocked/);
for(const q of ['My browser stopped playing the course.','My bot is working now.','Should I stop my bot?','I stopped my bot myself.','My bot stopped calling one seller who opted out.','My bot is only showing call recordings from last week.'])assert.equal(supportMissingActivityConcern(q),false,q);
assert.equal(supportAccountReviewReply({kind:'account',messages:[user('Where is the course?'),assistant('Can you see the videos?'),user('Yes, but they are from last week.')],evidence:[work,saved]}),null);
assert.equal(modelCalls,0);
console.log('PASS stopped-work intent, old-lead follow-up, unknown/paused evidence and topic boundaries; offline only');
