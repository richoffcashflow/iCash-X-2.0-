// Explicit, one-off verification of the synthetic Checkout created for this release.
// Never part of the normal build or test command. No live mode, mail, or AI work.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import Stripe from 'stripe';
import ts from 'typescript';
import {db as database} from '../lib/stripe-test.ts';
import {fundingMode} from '../lib/funding-policy.ts';
import * as policy from '../lib/membership-policy.ts';
import {vipActive} from '../lib/vip-policy.ts';

assert.equal(process.argv[2],'--run-synthetic-checks','Explicit sandbox verification required');
assert.equal(process.env.VERCEL_ENV,'preview','Preview only');
assert.equal(fundingMode(),'test','Stripe test key required');
const membershipId='943c906d-3965-4fdd-9659-428b1b106e1a';
const customerId='cus_VVch1OHamUp6cF',subscriptionId='sub_1UUbUGDn2fEKiqXozxwwRj25';
const originalInvoice='in_1UUbUFDn2fEKiqXoTtPI0bIW',paidInvoice='in_1UUc6DDn2fEKiqXoebJ0ja7v';
const clockId='clock_1UUc67Dn2fEKiqXokj5VcEVc';
const email='trial-preview-20261026a@example.invalid';
const stripe=new Stripe(process.env.STRIPE_SECRET_KEY,{maxNetworkRetries:1,timeout:15000});
const invoices=new Set([originalInvoice,paidInvoice]);
let stage='scope';
async function member(){
 const [m]=await database(`icash_memberships?id=eq.${membershipId}&select=*`);
 assert(m&&m.id===membershipId&&m.mode==='test'&&m.account_id===null&&m.checkout_email===email&&m.price_cents===5000&&m.initial_price_cents===0&&m.stripe_customer_id===customerId&&m.stripe_subscription_id===subscriptionId&&m.legacy_trial_offer==='legacy-trial-2026-10-25.1','Synthetic membership binding');
 return m;
}
async function db(path,method='GET',body){
 assert(path.startsWith(`icash_memberships?id=eq.${membershipId}&`)||[...invoices].some(id=>path.startsWith(`icash_membership_invoices?stripe_invoice_id=eq.${id}&`))||path==='rpc/icash_settle_membership_invoice_v2','Unexpected database path');
 if(method!=='GET'){
  await member();
  assert(method==='PATCH'||path==='rpc/icash_settle_membership_invoice_v2','Unexpected mutation');
  if(path.startsWith('rpc/'))assert(body.p_membership===membershipId&&body.p_subscription===subscriptionId&&body.p_customer===customerId&&invoices.has(body.p_invoice)&&body.p_amount===5000,'Settlement scope');
 }
 return database(path,method,body);
}
async function subscription(){
 const s=await stripe.subscriptions.retrieve(subscriptionId);
 assert(!s.livemode&&s.customer===customerId&&s.metadata.icash_membership===membershipId&&s.metadata.icash_legacy_trial==='legacy-trial-2026-10-25.1'&&s.test_clock===clockId,'Synthetic Stripe binding');
 return s;
}
async function ready(){
 const deadline=Date.now()+180000;
 while(Date.now()<deadline){const c=await stripe.testHelpers.testClocks.retrieve(clockId);assert(!c.livemode&&c.status!=='internal_failure','Test clock failed');if(c.status==='ready')return c;await delay(3000);}
 throw Error('Test clock did not become ready within three minutes');
}
// Execute the production service body with the real Stripe SDK and database.
// The dependency wrapper only rejects access outside this one synthetic record.
const dependencies={...policy,vipActive,db,fundingMode,fundingStripe:()=>stripe,authorizedPlanPrice:async()=>{throw Error('Plan changes are outside this test');}};
globalThis.__legacySandboxDependencies=dependencies;
const source=ts.transpileModule(readFileSync(new URL('../lib/membership.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import .*;\s*$/gm,'');
const service=await import('data:text/javascript;base64,'+Buffer.from('const {'+Object.keys(dependencies).join(',')+'}=globalThis.__legacySandboxDependencies;\n'+source).toString('base64'));
try{
 await member();
 const customer=await stripe.customers.retrieve(customerId);
 assert(!customer.deleted&&!customer.livemode&&customer.email===email&&customer.test_clock===clockId,'Synthetic customer binding');
 let sub=await subscription();
 assert.equal(sub.status,'active','Existing test renewal must be active');
 stage='paid renewal';
 await service.reconcileMembershipCheckout(await member());
 let m=await member();
 const paidThrough=m.paid_through;
 assert.equal(Date.parse(paidThrough)/1000,sub.items.data[0].current_period_end,'Renewal must extend access to Stripe period end');
 const receipts=await database(`icash_membership_invoices?membership_id=eq.${membershipId}&select=stripe_invoice_id,amount_cents`);
 assert.deepEqual(receipts,[{stripe_invoice_id:paidInvoice,amount_cents:5000}],'Exactly one real paid receipt');
 await service.settleMembershipInvoice(paidInvoice);
 await service.settleMembershipInvoice(originalInvoice);
 assert.equal((await member()).paid_through,paidThrough,'Duplicate and old-zero events cannot extend access');
 console.log('SANDBOX PASS: real $50 renewal reconciled; duplicate and old-zero replay preserved one receipt and exact access end.');

 stage='failed renewal';
 await ready();
 const failedMethod=await stripe.paymentMethods.attach('pm_card_chargeCustomerFail',{customer:customerId},{idempotencyKey:'legacy-sandbox-decline-20261026'});
 assert(!failedMethod.livemode&&failedMethod.customer===customerId,'Test method binding');
 await stripe.subscriptions.update(subscriptionId,{default_payment_method:failedMethod.id},{idempotencyKey:'legacy-sandbox-decline-default-20261026'});
 const nextPeriod=sub.items.data[0].current_period_end;
 await stripe.testHelpers.testClocks.advance(clockId,{frozen_time:nextPeriod+60});await ready();
 await stripe.testHelpers.testClocks.advance(clockId,{frozen_time:nextPeriod+86400});await ready();
 sub=await subscription();
 assert(['past_due','unpaid'].includes(sub.status),'Renewal must fail with the attached decline card');
 const failure=await stripe.invoices.retrieve(typeof sub.latest_invoice==='string'?sub.latest_invoice:sub.latest_invoice.id);
 assert(!failure.livemode&&failure.status==='open'&&failure.amount_paid===0&&failure.total===5000,'Unpaid $50 invoice expected');
 invoices.add(failure.id);
 await service.syncMembershipSubscription(sub);
 await assert.rejects(service.settleMembershipInvoice(failure.id));
 m=await member();assert.equal(m.state,'payment_failed');assert.equal(m.paid_through,paidThrough);assert.equal(policy.membershipAccessible(m),false);
 await service.settleMembershipInvoice(originalInvoice);
 assert.equal((await member()).state,'payment_failed','Old zero invoice cannot revive failed access');
 console.log('SANDBOX PASS: real failed renewal denied access, did not create a receipt, and resisted old trial invoice replay.');

 stage='cancellation';
 sub=await stripe.subscriptions.cancel(subscriptionId,{invoice_now:false,prorate:false});
 assert(!sub.livemode&&sub.status==='canceled','Synthetic subscription cancellation');
 await service.syncMembershipSubscription(await subscription());
 await service.settleMembershipInvoice(originalInvoice);
 await service.settleMembershipInvoice(paidInvoice);
 m=await member();assert.equal(m.state,'cancelled');assert.equal(policy.membershipAccessible(m),false);assert.equal(m.paid_through,paidThrough);
 const finalReceipts=await database(`icash_membership_invoices?membership_id=eq.${membershipId}&select=stripe_invoice_id,amount_cents`);
 assert.deepEqual(finalReceipts,receipts,'Failure/cancellation must not fabricate receipts');
 console.log('SANDBOX PASS: real cancellation denied access; delayed paid/zero events did not revive it. No live objects, accounts, mail, credits, or AI work used.');
}catch(error){
 console.error('SANDBOX FAILED at '+stage+': '+String(error.message).replace(/(?:sk|rk|whsec)_[A-Za-z0-9_]+/g,'[redacted]').slice(0,400));
 process.exitCode=1;
}finally{delete globalThis.__legacySandboxDependencies;}
