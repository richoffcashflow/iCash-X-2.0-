import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content}),o=content=>({role:'operator',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fictional';process.env.ICASH_SUPPORT_AI_MODEL='fictional';
let modelCalls=0;const noModel=async()=>{modelCalls++;throw Error('External model forbidden');};
const history=[u('My bot texts say NOT SENT.'),a('Which property and status?')];
for(const kind of ['account','access'])for(const q of ['The messages are not going through.','Why isn’t the bot sending the text messages?' ,'It tried to text six sellers but it did not go through.','218 Cedar Street: the bot tried sending a message and it did not go through.']){
 const r=await replyToSupport({kind,messages:[...history,u(q)],allowAI:true},noModel);
 assert.match(r.reply,/sending records/i);assert.doesNotMatch(r.reply,/call jobs|recorded call|what are you trying/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
}
for(const q of ['running','It just shows the date.','It just shows the date 12/[number removed]:34:00 AM','Make my AI bot send messages please','Can you make my bot messages send or not?']){
 const r=await replyToSupport({kind:'account',messages:[...history,u('218 Cedar Street has the unsent text.'),u('Your system sucks.'),a('Is the bot running or paused?'),u(q)],allowAI:true},noModel);
 assert.match(r.reply,/sending records/i);assert.doesNotMatch(r.reply,/what are you trying|call jobs|Which property/i);assert.equal(r.managementReview,true);
}
for(const messages of [[...history,u('Where are the contracts?')],[...history,o('The sending issue is fixed; this case is now about billing.'),u('running')],[...history,u('That worked, the text was delivered.'),u('running')],[...history,u('Where is the course?'),a('Open Course.'),u('running')],[...history,u('It just shows the date but how do I import a property?')],[...history,u('How do I send a text?')],[...history,u('How many texts were sent?')],[...history,u('The texts are going through now.')],[u('My bot is running but has not sent any messages.')],[u('What if my texts are not sending?')],[u('My sign-in code is not sending.')],[u('The buyer did not send the payment.')],[u('I am not asking about texts not going through. Where are agreements?')]]){
 const r=await replyToSupport({kind:'account',messages,allowAI:false},noModel);assert.doesNotMatch(r.reply,/The unsent-text issue remains open/);
}
const paused=await replyToSupport({kind:'account',messages:[...history,u('218 Cedar Street has the unsent text.'),a('What status?'),u('paused')],evidence:[{key:'work',code:'paused',status:'attention',detail:'Paused'}],allowAI:false},noModel);
assert.match(paused.reply,/currently paused/);
const repeated=await replyToSupport({kind:'account',messages:[...history,u('My texts still say not sent.')],allowAI:true},noModel);
assert.doesNotMatch(repeated.reply,/Which property/i);
assert.equal(modelCalls,0);
console.log('PASS unsent text continuity and negative/operator/topic boundaries');
