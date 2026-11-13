import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
import {supportMissingActivityConcern} from '../lib/support-account-review.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const evidence=[{key:'work',status:'ok',code:'not_paused'}, {key:'outreach',status:'ok',outreach:{screened:23,contactProperties:5,callsStarted:2,textsSent:3,textsDelivered:1,textReplies:0,progress:{status:'ready',health:{status:'ok'}}}}];
const ask=(messages,extra={})=>replyToSupport({kind:'account',messages,evidence,allowAI:false,...extra},async()=>{throw Error('Paid model forbidden');});
for(const q of ["Why hasn't my bot texted anyone?", "It found 23 properties but hasn't texted or called anyone.", "It found 19 properties but haven’t text or called anyone.", "Why haven't it texted anyone?", "My bot has not called any sellers."]){
 assert.equal(supportMissingActivityConcern(q),true,q);
 const r=await ask([u(q)]);assert.equal(r.managementReview,true,q);assert.equal(r.status,'open');assert.match(r.reply,/2 (?:recorded )?call attempts/);assert.match(r.reply,/do not prove.*recent automatic outreach|so far/);
}
const prior=[u("My bot hasn't called anyone."),a('Is your bot currently running and not paused?')];
const continued=await ask([...prior,u("Yes, it's running.")]);assert.equal(continued.managementReview,true);assert.match(continued.reply,/2 call attempts/);
for(const q of ['The seller has not called anyone.','I have not texted anyone.','My bot has texted sellers now.','Do not call any sellers.','If my bot has not called anyone, what happens?','My bot has not called anyone, but it is working now.'])assert.equal(supportMissingActivityConcern(q),false,q);
for(const q of ['Where is the course?','Cancel my subscription.'])assert.doesNotMatch((await ask([...prior,u(q)])).reply,/2 call attempts/);
assert.doesNotMatch((await ask([prior[0],{role:'operator',content:'The work issue is fixed; we are checking a separate video problem.'},u("Yes, it's running.")])).reply,/2 call attempts/);
const unknown=await ask([prior[0]],{evidence:[]});assert.match(unknown.reply,/can.t verify/);assert.doesNotMatch(unknown.reply,/2 call attempts/);
const paused=await ask([prior[0]],{evidence:[{key:'work',status:'attention',code:'paused'}]});assert.match(paused.reply,/paused/);assert.equal(paused.status,'open');
console.log('PASS missing outreach reports and current-turn boundaries');
