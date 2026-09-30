// Optional isolated PostgreSQL/WASM verification. No server, credentials, or
// provider calls. PGlite must already be installed separately, e.g. under /tmp.
// Usage: node scripts/test-funded-voice-pglite.mjs /absolute/path/to/pglite/dist/index.js
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const modulePath=process.argv[2];
if(!modulePath||!isAbsolute(modulePath))throw Error('Supply the absolute path to an existing official PGlite module');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const read=file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8');
const table=(file,name)=>{
 const source=read(file);
 const start=source.search(new RegExp(`create table public\\.${name}\\s*\\(`,'i'));
 assert(start>=0,`Missing source table: ${name}`);
 const end=source.indexOf(';',start);
 assert(end>start,`Missing table terminator: ${name}`);
 return source.slice(start,end+1);
};
const foundation='supabase/migrations/20260928015041_icash_accounts_deals_credit_foundation.sql';
const costs='supabase/migrations/20260928195902_atomic_operating_costs.sql';
const practice='supabase/migrations/20260928145809_elevenlabs_voice_test.sql';
const notices=[];
const pg=await PGlite.create({onNotice:notice=>notices.push(notice.message)});
try{
 console.log('Embedded PostgreSQL:',(await pg.query('select version()')).rows[0].version);
 // Supabase-specific auth bootstrap is deliberately minimal. The two unrelated
 // ID-only tables satisfy foreign keys; the suite never dispatches a call.
 await pg.exec(`
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  create schema auth;
  create table auth.users(id uuid primary key,email text);
  create table public.icash_screening_jobs(id uuid primary key);
  create table public.icash_live_callbacks(id uuid primary key);
  grant usage on schema public to anon,authenticated,service_role;
 `);
 for(const name of ['icash_accounts','icash_wallets','icash_credit_packs'])await pg.exec(table(foundation,name));
 await pg.exec(`insert into public.icash_credit_packs(code,price_cents,credit_cents) values('start',2000,2000)`);
 await pg.exec(table('supabase/migrations/20260928031246_icash_verified_funding_and_accounts.sql','icash_funding_orders'));
 for(const name of ['icash_operating_budget','icash_operation_rates'])await pg.exec(table(costs,name));
 await pg.exec('insert into public.icash_operating_budget(id) values(1)');
 await pg.exec(read(costs).slice(read(costs).indexOf('create function public.icash_immutable_operation_rate()')));
 await pg.exec(read('config/live-dispatch.sql').split('-- Production voice')[0]);
 for(const name of ['icash_voice_configs','icash_contact_permissions','icash_voice_jobs','icash_offer_authorities'])await pg.exec(table('config/live-dispatch.sql',name));
 await pg.exec(read('config/setup-voice-dispatch.sql'));
 for(const name of ['icash_voice_test_config','icash_voice_test_access','icash_voice_test_sessions'])await pg.exec(table(practice,name));
 await pg.exec('insert into public.icash_voice_test_config(id) values(1)');
 await pg.exec(table('supabase/migrations/20260928221806_discovery_screening_bridge.sql','icash_discovery_configs'));
 await pg.exec(read('supabase/migrations/20260928222744_automatic_work_and_contacts.sql').split(';')[0]+';');
 await pg.exec(table('config/bot-setup-funnel.sql','icash_bot_setups'));
 await pg.exec(table('config/buyer-discovery.sql','icash_buyer_search_configs'));
 await pg.exec(read('config/buyer-search-config-integrity.sql'));
 await pg.exec(table('config/inventory-allocation.sql','icash_inventory_markets'));
 await pg.exec(table('config/dealmachine-cost-baseline.sql','icash_data_cost_settings'));
 await pg.exec(`insert into public.icash_data_cost_settings(provider,credit_micros,cost_basis,source_ref)
  values('dealmachine',10000,'isolated_test_fixture','No live provider quote or credentials')`);
 await pg.exec(read('config/market-shortlist.sql'));
 // Mirror service-only/RLS prerequisites without reproducing unrelated auth APIs.
 const existing=(await pg.query("select tablename from pg_tables where schemaname='public'")).rows;
 for(const {tablename} of existing){
  assert(/^icash_[a-z_]+$/.test(tablename));
  await pg.exec(`alter table public.${tablename} enable row level security;
   revoke all on public.${tablename} from public,anon,authenticated;
   grant select,insert,update,delete on public.${tablename} to service_role;`);
 }
 await pg.exec(read('config/funded-account-provisioning.sql'));
 await pg.exec(read('config/funded-provisioning-trigger.sql'));
 await pg.exec(read('config/funded-voice-provisioning.sql'));
 assert.equal((await pg.query('select count(*)::int as n from public.icash_voice_production_template')).rows[0].n,0);
 console.log('Migration applied with an empty production template');
 const results=await pg.exec(read('tests/funded-voice-provisioning-database.sql'));
 const messages=results.flatMap(result=>result.rows??[]).map(row=>row.result).filter(Boolean);
 assert(messages.some(message=>message.startsWith('PASS:')),'Missing SQL fixture PASS result');
 assert(!notices.some(message=>message.includes('Funded account provisioning deferred')),'Funding trigger swallowed an SQL error');
 for(const name of ['icash_accounts','icash_voice_configs','icash_voice_production_template','icash_operation_rates']){
  assert.equal((await pg.query(`select count(*)::int as n from public.${name}`)).rows[0].n,0,`Fixture rollback leaked rows in ${name}`);
 }
 console.log(messages.join('\n'));
 console.log('Rollback verified: no accounts, rates, voice configurations or templates survived');
 console.log('LIMITATIONS: embedded single-connection PostgreSQL, minimal auth/FK fixtures; no production schema/advisors, multi-session concurrency, provider or end-to-end call verification');
}catch(error){
 console.error('ISOLATED_SQL_FAILED',error.message,error.detail??'',error.where??'');
 process.exitCode=1;
}finally{await pg.close();}
