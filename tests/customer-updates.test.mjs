import assert from 'node:assert/strict';
import {customerUpdateConfiguration,normalizeUpdatePhone} from '../lib/customer-updates.ts';
import {dispatchCustomerUpdate,recordCustomerUpdateDelivery} from '../lib/customer-updates-service.ts';
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const env={RESEND_API_KEY:'fixture',RESEND_RECEIVING_WEBHOOK_SECRET:'whsec_fixture',ICASH_TITLE_FROM_EMAIL:'iCash X <alerts@example.com>',ICASH_APP_ORIGIN:'https://example.com',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_FROM:'+12125550100',CONTIGUITY_WEBHOOK_SECRET:'fixture'};
assert.equal(customerUpdateConfiguration(env).email,true);assert.equal(customerUpdateConfiguration(env).sms,true);
assert.equal(customerUpdateConfiguration({...env,RESEND_RECEIVING_WEBHOOK_SECRET:undefined}).email,false);
for(const origin of ['http://example.com','https://name:secret@example.com','https://example.com/other','https://example.com/?next=evil'])assert.equal(customerUpdateConfiguration({...env,ICASH_APP_ORIGIN:origin}).email,false);
assert.equal(normalizeUpdatePhone('(212) 555-0123'),'+12125550123');
function fixtures(mode='success',channel='email'){
 const calls=[],sends=[];let consumed=false;
 const job={id:uuid(1),sender:'+12125550999',channel,kind:'seller_reply',screeningId:uuid(2),recipient:channel==='email'?'owner@example.com':'+12125550123',unsubscribeToken:uuid(3)+uuid(4)};
 const db=async(path,method,body,signal)=>{calls.push({path,body});assert.equal(body.p_account,uuid(9));assert(signal instanceof AbortSignal);
  if(path.endsWith('claim_customer_update')){if(consumed||mode==='empty')return null;consumed=true;return job.id;}
  if(path.endsWith('authorize_customer_update'))return mode==='optout'?null:mode==='forged'?{...job,screeningId:'id&account=other'}:job;
  if(path.endsWith('finish_customer_update')){if(mode==='receipt_write_failure')throw Error('private db failure');return null;}
  throw Error('Unexpected database call');};
 const transport=async(url,options)=>{sends.push({url,options});assert.equal(options.redirect,'error');assert(options.signal instanceof AbortSignal);if(mode==='timeout')throw Error('timeout');if(mode==='provider_failure')return Response.json({}, {status:503});if(mode==='bad_receipt')return Response.json({});return Response.json(channel==='email'?{id:uuid(77)}:{data:{message_id:'synthetic-receipt'}});};
 return {db,transport,calls,sends};
}
let f=fixtures();assert.equal((await dispatchCustomerUpdate(uuid(9),{...f,env:{}})).status,'updates_disabled');assert.equal(f.calls.length,0);
for(const channel of ['email','sms']){f=fixtures('success',channel);assert.equal((await dispatchCustomerUpdate(uuid(9),{...f,env})).status,'updates_accepted');assert.equal(f.sends.length,1);const payload=JSON.parse(f.sends[0].options.body);assert.match(channel==='email'?payload.text:payload.message,/screeningId=00000000-0000-4000-8000-000000000002/);if(channel==='email'){assert.equal(f.sends[0].options.headers['Idempotency-Key'],`bot-update-${uuid(1)}`);assert.equal(payload.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');}else assert.match(payload.message,/Reply STOP/);assert.equal((await dispatchCustomerUpdate(uuid(9),{...f,env})).status,'updates_idle');assert.equal(f.sends.length,1);}
for(const mode of ['empty','optout','forged']){f=fixtures(mode);await dispatchCustomerUpdate(uuid(9),{...f,env});assert.equal(f.sends.length,0,mode);}
for(const mode of ['timeout','provider_failure','bad_receipt','receipt_write_failure']){f=fixtures(mode);assert.equal((await dispatchCustomerUpdate(uuid(9),{...f,env})).status,'updates_needs_review');await dispatchCustomerUpdate(uuid(9),{...f,env});assert.equal(f.sends.length,1,mode+' must not resend');}
const delivery=[];const db=async(path,method,body)=>delivery.push({path,body});
await recordCustomerUpdateDelivery({type:'email.bounced',data:{email_id:'forged',to:['owner@example.com']}},db);assert.equal(delivery.length,0);
await recordCustomerUpdateDelivery({type:'email.bounced',data:{email_id:uuid(77),to:['owner@example.com'],tags:{icash_update_id:uuid(1)}}},db);assert.equal(delivery.length,1);assert.equal(delivery[0].body.p_id,uuid(1));
console.log('Customer updates: channel readiness, normalized phone, one-use dispatch, private links, opt-out, uncertain-send holds and delivery validation passed. Mock providers only.');
