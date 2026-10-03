import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
if(process.env.ACTIVATION_TEST_LOCAL!=='1')throw Error('Isolated local test opt-in required');
const require=createRequire(import.meta.url),{Client,types}=require(process.env.PG_MODULE||'/tmp/icash-pg-review/root/usr/share/nodejs/pg');types.setTypeParser(20,Number);
const connection={host:'127.0.0.1',port:Number(process.env.ACTIVATION_TEST_PORT||55447),user:'agent',database:'postgres'};
const db=new Client(connection),a=new Client(connection),b=new Client(connection);await Promise.all([db.connect(),a.connect(),b.connect()]);
const pg={query:(...args)=>db.query(...args),exec:s=>db.query(s),close:async()=>{await Promise.all([db.end(),a.end(),b.end()]);}};
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
await pg.exec('grant select on icash_accounts,icash_wallets,icash_spend_activations,icash_operating_budget,icash_billing_reviews,icash_operation_spend,icash_credit_reservations,icash_funding_orders,icash_credit_ledger to service_role;grant update on icash_accounts,icash_wallets to service_role;grant insert on icash_spend_activations to service_role;');
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
 // Native separate-session wallet race: confirmation waits for the real lock,
 // then must reject the stale pre-change quote rather than activate it.
 r=await review();await a.query('begin');await a.query('select * from icash_wallets where account_id=$1 for update',[account]);
 const raced=b.query('select icash_confirm_spend_activation($1,$2,$3,$4,true)',[owner,account,r.reviewKey,'activation-2026-10-03.1']).then(()=>({ok:true}),e=>({error:e.message}));
 await new Promise(resolve=>setTimeout(resolve,100));
 assert((await db.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[b.processID])).rows.length,'confirmation must be waiting on wallet lock');
 await a.query('update icash_wallets set balance_cents=1100;update icash_funding_orders set credit_cents=1100;update icash_credit_ledger set delta_cents=1100;');await a.query('commit');assert.match((await raced).error,/changed/);
 assert.equal((await q('select count(*) n from icash_spend_activations')).rows[0].n,0);
 await pg.exec('update icash_wallets set balance_cents=1000;update icash_funding_orders set credit_cents=1000;update icash_credit_ledger set delta_cents=1000;');
 // Two independent sessions accept the same quote concurrently. One insert;
 // the waiting retry reads the original receipt without expanding its cap.
 r=await review();await a.query('begin');await a.query('set local role service_role');await b.query('set role service_role');const first=(await a.query('select icash_confirm_spend_activation($1,$2,$3,$4,true) q',[owner,account,r.reviewKey,'activation-2026-10-03.1'])).rows[0].q;
 const second=b.query('select icash_confirm_spend_activation($1,$2,$3,$4,true) q',[owner,account,r.reviewKey,'activation-2026-10-03.1']);
 await new Promise(resolve=>setTimeout(resolve,100));assert((await db.query("select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock'",[b.processID])).rows.length);await a.query('commit');
 assert.equal(first.alreadySaved,false);assert.equal((await second).rows[0].q.alreadySaved,true);await b.query('reset role');
 assert.deepEqual(await confirm(r.reviewKey),{saved:true,alreadySaved:true,started:false});
 assert.equal((await review()).reason,'existing_activation_preserved');
 assert.equal((await q('select count(*) n from icash_spend_activation_receipts')).rows[0].n,1);
 assert.equal((await q('select bot_paused from icash_accounts')).rows[0].bot_paused,true);
 assert.equal((await q('select balance_cents from icash_wallets')).rows[0].balance_cents,1000);
 await q('update icash_spend_activations set enabled=false');await assert.rejects(()=>confirm(r.reviewKey),/preserved/);assert.equal((await review()).available,false);
 assert.equal((await q("select has_function_privilege('anon','icash_confirm_spend_activation(uuid,uuid,text,text,boolean)','execute') ok")).rows[0].ok,false);
 assert.equal((await q("select has_function_privilege('authenticated','icash_spend_activation_review(uuid,uuid)','execute') ok")).rows[0].ok,false);
 await db.query('set role anon');await assert.rejects(()=>db.query('select icash_spend_activation_review($1,$2)',[owner,account]),/permission denied/);await db.query('reset role');
 await db.query('set role authenticated');await assert.rejects(()=>db.query('select * from icash_spend_activation_receipts'),/permission denied/);await db.query('reset role');
 console.log('PASS native two-session PostgreSQL activation (wallet lock race, concurrent confirmation, rollback): ownership, consent, stale review, paid-only cap, budget/hold/review blocks, ceiling, idempotency, existing cap/disable preservation, unchanged pause/wallet, service-only grants.');
}finally{await pg.close();}
