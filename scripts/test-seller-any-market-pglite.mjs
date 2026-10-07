// SIMULATION ONLY. Execute the allocator's exact candidate query in isolated Postgres.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href);
const pg=await PGlite.create();
const source=readFileSync(new URL('../config/seller-limited-contact.sql',import.meta.url),'utf8');
const candidate=source.slice(source.indexOf('select candidate.*'),source.indexOf(' -- Larger available budgets')).replaceAll("l.property->>'id'","'simulation_property'").replaceAll("l.property->>'zip'","'75241'").replaceAll('l.id',"'lead1'").replaceAll('city_name',"'dallas'").replaceAll('state_code',"'TX'").replaceAll('capacity>=charge','capacity>=12');
try{
 await pg.exec(`create table icash_accounts(id text,bot_paused boolean,daily_limit_cents bigint); create table icash_wallets(account_id text,balance_cents bigint,reserved_cents bigint); create table icash_bot_setups(account_id text,profile jsonb); create table icash_credit_ledger(account_id text,kind text,delta_cents bigint,created_at timestamptz); create table icash_outbound_property_owners(property_id text,account_id text); create table icash_seller_matches(lead_id text,account_id text); create table icash_billing_reviews(account_id text,resolved_at timestamptz); create table icash_inventory_markets(account_id text,zip text,eligible_until timestamptz); create function icash_credit_acquisition_allowed(text) returns boolean language sql as $$select true$$; insert into icash_accounts values('a',false,2128); insert into icash_wallets values('a',2058,1515); insert into icash_bot_setups values('a','{}');`);
 const count=async()=> (await pg.query(candidate)).rows.length;
 assert.equal(await count(),1,'empty profile permits any inbound ZIP');
 await pg.exec("delete from icash_bot_setups");
 assert.equal(await count(),1,'missing setup permits any inbound ZIP');
 async function held(sql,label){await pg.exec('begin');await pg.exec(sql);assert.equal(await count(),0,label);await pg.exec('rollback');}
 await held("update icash_accounts set bot_paused=true",'pause');
 await held("update icash_wallets set balance_cents=reserved_cents+11",'wallet capacity');
 await held("update icash_accounts set daily_limit_cents=1526",'daily limit');
 await held("insert into icash_credit_ledger values('a','usage',-1000,now())",'rolling usage');
 await held("insert into icash_seller_matches values('lead1','a')",'duplicate match');
 await held("insert into icash_billing_reviews values('a',null)",'billing hold');
 await held("insert into icash_outbound_property_owners values('simulation_property','other')",'property exclusivity');
 await pg.exec("delete from icash_inventory_markets;update icash_bot_setups set profile='{\"marketMode\":\"nationwide\"}'");
 assert.equal(await count(),1,'existing nationwide remains valid');
 await pg.exec("update icash_bot_setups set profile='{\"market\":\"Dallas, TX\"}'");
 assert.equal(await count(),1,'existing city remains valid');
 console.log('PASS: any-ZIP inbound and missing/empty setup; wallet, daily limit, usage, pause, duplicate, billing and property ownership guards.');
}finally{await pg.close();}
