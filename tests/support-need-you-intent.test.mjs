import assert from 'node:assert/strict';
import {supportWorkflowReply} from '../lib/support-workflow-guidance.ts';
const u=content=>({role:'user',content}),o=content=>({role:'operator',content});
for(const q of ['I need you to check whether my account is set up.','We need you to help with setup before starting.','I need you guys to check my account; I still need to name the bot and add credits.']){
 assert.doesNotMatch(supportWorkflowReply([u(q)],[])?.reply??'',/Needs you marks/);
}
for(const q of ['What does Needs you mean?','A property says needs me.','Needs you','The alert says need you.'])assert.match(supportWorkflowReply([u(q)],[])?.reply??'',/Needs you marks/);
for(const messages of [[u('What does Needs you mean?'),o('We are now checking account setup.'),u('I need you to check my setup.')],[u('What does Needs you mean?'),u('I need you to check my billing.')]])assert.doesNotMatch(supportWorkflowReply(messages,[])?.reply??'',/Needs you marks/);
console.log('PASS need-you request versus property-label boundaries');

import {replyToSupport} from '../lib/support-conversation.ts';
for(const q of ['Could you check my account setup before I start?','I need you guys to check my account setup.']){
 const r=await replyToSupport({kind:'account',messages:[u(q)],allowAI:true},async()=>{throw Error('No paid models');});
 assert.match(r.reply,/can’t confirm.*setup/);assert.match(r.reply,/Settings/);assert.equal(r.status,'open');assert.equal(r.ai,false);
}
for(const q of ['My voice setup failed.','How do I set up closing with my title company?','My setup payment was charged twice.','Check my setup: no calls or texts have gone out.','My account is set up but the bot is stuck.'])assert.doesNotMatch(supportWorkflowReply([u(q)],[])?.reply??'',/every setup requirement/);
