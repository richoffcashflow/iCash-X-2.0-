import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content}),a=content=>({role:'assistant',content});
const evidence=[{key:'work',status:'ok',code:'not_paused',detail:'On',source:'fixture',observedAt:'2026-11-13T06:00:00Z'},{key:'outreach',status:'ok',detail:'Saved',source:'fixture',observedAt:'2026-11-13T06:00:00Z',outreach:{screened:8,callsStarted:4,textsSent:6,textsDelivered:2,textReplies:0,progress:{status:'ready',health:{status:'blocked',reason:'no_completed_work'}}}}];
const ask=(messages,extra={})=>replyToSupport({kind:'account',allowAI:false,handedOff:true,evidence,messages,...extra},async()=>{throw Error('Paid model forbidden');});
for(const q of ['How can I increase outreach volume?','No I mean volume of leads and outreach','How do I get more leads and calls?']){
 const r=await ask([u('Where are saved recordings?'),a('Open the property conversation.'),u(q)]);
 assert.match(r.reply,/Eligible research and outreach run automatically/);assert.match(r.reply,/recent|current/);assert.match(r.reply,/not.*(?:fix|troubleshooting)|not a verified repair/i);assert.doesNotMatch(r.reply,/volume controls|hasn.t started|will start/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
 const guest=await ask([u(q)],{kind:'access'});assert.doesNotMatch(guest.reply,/4 call|6 texts|8 properties/);assert.match(guest.reply,/can.t verify/i);
 const paused=await ask([u(q)],{evidence:[{...evidence[0],code:'paused'},evidence[1]]});assert.match(paused.reply,/currently paused/i);assert.doesNotMatch(paused.reply,/turn it on|unpause/i);
 const unknown=await ask([u(q)],{evidence:[]});assert.match(unknown.reply,/can.t verify/i);
 const next=await ask([u(q),a(r.reply),u('Where is the course?')]);assert.doesNotMatch(next.reply,/Eligible research and outreach run automatically/);
}
for(const q of ['How do I increase audio volume?','Can I get more leads and cancel my subscription?','The seller asked for more money.','How do I increase the volume?','I do not want more leads.','Tell me more about leads.'])assert.doesNotMatch((await ask([u(q)])).reply,/Eligible research and outreach run automatically/);
const operator=await ask([{role:'operator',content:'The separate missing recording still needs its original receipt.'},u('How can I increase outreach volume?')]);assert.equal(operator.status,'open');assert.doesNotMatch(operator.reply,/recording.*fixed|everything.*working/i);
console.log('PASS fictional outreach-volume requests, clarification, guest, Pause, unknown, operator and topic boundaries; no providers');

// A short answer to a lead-versus-response question is a concrete complaint.
for(const q of ['Low seller replies','Low sellers replies','Few replies from sellers','I am getting few seller responses']){
 const history=[u('Are these markets suitable?'),a('Are you seeing few leads or few seller replies?'),u(q)];
 const r=await ask(history);
 assert.match(r.reply,/6 texts.*2 delivered.*0 text replies/);
 assert.match(r.reply,/not.*response rate|don.t establish.*response rate/);
 assert.match(r.reply,/can.t.*(?:why|cause)/i);
 assert.doesNotMatch(r.reply,/what are you trying|which page|will start|keep.*working|buy|upgrade/i);
 assert.equal(r.status,'open');assert.equal(r.managementReview,true);
 const fresh=await ask(history,{handedOff:false});assert.equal(fresh.managementReview,true);assert.equal(fresh.status,'open');
 const paused=await ask(history,{evidence:[{...evidence[0],code:'paused'},evidence[1]]});
 assert.match(paused.reply,/currently paused/);assert.doesNotMatch(paused.reply,/unpause|select Run|turn it on/i);
 const unknown=await ask(history,{evidence:[]});assert.match(unknown.reply,/can.t verify.*reply counts/i);
 const guest=await ask(history,{kind:'access'});assert.doesNotMatch(guest.reply,/6 texts|2 delivered|0 text replies/);
 const operator=await ask([{role:'operator',content:'Delivery for a different property is still unverified.'},...history]);
 assert.equal(operator.status,'open');assert.doesNotMatch(operator.reply,/everything.*working|issue.*fixed/i);
 for(const next of ['Where is the course?','The seller agreed. How do I sign?','That issue is fixed. Where do I cancel?'])
  assert.doesNotMatch((await ask([...history,a(r.reply),u(next)])).reply,/don.t establish.*response rate/);
}
for(const q of ['Seller replies are not low.','I am getting many seller replies.','Few buyer replies','How do I reply to a seller?','The bot is not replying to a seller','My sign-in code has not arrived'])
 assert.doesNotMatch((await ask([u(q)])).reply,/don.t establish.*response rate/);
for(const q of ['I am not getting many seller responses','Sellers are not replying']){
 const r=await ask([u(q)]);assert.match(r.reply,/seller text replies|text replies overall/);assert.equal(r.status,'open');
}
console.log('PASS fictional seller-response complaints and negative, guest, Pause, unknown, operator and topic boundaries');
