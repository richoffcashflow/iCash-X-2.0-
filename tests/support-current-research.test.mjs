import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportAccountReviewReply} from '../lib/support-account-review.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content}),operator=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let modelCalls=0;
const base=[{key:'work',code:'not_paused',status:'ok',detail:'Switched on.',source:'fixture',observedAt:'2026-11-01T12:00:00Z'}];
const saved={key:'outreach',code:'outreach_checked',status:'ok',detail:'Saved activity.',source:'fixture',observedAt:'2026-11-01T12:00:00Z',outreach:{screened:0,callsStarted:0,textsSent:0,textReplies:0,progress:{status:'ready',health:{status:'ok'}}}};
const ask=(messages,evidence=[...base,saved],kind='account')=>replyToSupport({kind,messages,evidence},async()=>{modelCalls++;throw Error('External model forbidden');});
for(const question of ['Is my AI currently searching for properties?','Is my bot actively finding new leads?','Is the bot researching leads right now?','Is the AI looking for properties?']){
 const r=await ask([user(question)]);
 assert.equal(r.status,'open',question);assert.match(r.reply,/setting alone does not prove/);
 assert.match(r.reply,/0 properties checked/);assert.match(r.reply,/do not confirm.*research task.*running/i);
 assert.doesNotMatch(r.reply,/add listings|upload properties|no eligible|working normally|blocked|missing or slow/i);
 assert.notEqual(r.managementReview,true);
 const thanks=await ask([user(question),assistant(r.reply),user('Thanks')]);assert.equal(thanks.status,'open');
 const topic=await ask([user(question),assistant(r.reply),user('Where is the course?')]);assert.doesNotMatch(topic.reply,/properties checked|research task/);
 const cancel=await ask([user(question),assistant(r.reply),user('Cancel my subscription')]);assert.match(cancel.reply,/Cancel subscription/);
 const fixed=await ask([user(question),assistant(r.reply),user('It is working now.')]);assert.equal(fixed.status,'resolved');
}
const question='Is my AI currently searching for properties?';
const blocked={...saved,outreach:{...saved.outreach,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}};
const pending=await ask([user(question)],[...base,blocked]);assert.equal(pending.managementReview,true);assert.match(pending.reply,/no completed work/);assert.equal(pending.status,'open');
const paused=await ask([user(question)],[{...base[0],code:'paused'},saved]);assert.match(paused.reply,/bot is paused/);assert.doesNotMatch(paused.reply,/has resumed|is actively finding/);
const unknown=await ask([user(question)],[]);assert.match(unknown.reply,/can.t verify.*research/i);assert.equal(unknown.status,'open');assert.notEqual(unknown.managementReview,true);
const historical=await ask([user(question)],[...base,{...saved,outreach:{...saved.outreach,screened:23,callsStarted:7}}]);assert.match(historical.reply,/23 properties checked/);assert.match(historical.reply,/do not confirm.*research task.*running/i);
for(const q of ['Can the bot find leads?','Does the bot find leads automatically?','Is the bot finding leads in Nevada?','Is the bot finding leads while I am offline?','Is the bot researching title companies?','My bot is finding leads now.','Is my browser searching for properties?','Where can I find leads?']){
 assert.equal(supportAccountReviewReply({kind:'account',messages:[user(question),assistant('Checks are inconclusive.'),user(q)],evidence:[...base,saved]}),null,q);
}
const finding=await ask([user('My bot is not doing anything.'),operator('A display problem remains under review; no repair is confirmed.'),user(question)]);
assert.equal(finding.status,'open');assert.doesNotMatch(finding.reply,/fixed|repaired|working normally/);
assert.equal(supportAccountReviewReply({kind:'access',messages:[user(question)],evidence:[...base,saved]}),null);
assert.equal(modelCalls,0);
console.log('PASS current research evidence, unknown/blocked/paused checks and acknowledgment/topic/operator boundaries; offline only');
