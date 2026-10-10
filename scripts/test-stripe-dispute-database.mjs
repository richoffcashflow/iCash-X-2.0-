import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const {PGlite}=await import(process.argv[2]??'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table icash_accounts(id uuid primary key,owner_user_id uuid,billing_model text default 'membership_credits',bot_paused boolean default true,daily_limit_cents bigint);
create table icash_membership_offer(id int primary key,price_cents bigint,revision int,enabled boolean);
create table icash_memberships(id uuid primary key default gen_random_uuid(),guest_hash text,account_id uuid,mode text,price_cents bigint,offer_revision int,state text default 'pending',stripe_session_id text,consent_version text,consent_text text);
create table icash_funding_orders(id uuid primary key,mode text,state text,account_id uuid,guest_hash text,price_cents bigint,credit_cents bigint,auto_recharge boolean,credited_at timestamptz,prepaid_applied_at timestamptz,pacing_applied_at timestamptz,daily_plan_id uuid,billing_period_start timestamptz,paid_at timestamptz,created_at timestamptz default now());
create table icash_funding_consents(order_id uuid,version text,price_cents bigint,credit_cents bigint,account_id uuid);
create table icash_daily_plans(id uuid primary key,account_id uuid,guest_hash text,mode text,state text,created_at timestamptz default now(),consent_version text,activated_at timestamptz);
create table icash_daily_quotes(id uuid primary key,plan_id uuid,budget_cents bigint,fee_cents bigint,consent_text text);
create table icash_plan_changes(id uuid primary key,membership_id uuid,account_id uuid,action text,state text);
create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
create table icash_wallets(account_id uuid primary key,balance_cents bigint,reserved_cents bigint);
create table icash_credit_ledger(account_id uuid,kind text,delta_cents bigint,created_at timestamptz);
create table icash_spend_activations(account_id uuid primary key,enabled boolean,customer_cap_cents bigint);
create table icash_auto_recharges(account_id uuid,mode text,enabled boolean,approved_order uuid,pending_order uuid,amount_cents bigint,stripe_customer_id text,stripe_payment_method_id text,issue text,updated_at timestamptz);
create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
create function icash_authorized_grant_cents(uuid) returns bigint language sql as $$select 0::bigint$$;
create function icash_credit_work_pace(bigint) returns bigint language sql as $$select $1/2$$;
grant select,insert,update on all tables in schema public to service_role;
`);
await db.exec(readFileSync(new URL('../tests/fixtures/dispute-billing-baseline.sql',import.meta.url),'utf8'));
const migration=readFileSync(new URL('../config/stripe-dispute-protection.sql',import.meta.url),'utf8');
assert.equal(migration,readFileSync(new URL('../supabase/migrations/20261010024323_stripe_dispute_protection.sql',import.meta.url),'utf8'));
await db.exec(migration);
await db.exec(readFileSync(new URL('../supabase/migrations/20261010030300_stripe_live_dispute_ids.sql',import.meta.url),'utf8'));
await db.exec('set role service_role');
for(const prefix of ['dp','du']){
 const event={eventId:'evt_'+prefix,disputeId:prefix+'_fixture',mode:'live',chargeId:'ch_fixture',paymentId:'pi_fixture',eventType:'charge.dispute.updated',status:'needs_response',reason:'fraudulent',amountCents:1000,currency:'usd',createdAt:'2026-10-10T00:00:00Z'};
 await db.query('select icash_record_dispute_event($1)',[event]);await db.query('select icash_record_dispute_event($1)',[event]);
}
assert.equal((await db.query('select count(*)::int as count from icash_dispute_events')).rows[0].count,2);
await db.exec('reset role');
const account='00000000-0000-4000-8000-000000000001',user='00000000-0000-4000-8000-000000000002',order='00000000-0000-4000-8000-000000000003',guest='a'.repeat(64),terms='Reviewed full final-sale purchase terms.';
await db.query(`insert into icash_accounts(id,owner_user_id) values($1,$2);`,[account,user]);
await db.exec(`insert into icash_membership_offer values(1,5000,1,true)`);
const member=(await db.query(`select * from icash_begin_membership_v2($1,$2,'live',5000,1,$3,'membership-2026-10-10.1')`,[guest,account,terms])).rows[0];assert.equal(member.consent_version,'membership-2026-10-10.1');
await db.query(`insert into icash_funding_orders(id,account_id,guest_hash,mode,state,price_cents,credit_cents,auto_recharge) values($1,$2,$3,'live','pending',2500,2500,true)`,[order,account,guest]);
const receipt=(patch={})=>{const v={kind:'credits',id:order,mode:'live',account,guest,version:'work-credits-2026-10-10.1',terms,amount:2500,policyVersion:'final-sales-2026-10-10.1',policy:terms,context:{ip:null},...patch};return db.query(`select icash_record_purchase_acceptance($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,Object.values(v));};
await receipt();const first=(await db.query('select * from icash_purchase_acceptances')).rows[0];await receipt();assert.equal((await db.query('select * from icash_purchase_acceptances')).rows.length,1);assert.equal(String((await db.query('select * from icash_purchase_acceptances')).rows[0].accepted_at),String(first.accepted_at));
for(const patch of [{amount:1},{account:user},{mode:'test'},{guest:'b'.repeat(64)},{terms:terms+' rewritten'},{policy:terms+' rewritten'}])await assert.rejects(receipt(patch));
await receipt({kind:'membership',id:member.id,amount:5000,version:'membership-2026-10-10.1'});
await db.query(`select icash_record_software_access($1,$2,'{}')`,[account,user]);await db.query(`select icash_record_software_access($1,$2,'{}')`,[account,user]);assert.equal((await db.query('select * from icash_software_access_receipts')).rows.length,1);await assert.rejects(db.query(`select icash_record_software_access($1,$2,'{}')`,[account,order]));
for(const role of ['anon','authenticated']){await db.exec('set role '+role);for(const table of ['icash_purchase_acceptances','icash_software_access_receipts','icash_dispute_events'])await assert.rejects(db.query('select * from '+table));await assert.rejects(receipt());await db.exec('reset role');}
await db.exec('set role service_role');await assert.rejects(db.query('update icash_purchase_acceptances set terms_text=$1',[terms+' changed']));await assert.rejects(db.query('delete from icash_purchase_acceptances'));await db.exec('reset role');
await db.query(`insert into icash_wallets values($1,2500,0);`,[account]);
await db.query(`insert into icash_auto_recharges(account_id,mode,pending_order,enabled) values($1,'live',$2,false)`,[account,order]);
await db.query(`update icash_funding_orders set state='paid',credited_at=now() where id=$1`,[order]);
for(const version of ['work-credits-2026-10-07.1','work-credits-2026-10-07.1:recharge-2026-10-06.1','work-credits-2026-10-10.1','work-credits-2026-10-10.1:recharge-2026-10-10.1']){
 await db.exec('delete from icash_funding_consents;update icash_funding_orders set prepaid_applied_at=null');await db.query(`insert into icash_funding_consents values($1,$2,2500,2500,$3)`,[order,version,account]);assert.equal((await db.query('select icash_apply_prepaid_purchase($1) as ok',[order])).rows[0].ok,true);
 if(version.includes('recharge')){await db.query('update icash_auto_recharges set pending_order=$1,enabled=false',[order]);await db.query(`select icash_activate_auto_recharge($1,'cus_fixture','pm_fixture')`,[order]);assert.equal((await db.query('select enabled from icash_auto_recharges')).rows[0].enabled,true);}
}
await db.exec("update icash_funding_consents set version='made-up';update icash_funding_orders set prepaid_applied_at=null");assert.equal((await db.query('select icash_apply_prepaid_purchase($1) as ok',[order])).rows[0].ok,false);await assert.rejects(db.query(`select icash_activate_auto_recharge($1,'cus_fixture','pm_fixture')`,[order]));
await db.exec("update icash_funding_consents set version='work-credits-2026-10-10.1'");await db.query('insert into icash_billing_reviews(account_id) values($1)',[account]);assert.equal((await db.query('select icash_apply_prepaid_purchase($1) as ok',[order])).rows[0].ok,false);
console.log('PASS durable acceptance: exact binding, immutable retries, private grants, hourly authenticated access, current/previous credit and recharge versions, fabricated consent rejection, existing billing hold.');await db.close();
