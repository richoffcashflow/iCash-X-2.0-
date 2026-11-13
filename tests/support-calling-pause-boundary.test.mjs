import assert from 'node:assert/strict';
import {replyToSupport} from '../lib/support-conversation.ts';
const u=content=>({role:'user',content});
const ask=(q,extra={})=>replyToSupport({kind:'account',handedOff:true,messages:[u(q)],allowAI:false,...extra},async()=>{throw Error('Paid calls forbidden');});
for(const kind of ['account','access']){
 for(const q of ['Your business calling number is unavailable. Please try again.', 'The error is: business calling number is unavailable'])assert.match((await ask(q,{kind})).reply,/service.*calling number/i);
 assert.match((await ask('If the bots not working properly wouldn’t it be smart to pause it',{kind})).reply,/Pause bot/);
 const r=await ask('The business calling number is unavailable.',{kind});
 assert.match(r.reply,/service.*calling number|calling service/i);assert.doesNotMatch(r.reply,/without a usable seller number|check.*Settings|change.*phone/i);assert.equal(r.status,'open');assert.equal(r.managementReview,true);
 const p=await ask("If my bot is not working properly, wouldn't it be sensible to pause it?",{kind});assert.match(p.reply,/Pause bot/);assert.match(p.reply,/already started/);assert.match(p.reply,/not a repair/);assert.equal(p.status,'open');
}
for(const q of ['My seller number is unavailable.','My business calling number works now.','Where is my business email?','Pause my subscription.','Do not pause my bot.','Should I pause the training video?'])assert.doesNotMatch((await ask(q)).reply,/service’s calling number|choose Pause bot/i);
for(const messages of [[u('Business calling number is unavailable'),{role:'operator',content:'The call issue is cleared; checking an unrelated document.'},u('What next?')],[u('Business calling number is unavailable'),{role:'assistant',content:'Service review required.'},u('Where is the course?')]])assert.doesNotMatch((await ask('',{messages})).reply,/service’s calling number|choose Pause bot/i);
console.log('PASS fictional calling-service error and conditional pause boundaries; no paid calls');
