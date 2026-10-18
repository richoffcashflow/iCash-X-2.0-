import assert from 'node:assert/strict';
import {z} from 'zod';
import {privateVipFixture} from './helpers/private-vip-fixture.mjs';
import {loadService} from './helpers/simulated-journey-services.mjs';
import * as policy from '../lib/private-vip-policy.ts';
import {membershipAccessible} from '../lib/membership-policy.ts';
import {vipActive} from '../lib/vip-policy.ts';
const f=await privateVipFixture();try{
 let calls=[],session,sub,invoice,pi,lines,payments,failSave=false;
 const created=new Map();
 const stripe={customers:{create:async(body,options)=>{calls.push(['customer',body,options]);return {id:'cus_fixture',livemode:true};}},checkout:{sessions:{retrieve:async()=>session,create:async(body,options)=>{
 calls.push(['checkout',body,options]);if(created.has(options.idempotencyKey))return created.get(options.idempotencyKey);
 session={id:'cs_live_fixture',customer:body.customer,mode:body.mode,livemode:true,amount_total:5000,amount_subtotal:5000,currency:'usd',metadata:body.metadata,status:'open',payment_status:'unpaid',url:'https://checkout.stripe.com/fixture',subscription:null,total_details:{amount_discount:0,amount_tax:0}};created.set(options.idempotencyKey,session);return session;
 }}},subscriptions:{retrieve:async()=>sub,update:async(id,body)=>{calls.push(['subscription-update',body]);assert.equal(id,sub.id);Object.assign(sub,body);return sub;}},invoices:{retrieve:async()=>invoice,listLineItems:async()=>lines,list:async()=>({data:invoice?.status==='paid'?[invoice]:[]})},invoicePayments:{list:async()=>payments},paymentIntents:{retrieve:async()=>pi}};
 const request=new Request('https://www.geticashx.com/api/billing/private-vip');
 const db=async(path,method,body)=>{if(failSave&&method==='PATCH'&&body.session_id){failSave=false;throw Error('Lost checkout save');}return f.db(path,method,body);};
 const recordPurchaseAcceptance=async(req,r)=>{assert.equal(req,request);await f.rpc('icash_record_purchase_acceptance',{p_kind:r.kind,p_reference:r.reference,p_mode:r.mode,p_account:r.accountId,p_guest:r.guestHash,p_version:r.version,p_terms:r.terms,p_amount:r.amountCents,p_policy_version:'fixture',p_policy:'fixture',p_context:{}});};
 const deps={...policy,db,fundingStripe:()=>stripe,fundingMode:()=> 'live',membershipAccessible,recordPurchaseAcceptance,bindCheckoutMeasurement:async()=>{}};
 const api=await loadService('lib/private-vip.ts',deps);let m=await f.current();
 await assert.rejects(api.changePrivateVip({...m,private_invite_id:null},'upgrade','https://www.geticashx.com',request));
 failSave=true;await assert.rejects(api.changePrivateVip(m,'upgrade','https://www.geticashx.com',request),/Lost checkout save/);
 await api.changePrivateVip(m,'upgrade','https://www.geticashx.com',request);assert.equal(created.size,1,'Lost response reuses the exact checkout operation');
 const first=calls.find(c=>c[0]==='checkout')[1];assert.equal(first.mode,'subscription');assert.equal(first.line_items[0].price_data.recurring.interval,'month');assert.equal(first.line_items[0].price_data.unit_amount,5000);assert.equal(first.payment_method_types,undefined);assert.match(first.custom_text.submit.message,/then \$50 per month/);assert(!vipActive(await f.current()));
 const count=calls.filter(c=>c[0]==='checkout').length;await api.changePrivateVip(m,'upgrade','https://www.geticashx.com',request);assert.equal(calls.filter(c=>c[0]==='checkout').length,count);assert(!vipActive(await f.current()));
 const start=Math.floor(Date.now()/1000)-15*86400,end=start+30*86400;
 sub={id:'sub_fixture',customer:'cus_fixture',status:'active',livemode:true,metadata:{icash_private_vip:session.metadata.icash_private_vip},cancel_at_period_end:false,discounts:[],schedule:null,pending_update:null,latest_invoice:'in_fixture',items:{has_more:false,data:[{quantity:1,current_period_end:end,discounts:[],price:{id:'price_fixture',currency:'usd',unit_amount:5000,billing_scheme:'per_unit',transform_quantity:null,recurring:{interval:'month',interval_count:1,usage_type:'licensed'}}}]}};
 invoice={id:'in_fixture',parent:{subscription_details:{subscription:sub.id}},customer:'cus_fixture',status:'paid',livemode:true,currency:'usd',amount_remaining:0,amount_paid:5000,total:5000,subtotal:5000,total_discount_amounts:[],total_taxes:[]};
 lines={has_more:false,data:[{quantity:1,amount:5000,pricing:{price_details:{price:'price_fixture'}},period:{start,end}}]};payments={has_more:false,data:[{payment:{payment_intent:'pi_fixture'}}]};pi={id:'pi_fixture',customer:'cus_fixture',status:'succeeded',livemode:true,amount_received:5000,currency:'usd'};
 session.status='complete';session.payment_status='paid';session.subscription=sub.id;
 for(const [obj,key,bad] of [[session,'customer','cus_other'],[session,'amount_total',10000],[sub.items.data[0].price,'unit_amount',10000],[pi,'status','processing'],[pi,'customer','cus_other'],[invoice,'amount_paid',0],[sub,'livemode',false]]){const old=obj[key];obj[key]=bad;await assert.rejects(api.reconcilePrivateVipCheckout(session.id));obj[key]=old;assert(!vipActive(await f.current()),key+' cannot grant VIP');}
 await api.reconcilePrivateVipCheckout(session.id);m=await f.current();assert(vipActive(m));assert.equal(m.price_cents,0);assert.equal(m.stripe_subscription_id,null);assert(membershipAccessible(m));
 await api.reconcilePrivateVipCheckout(session.id);assert.equal((await f.pg.query('select count(*) from icash_private_vip_invoices')).rows[0].count,1);
 await assert.rejects(api.changePrivateVip(m,'upgrade','https://www.geticashx.com',request),/already exists/);assert.equal(calls.filter(c=>c[0]==='checkout').length,count);
 await api.changePrivateVip(m,'downgrade','https://www.geticashx.com',request);assert(sub.cancel_at_period_end);assert(vipActive(await f.current()));assert(membershipAccessible(await f.current()));assert.equal(calls.at(-1)[1].proration_behavior,'none');
 await api.changePrivateVip(m,'keep_vip','https://www.geticashx.com',request);assert.equal(sub.cancel_at_period_end,false);assert.equal(sub.items.data[0].price.unit_amount,5000);
 // A renewal's real invoice extends VIP, never the free membership or price.
 invoice.id='in_renewal';sub.latest_invoice=invoice.id;payments.data[0].payment.payment_intent='pi_renewal';pi.id='pi_renewal';const renewalStart=Math.floor(Date.now()/1000)-1,renewalEnd=renewalStart+30*86400;lines.data[0].period={start:renewalStart,end:renewalEnd};await api.settlePrivateVipInvoice(invoice.id);assert.equal(Date.parse((await f.current()).vip_until),renewalEnd*1000,'Verified monthly payment extends VIP');assert.equal((await f.current()).price_cents,0);
 await f.rpc('icash_flag_private_vip_issue',{p_payment:'pi_fixture'});await api.syncPrivateVip(sub);assert(!vipActive(await f.current()));assert(membershipAccessible(await f.current()));
 await api.reconcilePrivateVipCheckout(session.id);assert(!vipActive(await f.current()),'Replayed invoices and stale subscription reads cannot lift a review hold');
 console.log('PASS free Standard VIP service: $50 recurring checkout, no grant before verified payment, safe retries, exact customer/amount/mode, cancellation and immutable receipts. No provider calls.');
 // Route enforces account ownership, origin and the dedicated recurring acceptance.
 let origin=true,authorized=true,actionCalls=0;const route=await loadService('app/api/billing/private-vip/route.ts',{z,NextResponse:{json:Response.json},allowedOrigin:()=>origin,workAccount:async()=>{if(!authorized)throw Error('SIGN_IN_REQUIRED');return {accountId:f.account};},accountMembership:async()=>m,limitRequest:async()=>{},changePrivateVip:async()=>{actionCalls++;return {url:'https://checkout.stripe.com/fixture'};},privateVipVersion:policy.privateVipVersion});
 const post=body=>route.POST(new Request(request.url,{method:'POST',headers:{origin:'https://www.geticashx.com'},body:JSON.stringify(body)}));
 const body={action:'upgrade',accepted:true,version:policy.privateVipVersion};assert.equal((await post(body)).status,200);assert.equal(actionCalls,1);
 for(const invalid of [{...body,accepted:false},{...body,version:'vip-2026-10-10.2'},{...body,accountId:'other'}])assert.equal((await post(invalid)).status,409);
 origin=false;assert.equal((await post(body)).status,403);origin=true;authorized=false;assert.equal((await post(body)).status,409);assert.equal(actionCalls,1);
 console.log('PASS free VIP route: explicit monthly terms, no caller-supplied account, authenticated ownership and origin protection.');
}finally{await f.pg.close();}
