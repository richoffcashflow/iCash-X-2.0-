// Isolated database policy regression. No network, providers, or customer data.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID as uuid} from 'node:crypto';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),v=async(sql,args=[])=>(await q(sql,args)).rows[0].v;
try{
 await pg.exec('create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);set check_function_bodies=off;');
 const schema=JSON.parse(read('tests/fixtures/automatic-credits-baseline.json'));
 for(const t of schema.tables)await pg.exec(t.definition.replace(/default icash_[a-z_]+\.clock_now\(\)/g,'default now()'));
 await pg.exec(`alter table icash_memberships add vip_until timestamptz;
 alter table icash_text_messages add customer_author_id uuid;
 create table icash_question_usage(account_id uuid,question_id uuid,state text);
 create schema icash_recorded_reception_private;create table icash_recorded_reception_private.sessions(id uuid);
 create schema icash_reception_private;create table icash_reception_private.receipts(account_id uuid,operation_key text,profile text);
 `);
 await pg.exec(read('tests/fixtures/available-credit-dependencies.sql'));
 // This non-call fixture has no reception exception. Inbound admission is
 // exercised separately with the complete private reception schema.
 await pg.exec(`create or replace function icash_general_reception_pause_exempt(p_account uuid,p_operation text,p_charge bigint) returns boolean language sql as $$select false$$;`);
 const a=uuid(),owner=uuid(),other=uuid();
 await q('insert into auth.users values($1)',[owner]);
 await q("insert into icash_accounts(id,owner_user_id,bot_paused,billing_model,daily_limit_cents) values($1,$2,false,'membership_credits',1)",[a,owner]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,100,80)',[a]);
 await q("insert into icash_memberships(account_id,state,mode,paid_through) values($1,'active','live',now()+interval '30 days')",[a]);
 await q('insert into icash_operating_budget(id,enabled,require_company_reserve) values(1,true,false)');
 // Apply the complete migration, including the one-time hold release and RLS.
 await pg.exec(read('supabase/migrations/20261008182808_available_credit_usage.sql'));
 const wallet=()=>v('select jsonb_build_object(\'balance\',balance_cents,\'held\',reserved_cents) v from icash_wallets where account_id=$1',[a]);
 assert.deepEqual(await wallet(),{balance:100,held:0},'release holds without changing balance');
 const reserve=(key,amount,account=a)=>v('select icash_reserve_credit($1,$2,$3) v',[account,key,amount]);
 const finish=(key,charge,evidence='SIMULATION completed usage')=>v('select icash_finish_credit($1,$2,$3,$4) v',[a,key,charge,evidence]);
 const first=await reserve('synthetic-a',1000);
 assert.equal(await reserve('synthetic-a',1000),first,'retry reuses authorization');
 assert.deepEqual(await wallet(),{balance:100,held:0},'a maximum quote never withholds credits');
 await assert.rejects(reserve('synthetic-a',999),/Idempotency conflict/);
 await assert.rejects(finish('synthetic-a',1001),/Charge exceeds/);
 await reserve('synthetic-b',1000);
 assert.equal(await finish('synthetic-a',60),'settled');
 assert.equal(await finish('synthetic-a',60),'settled','settlement replay charges once');
 assert.deepEqual(await wallet(),{balance:40,held:0});
 await assert.rejects(finish('synthetic-a',61),/Settlement conflict/);
 assert.equal(await finish('synthetic-b',70),'settled','overlapping completed usage reconciles');
 assert.deepEqual(await wallet(),{balance:0,held:0},'no negative customer balance');
 assert.equal(await finish('synthetic-b',70),'settled');
 assert.deepEqual(await v('select jsonb_build_object(\'gross\',gross_cents,\'customer\',customer_cents,\'covered\',covered_cents) v from icash_usage_coverage'),{gross:70,customer:40,covered:30});
 assert.equal(Number(await v('select sum(delta_cents) v from icash_credit_ledger')),-100,'ledger charges exactly available customer funds');
 assert.equal(await v('select count(*)::int v from icash_credit_ledger'),3,'no duplicate debit or coverage credit');
 await assert.rejects(reserve('synthetic-empty',1),/Insufficient credits/);
 // A top-up works despite the original daily cap and historical spending.
 await q('update icash_wallets set balance_cents=50 where account_id=$1',[a]);
 await reserve('synthetic-topup',1000);
 const allowance=await v('select icash_daily_allowance($1) v',[a]);
 assert.equal(allowance.mode,'available_balance');assert.equal(allowance.remainingCents,50);
 await q('update icash_accounts set bot_paused=true where id=$1',[a]);
 // General-reception exemption does not apply to arbitrary work.
 await assert.rejects(reserve('synthetic-paused',1),/Bot paused/);
 await q('update icash_accounts set bot_paused=false where id=$1',[a]);
 await q("update icash_memberships set state='payment_failed' where account_id=$1",[a]);
 await assert.rejects(reserve('synthetic-inactive',1),/membership is inactive/);
 await q("update icash_memberships set state='active' where account_id=$1",[a]);
 await assert.rejects(v('select icash_finish_credit($1,$2,0,$3) v',[other,'synthetic-topup','SIMULATION']),/Wallet missing|Reservation missing/);
 assert.equal(await finish('synthetic-topup',0),'released');assert.deepEqual(await wallet(),{balance:50,held:0});
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_table_privilege($1,'icash_usage_coverage','SELECT,INSERT,UPDATE,DELETE') v",[role]),false);
 assert.equal(await v("select relrowsecurity v from pg_class where oid='icash_usage_coverage'::regclass"),true);
 assert.equal(await v("select has_function_privilege('authenticated','icash_call_credit_available(uuid,text)','execute') v"),false);
 console.log('PASS full available-credit migration: no holds, maximum-quote admission, real once-only settlement, concurrent overrun coverage, zero balance, top-up recovery, pause/membership/tenant protections, private accounting. PGlite does not prove cross-process lock contention.');
}catch(e){console.error(e.message,e.where??'',e.internalQuery??'');process.exitCode=1;}finally{await pg.close();}
