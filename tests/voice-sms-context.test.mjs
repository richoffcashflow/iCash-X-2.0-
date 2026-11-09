import assert from 'node:assert/strict';
import {boundedVoiceSmsContext} from '../lib/voice-sms-context.ts';
const message={id:'m',direction:'incoming',body:'Needs a roof. Asking $150,000.',at:'2026-09-29T16:00:00Z'};
assert.equal(boundedVoiceSmsContext(null),null);
assert.equal(boundedVoiceSmsContext({threadId:'t',messages:[{...message,at:'invalid'}]}),null);
const result=boundedVoiceSmsContext({threadId:'t',messages:[{...message,body:'x'.repeat(5000)},message],maxOfferCents:99999999});
assert.equal(result.messages[0].body.length,1000);
assert.equal(result.messages[1].body,message.body);
assert(!('maxOfferCents' in result));
assert.equal(boundedVoiceSmsContext({threadId:'t',messages:Array.from({length:60},(_,i)=>({...message,id:String(i)}))}).messages.length,48);
assert.equal(boundedVoiceSmsContext({threadId:'t',messages:[{...message,direction:'system'}]}),null);
console.log('Voice SMS context: bounded history, invalid input and authority exclusion passed');

const notice='Free Msg: Receiver 12025550123 unable to receive message - Message Blocking is active';
assert.equal(boundedVoiceSmsContext({threadId:'t',messages:[{...message,body:notice,attachments:[]}]}),null);
const noisy={threadId:'t',messages:[message,...Array.from({length:60},()=>({...message,body:notice,attachments:[]}))]};
assert.deepEqual(boundedVoiceSmsContext(noisy).messages,[message],'Filter before the bound so notices do not crowd out real context');
for(const m of [{...message,body:'I received '+notice+' but please call.'},{...message,body:notice,attachments:[{}]},{...message,body:notice,direction:'outgoing'},{...message,body:notice,attachments:null}])assert.equal(boundedVoiceSmsContext({threadId:'t',messages:[m]}).messages.length,1);
