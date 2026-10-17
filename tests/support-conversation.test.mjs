import assert from 'node:assert/strict';
import {supportConversationFallback,replyToSupport} from '../lib/support-conversation.ts';
const user=content=>({role:'user',content}),assistant=content=>({role:'assistant',content});
let history=[user('Filled out the code & nothing happened.')];
let answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/email or text/);
history.push(assistant(answer.reply),user('Email'));answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/device and browser/);assert.doesNotMatch(answer.reply,/email or text/);
history.push(assistant(answer.reply),user('iPhone Safari'));answer=supportConversationFallback({kind:'access',messages:history});assert.match(answer.reply,/error message/);
history.push(assistant(answer.reply),user('Nothing, no error'));answer=supportConversationFallback({kind:'access',messages:history});assert.equal(answer.status,'escalated');
assert.equal(supportConversationFallback({kind:'access',messages:[user('That worked, I’m in!')]}).status,'resolved');
assert.notEqual(supportConversationFallback({kind:'access',messages:[user('That worked but I am still stuck')]}).status,'resolved');
assert.equal(supportConversationFallback({kind:'account',messages:[user('I want a human')]}).status,'escalated');
assert.match(supportConversationFallback({kind:'account',messages:[user('cancel my subscription')]}).reply,/do not cancel/);
assert.equal(supportConversationFallback({kind:'account',messages:[{role:'operator',content:'Checking this.'},user('Any update?')]}).status,'escalated');
const env={...process.env};process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.OPENAI_API_KEY='fixture-only';process.env.ICASH_SUPPORT_AI_MODEL='fixture-model';
try{
 const context={kind:'account',messages:[user('The bot stopped'),assistant('Which screen?'),user('The workspace, sk_live_abcdefghijkl and me@example.invalid')],evidence:[{key:'work',status:'attention',detail:'The bot is paused.',source:'fixture',observedAt:new Date().toISOString()}]};let calls=0;
 const fetcher=async(url,init)=>{calls++;const body=JSON.parse(init.body);assert.equal(url,'https://api.openai.com/v1/chat/completions');assert.equal(body.store,false);assert.equal(body.response_format.json_schema.strict,true);assert.equal(body.tools,undefined);assert(init.signal);assert.match(body.messages[1].content,/Which screen/);assert(!body.messages[1].content.includes('sk_live_abcdefghijkl'));assert(!body.messages[1].content.includes('me@example.invalid'));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Your bot is paused. Are you ready to resume it from the workspace?',needsTeam:false})}}]});};
 const response=await replyToSupport(context,fetcher);assert(response.ai);assert.match(response.reply,/paused/);assert.equal(calls,1);
 await replyToSupport({...context,allowAI:false},fetcher);assert.equal(calls,1,'Replay recovery never repeats a paid call');
 await replyToSupport({kind:'access',messages:[user('code does nothing')]},fetcher);assert.equal(calls,1,'Access recovery has no paid provider dependency');
 for(const bad of [{choices:[{finish_reason:'length',message:{content:'{}'}}]},{choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'I have refunded your payment.',needsTeam:false})}}]},{choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Open https://attacker.invalid',needsTeam:false})}}]}])assert.equal((await replyToSupport(context,async()=>Response.json(bad))).ai,false);
 assert.equal((await replyToSupport(context,async()=>{throw Error('timeout');})).ai,false);
}finally{process.env=env;}
console.log('PASS support conversations: multi-turn missing details, resolution, human handoff, cancellation boundaries, redaction, bounded structured AI, provider failure and replay fallback; no real provider requests.');
