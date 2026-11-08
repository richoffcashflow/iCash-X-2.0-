import assert from 'node:assert/strict';
import {recoveryFixture,seedRecovery,read} from './helpers/paid-term-recovery-fixture.mjs';
import {membershipAccessible} from '../lib/membership-policy.ts';
import {vipActive} from '../lib/vip-policy.ts';
const {pg}=await recoveryFixture();
try{
 const c=await seedRecovery(pg),before=(await pg.query('select to_jsonb(m) as m from icash_memberships m where id=$1',[c.source])).rows[0].m;
 await pg.exec('set role service_role');
 const m=await c.restore();assert.equal((await c.restore()).id,m.id);
 assert.equal(m.account_id,c.account);assert.equal(m.post_purchase_webinar_id,before.post_purchase_webinar_id);assert.equal(m.consent_version,'paid-term-recovery-v1');assert.equal(m.cancel_at_period_end,true);
 assert(membershipAccessible(m));assert(vipActive(m));assert(!membershipAccessible(m,Date.parse(c.end)));assert(!vipActive(m,Date.parse(c.end)));
 for(const k of ['stripe_session_id','stripe_subscription_id','stripe_customer_id','private_invite_id','legacy_trial_offer','payer_email','payer_phone','checkout_email'])assert.equal(m[k],null,k);
 assert.deepEqual((await pg.query('select to_jsonb(m) as m from icash_memberships m where id=$1',[c.source])).rows[0].m,before);
 assert.equal((await pg.query('select bot_paused from icash_accounts where id=$1',[c.account])).rows[0].bot_paused,true);
 assert.equal((await pg.query('select count(*) from icash_membership_invoices')).rows[0].count,1);
 assert.equal((await pg.query('select count(*) from icash_paid_term_recoveries')).rows[0].count,1);
 for(const [column,value] of [['paid_through',new Date(Date.parse(c.end)+1e6).toISOString()],['vip_until',new Date(Date.parse(c.end)+1e6).toISOString()],['stripe_subscription_id','sub_new'],['account_id',c.owner],['consent_version','ordinary']])await assert.rejects(pg.query(`update icash_memberships set ${column}=$1 where id=$2`,[value,m.id]),/immutable/);
 await assert.rejects(c.restore([...c.args.slice(0,6),'Different authorization for an earlier recovery']),/replay mismatch/);
 await assert.rejects(pg.query('update icash_paid_term_recoveries set ends_at=now()+interval \'40 days\''),/permission denied|immutable/);
 await pg.query('select icash_request_membership_cancellation($1,$2,$3)',[m.id,c.account,'live']);
 assert.equal((await pg.query('select state from icash_memberships where id=$1',[m.id])).rows[0].state,'cancel_requested');
 await pg.query("update icash_memberships set state='cancelled' where id=$1",[m.id]);assert.equal((await c.restore()).state,'cancelled');
 await assert.rejects(pg.query("update icash_memberships set state='active' where id=$1",[m.id]),/immutable/);
 const held=await seedRecovery(pg,2);await pg.query('insert into icash_billing_reviews(payment_id,resolved_at) values($1,null)',[held.vipPayment]);await assert.rejects(held.restore(),/Verified original payments/);
 const notPaused=await seedRecovery(pg,3);await pg.query('update icash_accounts set bot_paused=false where id=$1',[notPaused.account]);await assert.rejects(notPaused.restore(),/Paused account/);
 const wrong=await seedRecovery(pg,4);await assert.rejects(wrong.restore([wrong.account,wrong.source,wrong.invoice,wrong.upgrade,c.support,wrong.end,wrong.args[6]]),/Account-bound support/);
 await assert.rejects(wrong.restore([wrong.account,c.source,wrong.invoice,wrong.upgrade,wrong.support,wrong.end,wrong.args[6]]),/Original paid VIP/);
 await assert.rejects(wrong.restore([...wrong.args.slice(0,5),new Date(Date.parse(wrong.end)+1000).toISOString(),wrong.args[6]]),/Original paid VIP/);
 const review=await seedRecovery(pg,5),rm=await review.restore();await pg.query('insert into icash_billing_reviews(payment_id,resolved_at) values($1,null)',[review.payment]);assert.equal((await pg.query('select state from icash_memberships where id=$1',[rm.id])).rows[0].state,'needs_review');
 await pg.query('update icash_billing_reviews set resolved_at=now() where payment_id=$1',[review.payment]);assert.equal((await review.restore()).state,'needs_review','Resolving a financial review never auto-reactivates a recovery');
 const expired=await seedRecovery(pg,6,-1);await assert.rejects(expired.restore(),/remaining original term/);
 for(const role of ['anon','authenticated']){await pg.exec('reset role;set role '+role);await assert.rejects(pg.query('select * from icash_paid_term_recoveries'),/permission denied/);await assert.rejects(c.restore(),/permission denied/);}
 console.log('PASS paid-term recovery: exact original paid term/account/case, idempotency, immutable source and expiry, no Stripe linkage/charge/credit/resume, review suspension and private ACL.');
}finally{await pg.close();}
