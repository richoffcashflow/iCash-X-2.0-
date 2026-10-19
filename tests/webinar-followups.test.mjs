import test from 'node:test';
import assert from 'node:assert/strict';
import {processWebinarFollowups,webinarFollowupReadiness} from '../lib/webinar-email.ts';

test('retired reminders cannot dispatch even with old enabled settings and provider credentials',async()=>{
 const settings={enabled:true,smsEnabled:true,smartFollowups:true,fromEmail:'sessions@example.test',postalAddress:'Fixture address',subjects:['a','b','c'],messages:['a','b','c']};
 const env={VERCEL_ENV:'production',RESEND_API_KEY:'fixture',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture',ICASH_APP_ORIGIN:'https://example.test'};
 const ready=webinarFollowupReadiness(settings,env);assert.equal(ready.email,false);assert.equal(ready.sms,false);
 let calls=0;
 const forbidden=async()=>{calls++;throw Error('Retired reminders must not read, queue, authorize or send');};
 const result=await processWebinarFollowups({database:forbidden,transport:forbidden,env});
 assert.equal(result.sent,0);assert.equal(result.status,'removed');assert.equal(calls,0);
 assert.equal((await processWebinarFollowups()).sent,0,'Cron-compatible entry point remains inert');
});
