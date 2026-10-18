import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {z} from 'zod';
import {databaseAdapter,loadService} from './helpers/simulated-journey-services.mjs';
import * as policy from '../lib/membership-policy.ts';
import * as vipPolicy from '../lib/vip-policy.ts';
import * as embedded from '../lib/embedded-checkout-policy.ts';

// Real query filtering/pagination reproduces cancelled history masking a paid
// purchase. Provider outages are isolated; this suite never contacts Stripe.
const pg=new PGlite(),{db,q}=databaseAdapter(pg),account=randomUUID(),owner=randomUUID(),paid=randomUUID(),foreign=randomUUID(),guest='a'.repeat(64);
try{
 await pg.exec(`create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_memberships(id uuid primary key,guest_hash text,account_id uuid,mode text,state text,paid_through timestamptz,stripe_session_id text,payer_email text,created_at timestamptz);
 `);
 await q('insert into icash_accounts values($1,$2)',[account,owner]);
 await q("insert into icash_memberships values($1,$2,null,'live','active','2099-01-01','cs_live_paid','paid@example.invalid','2026-01-01')",[paid,guest]);
 for(let n=1;n<=13;n++)await q("insert into icash_memberships values($1,$2,null,'live','cancelled','2099-01-01',$3,'paid@example.invalid',$4)",[randomUUID(),guest,'cs_live_cancelled'+n,`2026-02-${String(n).padStart(2,'0')}`]);
 await q("insert into icash_memberships values($1,$2,null,'live','active','2099-01-01','cs_live_foreign','other@example.invalid','2026-03-01')",[foreign,'b'.repeat(64)]);
 let user=null,reconciled=0,readinessFails=false,readinessReads=0,notified=[];
 const deps={...policy,...vipPolicy,...embedded,z,NextResponse:Response,retentionVersion:'retention-50-six-months-v1',
  cookies:async()=>({get:()=>({value:guest})}),currentUser:async()=>user,validGuest:()=>true,guestHash:()=>guest,fundingMode:()=> 'live',db,
  membershipOffer:async()=>({priceCents:5000,revision:1,interval:'month',enabled:true}),
  publicMembership:m=>m?{id:m.id,accessible:policy.membershipAccessible(m),state:m.state}:null,
  customerFundingReady:async()=>{readinessReads++;if(readinessFails)throw Error('New checkout unavailable');return true;},
  checkoutCustomerContext:async()=>{if(readinessFails)throw Error('Prefill unavailable');return {};},
  paidVipDestination:async()=>{if(readinessFails)throw Error('Video unavailable');return '/live/123456';},
  vipRetentionOffer:async()=>{if(readinessFails)throw Error('Offer unavailable');return null;},
  schedulePurchaseAccessEmail:id=>notified.push(id),
  reconcileMembershipCheckout:async m=>{reconciled++;assert.equal(m.id,paid);await q("update icash_memberships set state='active',paid_through='2099-01-01' where id=$1",[paid]);return (await db('icash_memberships?id=eq.'+paid))[0];}
 };
 const {GET}=await loadService('app/api/billing/membership/route.ts',deps);
 const get=async query=>{const response=await GET(new Request('https://example.invalid/api/billing/membership'+(query?'?'+query:'')));return {status:response.status,body:await response.json()};};
 for(const signedIn of [false,true]){
  user=signedIn?{id:owner,email:'paid@example.invalid'}:null;
  await q('update icash_memberships set account_id=$1 where guest_hash=$2',[signedIn?account:null,guest]);
  let result=await get();assert.equal(result.body.membership.id,paid,'Cancelled history never hides the current paid purchase');assert.equal(result.body.membership.accessible,true);
  result=await get('session_id=cs_live_paid');assert.equal(result.status,200);assert.equal(reconciled,0,'An already settled return opens without a Stripe round trip');
  readinessFails=true;result=await get('session_id=cs_live_paid');assert.equal(result.status,200);assert.equal(result.body.membership.accessible,true);assert.equal(result.body.ready,false);assert.equal(result.body.postPurchaseUrl,null);
  assert.equal(result.body.email,'paid@example.invalid','Verified or checkout-bound payment email remains available');
  readinessFails=false;
  result=await get('session_id=cs_live_foreign');assert.equal(result.status,404);assert.equal(result.body.membership,undefined,'A receipt from another browser/account reveals no purchase');
 }
 assert.equal(readinessReads,0,'Paid access does not wait for unrelated new-checkout readiness services');
 const membership=await loadService('lib/membership.ts',{...policy,db,fundingMode:()=> 'live'});
 assert.equal((await membership.accountMembership(account)).id,paid,'Work/billing APIs also choose the current membership before pagination');
 // Load the actual prior snapshot RPC with inert ancillary services, reproduce
 // its ten-record cutoff, then apply the production migration unchanged.
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 alter table icash_memberships add column payer_phone text;
 alter table icash_accounts add column billing_model text default 'membership_credits',add column assistant_name text,add column bot_paused boolean default true,add column daily_limit_cents bigint;
 create table icash_wallets(account_id uuid,balance_cents bigint,reserved_cents bigint);
 create table icash_bot_setups(account_id uuid,profile jsonb,stage integer);
 create table icash_customer_identities(account_id uuid,first_name text,last_name text,company_name text,principal text,voice_id text,voice_name text);
 create table icash_daily_plans(account_id uuid,mode text,state text);
 create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
 create table icash_live_conversations(account_id uuid,state text,created_at timestamptz);
 create table icash_screening_jobs(account_id uuid,state text);
 create function icash_claim_funding(uuid,text) returns uuid language sql as 'select id from public.icash_accounts where owner_user_id=$1';
 create function icash_apply_funding_pacing(uuid) returns void language sql as 'select';
 create function icash_daily_claim(uuid) returns void language sql as 'select';
 create function icash_claim_bot_setup(uuid) returns void language sql as 'select';
 create function icash_funding_account_totals(uuid,text) returns jsonb language sql as 'select jsonb_build_object(''creditCents'',0)';
 `);
 await q('insert into icash_wallets values($1,0,0)',[account]);
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 await pg.exec(read('supabase/migrations/20261006154725_fast_workspace_account_snapshot.sql'));
 const snapshot=async()=>(await q('select icash_load_workspace_account($1,$2) result',[owner,'live'])).rows[0].result;
 assert.equal((await snapshot()).account.membership.state,'cancelled','Reproduce paid access hidden after ten later cancellations');
 await pg.exec(read('supabase/migrations/20261018072723_prioritize_paid_workspace_access.sql'));
 const restored=await snapshot();assert.equal(restored.account.membership.state,'active');assert.equal(restored.account.balanceCents,0);assert.equal(restored.account.paused,true,'Access recovery does not start bot work');
 assert.equal((await q("select has_function_privilege('anon','icash_load_workspace_account(uuid,text)','execute') allowed")).rows[0].allowed,false,'Private snapshot grants stay private');
 await q("update icash_memberships set state='pending',paid_through=null where id=$1",[paid]);
 const pending=await get('session_id=cs_live_paid');assert.equal(reconciled,1,'A late webhook is recovered by canonical checkout verification');assert.equal(pending.body.membership.accessible,true);
 for(const state of ['needs_review','cancel_requested']){
  await q('update icash_memberships set state=$1 where id=$2',[state,paid]);const held=await get();assert.equal(held.body.membership.accessible,false);assert.equal(reconciled,1,'Existing billing holds are not bypassed');
 }
 await q("update icash_memberships set state='cancelled' where id=$1",[paid]);
 const cancelled=await get();assert.equal(cancelled.body.membership.accessible,false);assert.equal(cancelled.body.membership.state,'cancelled','Cancellation remains visible when there is no current entitlement');
 assert(notified.includes(paid));
 console.log('PASS paid webinar access: real database scope, cancelled-history pagination, durable paid return during provider/readiness failure, delayed settlement, and preserved account/billing boundaries.');
}finally{await pg.close();}
