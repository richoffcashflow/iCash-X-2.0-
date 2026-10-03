import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);const pg=await PGlite.create();
const account='00000000-0000-0000-0000-000000000001',owner='00000000-0000-0000-0000-000000000002',other='00000000-0000-0000-0000-000000000003';
await pg.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean,daily_limit_cents bigint);
create table icash_wallets(account_id uuid primary key,balance_cents bigint,reserved_cents bigint,currency text);
create table icash_spend_activations(account_id uuid primary key references icash_accounts(id),enabled boolean,customer_cap_cents bigint check(customer_cap_cents between 1 and 100000));
create table icash_operating_budget(id int,enabled boolean,require_company_reserve boolean);
create table icash_billing_reviews(account_id uuid,resolved_at timestamptz);
create table icash_operation_spend(account_id uuid);create table icash_credit_reservations(account_id uuid);
create table icash_funding_orders(account_id uuid,mode text,state text,credited_at timestamptz,credit_cents bigint,id uuid default '00000000-0000-0000-0000-000000000004',stripe_invoice_id text,stripe_payment_id text default 'pi_fixture');
create table icash_credit_ledger(account_id uuid,event_key text unique,kind text,delta_cents bigint,evidence_ref text);
insert into icash_accounts values('${account}','${owner}',true,300);
insert into icash_wallets values('${account}',1000,0,'USD');insert into icash_operating_budget values(1,true,false);
insert into icash_funding_orders(account_id,mode,state,credited_at,credit_cents) values('${account}','live','paid',now(),1000);
insert into icash_credit_ledger values('${account}','stripe-funding:00000000-0000-0000-0000-000000000004','purchase',1000,'pi_fixture');`);
await pg.exec(readFileSync(new URL('../config/customer-spend-activation.sql',import.meta.url),'utf8'));
const q=async(sql,params=[])=>pg.query(sql,params);
const review=async(user=owner)=>(await q('select icash_spend_activation_review($1,$2) q',[user,account])).rows[0].q;
const confirm=async(key,accepted=true,user=owner)=>(await q('select icash_confirm_spend_activation($1,$2,$3,$4,$5) q',[user,account,key,'activation-2026-10-03.1',accepted])).rows[0].q;
try{
 await assert.rejects(()=>review(other),/ownership/);
 let r=await review();assert.equal(r.available,true);assert.equal(r.customerCapCents,1000);assert.equal(r.dailyLimitCents,300);
 await assert.rejects(()=>confirm(r.reviewKey,false),/acceptance/);await assert.rejects(()=>confirm(r.reviewKey,true,other),/ownership/);
 await q('update icash_accounts set daily_limit_cents=200');await assert.rejects(()=>confirm(r.reviewKey),/changed/);await q('update icash_accounts set daily_limit_cents=300');
 for(const [change,undo,reason] of [
 ['update icash_wallets set reserved_cents=1','update icash_wallets set reserved_cents=0','unreserved_paid_credits_required'],
 ['update icash_funding_orders set mode=\'test\'','update icash_funding_orders set mode=\'live\'','paid_credit_review_required'],
 ['update icash_wallets set balance_cents=1001','update icash_wallets set balance_cents=1000','paid_credit_review_required'],
 ['update icash_accounts set bot_paused=false','update icash_accounts set bot_paused=true','paused_funded_budget_required'],
 [`insert into icash_billing_reviews values('${account}',null)`,'delete from icash_billing_reviews','billing_review_required'],
 [`insert into icash_operation_spend values('${account}')`,'delete from icash_operation_spend','existing_work_requires_review'],
 [`insert into icash_credit_reservations values('${account}')`,'delete from icash_credit_reservations','existing_work_requires_review'],
 ["update icash_credit_ledger set kind='grant'","update icash_credit_ledger set kind='purchase'",'paid_credit_review_required'],
 ['update icash_credit_ledger set delta_cents=999','update icash_credit_ledger set delta_cents=1000','paid_credit_review_required'],
 ["update icash_credit_ledger set evidence_ref='pi_other'","update icash_credit_ledger set evidence_ref='pi_fixture'",'paid_credit_review_required'],
 ['update icash_operating_budget set enabled=false','update icash_operating_budget set enabled=true','operating_setup_required'],
 ]){await q(change);assert.equal((await review()).reason,reason);await assert.rejects(()=>confirm(r.reviewKey),/changed/);await q(undo);}
 await q('update icash_wallets set balance_cents=150000');await q('update icash_funding_orders set credit_cents=150000');await q('update icash_credit_ledger set delta_cents=150000');assert.equal((await review()).customerCapCents,100000);await q('update icash_wallets set balance_cents=1000');await q('update icash_funding_orders set credit_cents=1000');await q('update icash_credit_ledger set delta_cents=1000');
 // A changed paid wallet between review and acceptance requires a fresh quote.
 r=await review();await pg.exec('update icash_wallets set balance_cents=1100;update icash_funding_orders set credit_cents=1100;update icash_credit_ledger set delta_cents=1100;');await assert.rejects(()=>confirm(r.reviewKey),/changed/);await pg.exec('update icash_wallets set balance_cents=1000;update icash_funding_orders set credit_cents=1000;update icash_credit_ledger set delta_cents=1000;');
 // Prove receipt-insert failure rolls activation insertion back atomically.
 await pg.exec("alter table icash_spend_activation_receipts add constraint fixture_reject check(customer_cap_cents<1);");r=await review();await assert.rejects(()=>confirm(r.reviewKey),/fixture_reject/);assert.equal((await q('select count(*) n from icash_spend_activations')).rows[0].n,0);await pg.exec('alter table icash_spend_activation_receipts drop constraint fixture_reject');
 // PGlite serializes requests in one backend; this checks duplicate async
 // submissions, not native multi-connection row-lock behavior.
 r=await review();const duplicate=await Promise.all([confirm(r.reviewKey),confirm(r.reviewKey)]);assert.equal(duplicate.filter(x=>x.alreadySaved===false).length,1);assert.equal(duplicate.filter(x=>x.alreadySaved===true).length,1);
 assert.deepEqual(await confirm(r.reviewKey),{saved:true,alreadySaved:true,started:false});
 assert.equal((await review()).reason,'existing_activation_preserved');
 assert.equal((await q('select count(*) n from icash_spend_activation_receipts')).rows[0].n,1);
 assert.equal((await q('select bot_paused from icash_accounts')).rows[0].bot_paused,true);
 assert.equal((await q('select balance_cents from icash_wallets')).rows[0].balance_cents,1000);
 await q('update icash_spend_activations set enabled=false');await assert.rejects(()=>confirm(r.reviewKey),/preserved/);assert.equal((await review()).available,false);
 assert.equal((await q("select has_function_privilege('anon','icash_confirm_spend_activation(uuid,uuid,text,text,boolean)','execute') ok")).rows[0].ok,false);
 assert.equal((await q("select has_function_privilege('authenticated','icash_spend_activation_review(uuid,uuid)','execute') ok")).rows[0].ok,false);
 console.log('PASS isolated PostgreSQL activation: ownership, consent, stale review, paid-only cap, budget/hold/review blocks, ceiling, idempotency, existing cap/disable preservation, unchanged pause/wallet, service-only grants.');
}finally{await pg.close();}
