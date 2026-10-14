import assert from 'node:assert/strict';
import {dispatchReliabilityAlerts} from '../lib/reliability-alerts-service.ts';
import {ownerInboundTarget} from '../lib/owner-inbound-acceptance.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={VERCEL_ENV:'production',ICASH_RELIABILITY_EMAIL_ENABLED:'true',ICASH_RELIABILITY_FROM_EMAIL:'noreply@example.invalid',RESEND_API_KEY:'fixture',SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'fixture'};
const claim={id:id(1),incidentId:id(2),event:'detected',openedAt:new Date().toISOString(),reasons:['workflows'],issueCount:2};
const owner={id:ownerInboundTarget.ownerUserId,email:'verified-owner@example.invalid',email_confirmed_at:new Date().toISOString()};
let calls=[],providerCalls=0,claimed=false,finishFailures=0,failProvider=false,ownerValue=owner,event='detected';
const db=async(path,method,body)=>{
 calls.push({path,method,body});
 if(path.endsWith('refresh_reliability_incident'))return true;
 if(path.endsWith('claim_reliability_notification')){if(claimed)return null;claimed=true;return {...claim,event};}
 if(path.endsWith('finish_reliability_notification')&&finishFailures-->0)throw Error('fixture lost response');
 return null;
};
const transport=async(url,options)=>{
 if(String(url).includes('/auth/v1/admin/users/')){assert.equal(new URL(url).pathname,'/auth/v1/admin/users/'+ownerInboundTarget.ownerUserId);return Response.json(ownerValue);}
 assert.equal(url,'https://api.resend.com/emails');providerCalls++;
 const payload=JSON.parse(options.body);assert.deepEqual(payload.to,[owner.email]);assert.equal(options.headers['Idempotency-Key'],'reliability-'+claim.id);
 assert(!JSON.stringify(payload).includes('customer'));assert(!JSON.stringify(payload).includes('server-account'));assert(payload.text.includes('https://www.geticashx.com/admin'));
 if(failProvider)throw Error('fixture ambiguous provider timeout');
 return Response.json({id:id(3)});
};
const run=(override={})=>dispatchReliabilityAlerts({db,env,transport,delay:async()=>{},...override});
assert.equal(await run({env:{...env,VERCEL_ENV:'preview'}}),'skipped');assert.equal(calls.length,0);assert.equal(providerCalls,0);
assert.equal(await run({env:{...env,ICASH_RELIABILITY_EMAIL_ENABLED:'false'}}),'disabled');assert.equal(calls.at(-1).body.p_configuration,'disabled');assert.equal(providerCalls,0);
assert.equal(await run({env:{...env,RESEND_API_KEY:''}}),'unconfigured');assert.equal(providerCalls,0);
ownerValue={...owner,id:id(99)};assert.equal(await run(),'recipient_unverified');assert.equal(providerCalls,0);assert.equal(claimed,false);
ownerValue={...owner,email_confirmed_at:null};assert.equal(await run(),'recipient_unverified');assert.equal(providerCalls,0);assert.equal(claimed,false);
ownerValue=owner;finishFailures=1;assert.equal(await run(),'accepted');assert.equal(providerCalls,1);assert.equal(calls.filter(x=>x.path.endsWith('finish_reliability_notification')).length,2,'Only receipt save retries, not sending');
assert.equal(await run(),'idle');assert.equal(providerCalls,1);
claimed=false;event='recovered';assert.equal(await run(),'accepted');assert.equal(providerCalls,2);
claimed=false;failProvider=true;assert.equal(await run(),'needs_review');assert.equal(providerCalls,3);assert.equal(calls.at(-1).body.p_provider,null);
assert.equal(await run(),'idle');assert.equal(providerCalls,3,'Uncertain provider outcome is not replayed');
console.log('PASS production-only owner alerts, verified recipient, explicit missing configuration, deterministic provider key, detected/recovered messages and receipt-only retry. No live provider requests.');
