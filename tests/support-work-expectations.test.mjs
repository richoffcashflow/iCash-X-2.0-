import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
process.env.ICASH_SUPPORT_AI_ENABLED='true';process.env.ICASH_SUPPORT_AI_MODEL='fixture';process.env.OPENAI_API_KEY='fixture';
let calls=0;const ask=(q,extra={})=>replyToSupport({kind:'account',messages:[u(q)],...extra},async()=>{calls++;throw Error('External model forbidden');});
for(const kind of ['account','access'])for(const q of ['How long does it take for it to find a deal?','How many days until the bot finds a deal?','When will my bot find a deal?']){
 const r=await ask(q,{kind});assert.match(r.reply,/no guaranteed time/i);assert.match(r.reply,/screens|screening/i);assert.doesNotMatch(r.reply,/What are you trying|add listings|within .*hours|guaranteed deal/i);
 assert.notEqual(r.status,'resolved');
}
for(const kind of ['account','access'])for(const q of ['How does the bot choose properties?','How does the algorithm select properties?']){
 const r=await ask(q,{kind});assert.match(r.reply,/automatically/i);assert.match(r.reply,/70%.*repairs.*wholesale fee/i);assert.doesNotMatch(r.reply,/guarantee|randomly/i);
}
const history=[u('My bot has not done any work.'),a('Your case is still in management review.')];
const changed=await ask('',{messages:[...history,u('When will my bot find a deal?')],handedOff:true});assert.match(changed.reply,/no guaranteed time/i);assert.equal(changed.status,'open');
for(const q of ['When will the seller sign my deal?','How much does it cost to find a deal?','The bot is not finding deals.','How does the algorithm choose my subscription?','Can you promise a deal tomorrow?']){
 const r=await ask(q,{allowAI:false});assert.doesNotMatch(r.reply,/There is no guaranteed time to find a deal\./);
}
assert.equal(calls,0);
console.log('PASS fictional deal timing and selection guidance, account/guest and topic boundaries; no provider calls');
