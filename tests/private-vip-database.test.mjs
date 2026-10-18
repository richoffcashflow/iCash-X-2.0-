import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {privateVipFixture} from './helpers/private-vip-fixture.mjs';
import {privateVipVersion,privateVipTerms} from '../lib/private-vip-policy.ts';
const f=await privateVipFixture();try{
 const {pg,rpc,account,membership,current}=f;
 const args={p_membership:membership,p_account:account,p_mode:'live'};
 const v=await rpc('icash_begin_private_vip',args);assert.equal((await rpc('icash_begin_private_vip',args)).id,v.id);
 await assert.rejects(rpc('icash_begin_private_vip',{...args,p_account:membership}));await assert.rejects(rpc('icash_begin_private_vip',{...args,p_mode:'test'}));
 assert.equal((await current()).vip_until,null);assert.equal((await current()).price_cents,0);
 await rpc('icash_record_purchase_acceptance',{p_kind:'vip',p_reference:v.id,p_mode:'live',p_account:account,p_guest:'fixture',p_version:privateVipVersion,p_terms:privateVipTerms,p_amount:5000,p_policy_version:'fixture',p_policy:'fixture',p_context:{}});
 await pg.query("update icash_private_vip_subscriptions set state='active',subscription_id='sub_fixture',customer_id='cus_fixture' where id=$1",[v.id]);assert.equal((await current()).vip_until,null,'A subscription without payment cannot grant VIP');
 const start=new Date(Date.now()-1000).toISOString(),end=new Date(Date.now()+30*86400000).toISOString();
 const invoice={p_id:v.id,p_subscription:'sub_fixture',p_customer:'cus_fixture',p_invoice:'in_fixture',p_payment:'pi_fixture',p_start:start,p_end:end};
 await rpc('icash_settle_private_vip',invoice);await rpc('icash_settle_private_vip',invoice);assert.equal((await pg.query('select count(*) from icash_private_vip_invoices')).rows[0].count,1);
 let m=await current();assert.equal(Date.parse(m.vip_until),Date.parse(end));assert.equal(m.price_cents,0);assert.equal(m.stripe_subscription_id,null);assert.equal(m.state,'active');assert(Date.parse(m.paid_through)>Date.parse('9999-01-01'));
 await assert.rejects(rpc('icash_settle_private_vip',{...invoice,p_payment:'pi_other'}));await assert.rejects(rpc('icash_settle_private_vip',{...invoice,p_subscription:'sub_other'}));
 await pg.query('update icash_private_vip_subscriptions set cancel_at_period_end=true where id=$1',[v.id]);assert.equal(Date.parse((await current()).vip_until),Date.parse(end),'Cancelling renewal preserves the paid period');
 await rpc('icash_flag_private_vip_issue',{p_payment:'pi_fixture'});m=await current();assert.equal(m.vip_until,null);assert.equal(m.state,'active');assert.equal(m.price_cents,0,'Refund review never removes the free baseline');
 await assert.rejects(rpc('icash_settle_private_vip',{...invoice,p_invoice:'in_new',p_payment:'pi_new'}));await rpc('icash_settle_private_vip',invoice);assert.equal((await current()).vip_until,null,'Old invoice replay cannot lift review');
 // Refund/dispute arriving before the payment confirmation must also prevent access.
 await pg.query("update icash_private_vip_subscriptions set state='active',paid_until=null where id=$1",[v.id]);
 await pg.query("insert into icash_billing_reviews values('pi_early',null)");
 await rpc('icash_settle_private_vip',{...invoice,p_invoice:'in_early',p_payment:'pi_early'});
 assert.equal((await current()).vip_until,null);assert.equal((await current()).state,'active');
 for(const role of ['anon','authenticated']){await pg.exec('reset role;set role '+role);await assert.rejects(pg.query('select * from icash_private_vip_subscriptions'),/permission denied/);await assert.rejects(pg.query('select icash_begin_private_vip($1,$2,$3)',[membership,account,'live']),/permission denied/);}
 assert.equal(readFileSync(new URL('../config/free-standard-vip-subscription.sql',import.meta.url),'utf8'),readFileSync(new URL('../supabase/migrations/20261018211643_free_standard_vip_subscription.sql',import.meta.url),'utf8'));
 console.log('PASS free Standard VIP database: account/mode binding, duplicate checkout claim, payment-only expiry, immutable invoices, refund holds and private permissions.');
}finally{await f.pg.close();}
