import assert from 'node:assert/strict';
import {paymentFailureKind,recoveryStep,recoveryCopy} from '../lib/payment-recovery-policy.ts';
import {observeInvoiceRecovery,processPaymentRecoveries,recordPaymentRecoveryDelivery} from '../lib/payment-recovery.ts';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,now=Date.parse('2026-11-19T18:00:00Z'),ago=days=>new Date(now-days*86400000).toISOString();
for(const code of ['insufficient_funds','issuer_not_available','processing_error','try_again_later'])assert.equal(paymentFailureKind({last_payment_error:{decline_code:code}}),'temporary');
for(const code of ['lost_card','stolen_card','generic_decline','expired_card','restricted_card',undefined])assert.equal(paymentFailureKind({last_payment_error:{decline_code:code}}),'payment_method');
assert.equal(paymentFailureKind({status:'requires_action'}),'authentication');assert.equal(paymentFailureKind({last_payment_error:{decline_code:'insufficient_funds',advice_code:'do_not_try_again'}}),'payment_method');
for(const [day,expected] of [[0,0],[2,0],[3,1],[6,1],[7,2],[12,2],[13,3],[14,null],[-1,null]])assert.equal(recoveryStep('email',ago(day),now),expected);
assert.equal(recoveryStep('sms',ago(.5),now),null);assert.equal(recoveryStep('sms',ago(1),now),0);assert.equal(recoveryStep('email','bad',now),null);
assert.match(recoveryCopy('membership',5000,0,'https://invoice.stripe.com/fixture').text,/existing invoice/);assert.doesNotMatch(recoveryCopy('membership',5000,3,'x').text,/last chance|cancelled today/i);
const env={VERCEL_ENV:'production',ICASH_AUTH_EMAIL_READY:'true',RESEND_API_KEY:'fixture',CONTIGUITY_API_KEY:'fixture',CONTIGUITY_WEBHOOK_SECRET:'fixture'};
function setup(){
 const calls=[],sends=[],jobs=new Map();let sourceActive=true,failSend=false;
 const c={id:id(1),kind:'membership',source_id:id(2),account_id:id(3),invoice_id:'in_fixture',amount_cents:5000,started_at:ago(2),lease_token:id(4)};
 const member={id:id(2),account_id:id(3),mode:'live',state:'payment_failed',stripe_subscription_id:'sub_fixture',stripe_customer_id:'cus_fixture',payer_email:'fixture@example.invalid',cancel_at_period_end:false};
 const invoice={id:'in_fixture',livemode:true,status:'open',currency:'usd',attempted:true,billing_reason:'subscription_cycle',amount_remaining:5000,amount_paid:0,created:(now-2*86400000)/1000,customer:'cus_fixture',customer_email:'fixture@example.invalid',parent:{subscription_details:{subscription:'sub_fixture'}},hosted_invoice_url:'https://invoice.stripe.com/i/fixture'};
 const sub={id:'sub_fixture',livemode:true,status:'past_due',customer:'cus_fixture',metadata:{icash_membership:id(2)},cancel_at_period_end:false,cancel_at:null};
 const db=async(path,method,body)=>{
  calls.push({path,method,body});
  if(path==='rpc/icash_claim_payment_recoveries')return [c];
  if(path.startsWith('icash_memberships?'))return [member];
  if(path==='rpc/icash_register_invoice_recovery'||path==='rpc/icash_finish_payment_recovery')return;
  if(path==='rpc/icash_payment_recovery_active')return sourceActive;
  if(path==='rpc/icash_claim_payment_recovery_message'){
   const key=body.p_channel;if(jobs.has(key))return null;
   const job={id:id(key==='email'?10:11),recipient:key==='email'?'fixture@example.invalid':'+12125550123',sender:'+12125550100',message:body.p_message};jobs.set(key,job);return job;
  }
  if(path.startsWith('icash_payment_recovery_deliveries?'))return [];
  if(path.startsWith('icash_funding_orders?'))return path.includes('credited_at=gt.')?[]:[{payer_email:'fixture@example.invalid',price_cents:2500}];
  throw Error('Unexpected DB '+path);
 };
 const transport=async(url,options)=>{sends.push({url,options,payload:JSON.parse(options.body)});assert.equal(options.redirect,'error');if(failSend)throw Error('Response lost');return Response.json(url.includes('resend')?{id:id(90)}:{data:{message_id:'fixture-sms'}});};
 const stripe=()=>({invoices:{retrieve:async()=>invoice},subscriptions:{retrieve:async()=>sub}});
 return {c,member,invoice,sub,db,stripe,transport,calls,sends,jobs,setActive:v=>sourceActive=v,setFail:v=>failSend=v};
}
let f=setup();await observeInvoiceRecovery(f.invoice,f.sub,f.db,now);assert.equal(f.calls.at(-1).body.p_invoice,'in_fixture');assert.equal(f.calls.at(-1).body.p_source,id(2));
for(const mutate of [f=>f.invoice.status='paid',f=>f.sub.cancel_at_period_end=true,f=>f.sub.status='canceled',f=>f.invoice.billing_reason='subscription_create',f=>f.invoice.created=(now-15*86400000)/1000]){f=setup();mutate(f);await observeInvoiceRecovery(f.invoice,f.sub,f.db,now);assert(!f.calls.some(c=>c.path==='rpc/icash_register_invoice_recovery'));}
for(const mutate of [f=>f.sub.customer='cus_other',f=>f.invoice.livemode=false,f=>f.invoice.customer_email='other@example.invalid',f=>f.member.stripe_subscription_id='sub_other']){f=setup();mutate(f);await assert.rejects(observeInvoiceRecovery(f.invoice,f.sub,f.db,now));assert(!f.calls.some(c=>c.path==='rpc/icash_register_invoice_recovery'));}
f=setup();assert.equal((await processPaymentRecoveries({...f,env:{...env,VERCEL_ENV:'preview'},now})).disabled,true);assert.equal(f.calls.length,0);
f=setup();let result=await processPaymentRecoveries({...f,env,now});assert.deepEqual(result,{checked:1,accepted:2,failed:0});assert.equal(f.sends[0].options.headers['Idempotency-Key'],'payment-recovery-'+id(10));assert.match(f.sends[0].payload.text,/https:\/\/invoice.stripe.com\/i\/fixture/);assert.doesNotMatch(f.sends[1].payload.message,/invoice.stripe|fixture@example/);assert.equal(f.sends[0].payload.tags[0].value,id(10));await processPaymentRecoveries({...f,env,now});assert.equal(f.sends.length,2);
for(const mutate of [f=>{f.invoice.status='paid';f.invoice.amount_paid=5000;},f=>f.sub.status='canceled',f=>f.member.cancel_at_period_end=true,f=>f.invoice.status='void',f=>f.invoice.amount_remaining=2500,f=>f.setActive(false),f=>f.c.started_at=ago(15)]){
 f=setup();mutate(f);if(f.member.cancel_at_period_end)f.setActive(false);await processPaymentRecoveries({...f,env,now});assert.equal(f.sends.length,0);assert.notEqual(f.calls.at(-1).body.p_state,'open');
}
for(const mutate of [f=>f.invoice.hosted_invoice_url='https://example.invalid/steal',f=>f.invoice.customer='cus_other',f=>f.c.account_id=id(99)]){f=setup();mutate(f);assert.equal((await processPaymentRecoveries({...f,env,now})).failed,1);assert.equal(f.sends.length,0);}
f=setup();f.c.kind='recharge';f.c.invoice_id=null;f.c.amount_cents=2500;result=await processPaymentRecoveries({...f,env,now});assert.equal(result.accepted,2);assert.match(f.sends[0].payload.text,/balance has not been credited/);assert.match(f.sends[0].payload.text,/enable auto recharge/);
f=setup();f.setFail(true);assert.equal((await processPaymentRecoveries({...f,env,now})).failed,1);assert.equal(f.sends.length,1,'Email uncertainty does not fan out into SMS');assert.equal(f.calls.at(-1).path,'rpc/icash_finish_payment_recovery');
const receipts=[];await recordPaymentRecoveryDelivery({type:'email.bounced',data:{email_id:id(90),to:['fixture@example.invalid'],tags:{icash_payment_recovery_id:id(10)}}},async(path,method,body)=>receipts.push({path,body}));assert.equal(receipts[0].body.p_id,id(10));
await recordPaymentRecoveryDelivery({type:'email.bounced',data:{email_id:'forged',to:['fixture@example.invalid']}},async()=>assert.fail());
console.log('PASS payment recovery: issuer-aware policy, 14-day cadence, fresh invoice/subscription/recipient binding, safe hosted links, preview gates, success/cancel stops, recharge instructions, durable dispatch and signed delivery observations. Mock providers only.');
