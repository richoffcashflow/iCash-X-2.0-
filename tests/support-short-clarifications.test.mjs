import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const evidence=[{key:'outreach',status:'ok',detail:'fixture',source:'fixture',observedAt:'2026-11-17T00:00:00Z',outreach:{screened:12,callsStarted:3,textsSent:0,textReplies:0,textsDelivered:0,progress:{status:'ready',health:{status:'blocked',reason:'pending_work'}}}}];
const ask=(messages,kind='account')=>replyToSupport({kind,messages,evidence,allowAI:false},async()=>{throw Error('Paid models forbidden');});
for(const kind of ['account','access']){
 for(const messages of [[u('When will they call and text more?')],[u('When will the bot call and text more?'),a('What are you trying to do?'),u('Outreach')]]){
  const r=await ask(messages,kind);assert.match(r.reply,/Eligible research and outreach/);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/will start|what are you trying/i);
  if(kind==='account'){assert.match(r.reply,/awaiting confirmation/);assert.equal(r.managementReview,true);}else assert.match(r.reply,/guest chat/);
 }
 const history=[u('I need help getting started, I am confused'),a('Which step is confusing?'),u('Everything')];
 for(const q of ['Everything','everythimg'])assert.match((await ask([u('I need help to get started, confused'),a('Open Course'),u('Can I talk to customer service'),a('Automated support'),u('I am confused, no one is wanting to look into it'),a('Which step?'),u(q)],kind)).reply,/one step at a time/);
 assert.doesNotMatch((await ask([u('I am confused and need help with my payment'),a('Which step?'),u('Everything')],kind)).reply,/one step at a time/);
 const r=await ask(history,kind);assert.match(r.reply,/one step at a time/i);assert.match(r.reply,/Course/);assert.equal(r.status,'open');assert.doesNotMatch(r.reply,/what are you trying|will start/i);
 for(const next of ['Where do I cancel my subscription?','My payment is missing','The seller said everything','Everything is fixed now'])assert.doesNotMatch((await ask([...history,a(r.reply),u(next)],kind)).reply,/one step at a time/i);
 for(const boundary of [{role:'operator',content:'The payment needs review.'},u('Where is my agreement?')])assert.doesNotMatch((await ask([u('I am confused getting started'),boundary,a('Which step?'),u('Everything')],kind)).reply,/one step at a time/i);
 for(const q of ['When will the seller call and text more?','I do not want the bot to call and text more','Outreach','When will they call and text more about my refund?'])assert.doesNotMatch((await ask([u(q)],kind)).reply,/Eligible research and outreach/);
 assert.doesNotMatch((await ask([u('When will the bot call and text more?'),{role:'operator',content:'Review a separate billing issue.'},u('Outreach')],kind)).reply,/Eligible research and outreach/);
}
console.log('PASS short clarification context, account/guest and operator/topic boundaries');
