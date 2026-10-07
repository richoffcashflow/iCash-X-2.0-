// Real funding/preflight function bodies, isolated Postgres; no provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const file=p=>readFileSync(p,'utf8'),q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>(await q(sql,args)).rows[0]?.value;
try{
 const base=JSON.parse(file('tests/fixtures/automatic-credits-baseline.json'));
 await pg.exec('create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);set check_function_bodies=off;');
 for(const t of base.tables)await pg.exec(t.definition.replace(/default icash_[a-z_]+\.clock_now\(\)/g,'default now()'));
 await pg.exec(base.functions.map(f=>f.definition).join(';\n')+';');
 await pg.exec(`create or replace function icash_membership_work_allowed(p_account uuid) returns boolean language sql as $$select true$$;
 create function icash_manual_contact_reason(uuid,uuid,text,text,uuid) returns text language sql as $$select null::text$$;
 create function icash_credit_work_pace(bigint) returns bigint language sql as $$select $1$$;
 create table icash_auto_recharge_attempts(id uuid primary key,account_id uuid,mode text,order_id uuid,approved_order uuid,amount_cents bigint,stripe_customer_id text,stripe_payment_method_id text,stripe_payment_id text,state text,lease_until timestamptz);
 create table if not exists icash_communication_prices(operation text primary key,customer_micros bigint);`);
 await pg.exec(file('tests/fixtures/manual-text-credit-functions.sql'));
 await pg.exec(file('supabase/migrations/20261007011632_manual_text_recovery_and_authorized_grants.sql'));
 const a=uuid(),other=uuid(),order=uuid(),grant=uuid(),unreviewed=uuid(),thread=uuid(),rate=uuid();
 await q("insert into icash_accounts(id,billing_model,bot_paused,daily_limit_cents) values($1,'prepaid',false,3000),($2,'prepaid',false,3000)",[a,other]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,2109,1107)',[a]);
 await q("insert into icash_credit_ledger(id,account_id,kind,delta_cents) values($1,$2,'grant',1000),($3,$2,'grant',45)",[grant,a,unreviewed]);
 await q("insert into icash_funding_orders(id,account_id,mode,state,price_cents,credit_cents,credited_at) values($1,$2,'live','paid',1300,1300,now())",[order,a]);
 await q("insert into icash_funding_consents(order_id,account_id,version,price_cents,credit_cents) values($1,$2,'work-credits-2026-10-06.1',1300,1300)",[order,a]);
 const apply=()=>v('select icash_apply_prepaid_purchase($1) value',[order]);
 assert.equal(await apply(),true);
 const cap=()=>v('select customer_cap_cents value from icash_spend_activations where account_id=$1',[a]);
 assert.equal(await cap(),1300,'unreviewed grants do not grant spending authority');
 await q('insert into icash_authorized_credit_grants(grant_id,authorization_ref) values($1,$2)',[grant,'Synthetic explicit approval']);
 assert.equal(await v('select icash_authorized_grant_cents($1) value',[a]),1000);
 assert.equal(await v('select icash_authorized_grant_cents($1) value',[other]),0,'approval cannot cross accounts');
 // Replay cannot restart a bot the customer subsequently paused.
 await q('update icash_accounts set bot_paused=true where id=$1',[a]);await apply();
 assert.equal(await v('select bot_paused value from icash_accounts where id=$1',[a]),true);
 // A new purchase retains approved grants and adds only verified paid credits.
 const next=uuid();await q("insert into icash_funding_orders(id,account_id,mode,state,price_cents,credit_cents,credited_at) values($1,$2,'live','paid',1000,1000,now())",[next,a]);
 await q("insert into icash_funding_consents(order_id,account_id,version,price_cents,credit_cents) values($1,$2,'work-credits-2026-10-06.1',1000,1000)",[next,a]);
 assert.equal(await v('select icash_apply_prepaid_purchase($1) value',[next]),true);assert.equal(await cap(),3300);
 const plan=uuid();await q("insert into icash_daily_plans(id,account_id,mode,state,consent_version,activated_at) values($1,$2,'live','active','daily-2026-10-04.1',now())",[plan,a]);
 await q('update icash_funding_orders set daily_plan_id=$1 where id=$2',[plan,next]);
 await q('update icash_accounts set bot_paused=true where id=$1',[a]);await q('select icash_daily_claim($1)',[a]);
 assert.equal(await cap(),3300);assert.equal(await v('select bot_paused value from icash_accounts where id=$1',[a]),true,'renewals keep pause');
 const recharge=uuid();await q("insert into icash_auto_recharge_attempts(id,account_id,mode,order_id,approved_order,amount_cents,stripe_customer_id,stripe_payment_method_id,state) values($1,$2,'live',$3,$3,1000,'cus_test','pm_test','pending')",[recharge,a,next]);
 await q("select icash_settle_auto_recharge($1,'pi_test',1000,'cus_test','pm_test','live')",[recharge]);assert.equal(await cap(),3300,'auto recharge preserves only approved grants');
 // Reproduce the screenshot: money available but lifetime cap exhausted by holds.
 await q('insert into icash_operating_budget(id,enabled,require_company_reserve) values(1,true,false)');
 await q("insert into icash_text_senders(phone,enabled) values('+12025550199',true)");
 await q("insert into icash_operation_rates(id,operation,charge_cents,enabled,expires_at) values($1,'sms_send',9,true,now()+interval '1 day')",[rate]);
 await q("insert into icash_communication_prices(operation,customer_micros) values('sms_segment',90000)");
 await q("insert into icash_text_threads(id,account_id,sender,recipient,sms_rate_id) values($1,$2,'+12025550199','+12025550101',$3)",[thread,a,rate]);
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents) values('prior:held',$1,$2,'dispatched',1343)",[a,rate]);
 await q('update icash_accounts set daily_limit_cents=3000 where id=$1',[a]);
 await q('update icash_spend_activations set customer_cap_cents=1300 where account_id=$1',[a]);
 const reason=()=>v('select icash_manual_text_reason($1,$2) value',[a,thread]);
 assert.match(await reason(),/Spending allowance reached/,'preflight reports the real reserve gate');
 await q('update icash_spend_activations set customer_cap_cents=2300 where account_id=$1',[a]);assert.equal(await reason(),null);
 await q('update icash_wallets set balance_cents=reserved_cents where account_id=$1',[a]);assert.match(await reason(),/Add credits/,'approval cannot bypass wallet reserves');
 assert.equal(await v("select has_table_privilege('authenticated','icash_authorized_credit_grants','INSERT') value"),false);
 assert.equal(await v("select has_function_privilege('authenticated','icash_authorized_grant_cents(uuid)','EXECUTE') value"),false);
 console.log('PASS grant repair: explicit ledger approval, account isolation, paid top-up/daily/auto-recharge preservation, pause/replay, actual cap preflight and wallet gates.');
}catch(e){console.error(e.message,e.where??'',e.internalQuery??'');process.exitCode=1;}finally{await pg.close();}
