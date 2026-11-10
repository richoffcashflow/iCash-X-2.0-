import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportAccountReviewReply} from '../lib/support-account-review.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content}),operator=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let modelCalls=0;
const evidence=[{key:'work',code:'not_paused',status:'ok',detail:'Switched on.',source:'fixture',observedAt:'2026-11-10T19:00:00Z'}];
const ask=messages=>replyToSupport({kind:'account',messages,evidence},async()=>{modelCalls++;throw Error('External model forbidden');});
const complaints=['Why did my AI bot not do anything yesterday?','My bot did not do anything for two days.','My AI has not done anything since this morning.','The bot has been running for hours and nothing has happened.','My AI is running and nothing occurred.','My bot is on and nothing occured.','My bot is not doing anything and it is not working well.'];
for(const question of complaints){
 const r=await ask([user(question)]);assert.equal(r.managementReview,true,question);assert.equal(r.status,'open');
 assert.match(r.reply,/missing or slow activity/);assert.match(r.reply,/setting alone does not prove/);assert.doesNotMatch(r.reply,/What are you trying|hasn.t found any|Which page/i);
 const thanks=await ask([user(question),assistant(r.reply),user('Thanks')]);assert.notEqual(thanks.status,'resolved','Thanks is not activity evidence');
}
const history=[user('My bot has been running all morning and nothing happened.'),assistant('Which page are you looking at?')];
for(const page of ['All activity','The All activity page.','Your leads']){
 const r=await ask([...history,user(page)]);assert.equal(r.managementReview,true);assert.equal(r.status,'open');assert.match(r.reply,/missing or slow activity/);
}
const follow=[...history,user('All activity'),assistant('I don’t have a confirmed answer to that yet.')];
for(const q of ['How can I tell the AI is doing something?','When can I tell my bot is working?']){
 const r=await ask([...follow,user(q)]);assert.equal(r.managementReview,true);assert.equal(r.status,'open');assert.match(r.reply,/recorded|saved activity/);assert.doesNotMatch(r.reply,/hasn.t found|everything is working/);
}
for(const q of ['Where is the course?','How do I cancel my subscription?','My bot is working now.','Nothing happened when I opened the course.','Where is the leads section?']){
 const r=supportAccountReviewReply({kind:'account',messages:[...history,user(q)],evidence});assert.equal(r?.managementReview??false,false,q);
}
for(const messages of [
 [user('My bot did not do anything yesterday, but it is working now.')],
 [user('The bot is working. Nothing happened when I opened the course.')],
 [user('Does the bot do anything while I watch the course?')],
 [user('All activity')],
 [...history,operator('The customer confirmed a separate browser issue; do not infer bot activity.'),user('All activity')],
 [...history,user('Where is the course?'),assistant('Which page is open?'),user('All activity')],
 [...history,user('My bot is working now.'),assistant('Glad that worked.'),user('All activity')]
])assert.equal(supportAccountReviewReply({kind:'account',messages,evidence})?.managementReview??false,false,JSON.stringify(messages));
const canceled=await ask([...history,user('Cancel my subscription')]);assert.match(canceled.reply,/Cancel subscription/);
const confirmed=await ask([...history,user('My bot is working now.')]);assert.equal(confirmed.status,'resolved');
assert.equal(modelCalls,0);
console.log('PASS activity complaint recurrence, page continuations, result evidence and negative/operator/topic boundaries; offline only');
const pendingHistory=[user('How does my membership discount apply?'),operator('Eligible new usage is discounted automatically; older work keeps its original pricing.'),user('Earlier work is awaiting confirmation on my screen.'),assistant('Which page shows that message?')];
const pending=await ask(pendingHistory.slice(0,-1));assert.equal(pending.managementReview,true);
const home=await ask([...pendingHistory,user('On the home page')]);assert.equal(home.managementReview,true);assert.equal(home.status,'open');assert.doesNotMatch(home.reply,/discount|lead price/i);
for(const q of ['How do I cancel my subscription?','Where is the course?','The seller is awaiting a contract.'])assert.equal(supportAccountReviewReply({kind:'account',messages:[...pendingHistory,user(q)],evidence})?.managementReview??false,false);
assert.equal(supportAccountReviewReply({kind:'account',messages:[user('On the home page')],evidence})?.managementReview??false,false);
assert.equal(supportAccountReviewReply({kind:'account',messages:[...pendingHistory,operator('A separate billing finding is under review.'),user('On the home page')],evidence})?.managementReview??false,false);
assert.equal(modelCalls,0);

// Fictional workspace progress reports must not fall through to generic help.
for(const question of [
 'My app has been running since yesterday without any movement or updates.',
 'The workspace is running but there is no progress.',
 'My bot has been running for hours without activity.'
]){
 const r=await ask([user(question)]);
 assert.equal(r.managementReview,true,question);assert.equal(r.status,'open');
 assert.match(r.reply,/setting alone does not prove/);assert.doesNotMatch(r.reply,/What are you trying|restart|refresh/i);
 const page=await ask([user(question),assistant('Which page are you looking at?'),user('Home')]);
 assert.equal(page.managementReview,true);assert.equal(page.status,'open');
 const thanks=await ask([user(question),assistant(r.reply),user('Thanks')]);
 assert.notEqual(thanks.status,'resolved');
}
for(const question of [
 'The app is running fine. How do I update my name?',
 'The app has been running without updates to the seller price.',
 'My browser is running without any movement.',
 'The course video is running without any movement.',
 'The app video is running without progress.',
 'Can I keep the app running without activity?',
 'The app has been running without progress, but it is working now.',
 'How do I keep the app running without installing updates?'
])assert.equal(supportAccountReviewReply({kind:'account',messages:[user(question)],evidence})?.managementReview??false,false,question);
const stalledApp=[user('My app has been running all day without progress.'),assistant('Which page is open?')];
for(const tail of [
 [user('Where is the course?')],
 [operator('A separate browser problem remains under review.'),user('Home')],
 [user('The app is working now.'),assistant('Glad that worked.'),user('Home')]
])assert.equal(supportAccountReviewReply({kind:'account',messages:[...stalledApp,...tail],evidence})?.managementReview??false,false);
assert.match((await ask([...stalledApp,user('Cancel my subscription')])).reply,/Cancel subscription/);
assert.equal(modelCalls,0);
console.log('PASS running workspace progress complaints and negative/topic/operator boundaries');
