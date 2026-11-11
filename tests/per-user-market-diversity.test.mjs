import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/per-user-market-diversity.sql');
assert.equal(sql,read('supabase/migrations/20261111195406_per_user_market_diversity.sql'));
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=id(1),b=id(2),rev=id(3);
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema icash_research_private;
 create table icash_operating_budget(id int,enabled boolean default true);insert into icash_operating_budget(id) values(1);
 create table icash_bot_setups(account_id uuid);create table icash_operation_rates(id int,operation text,enabled boolean,expires_at timestamptz);insert into icash_operation_rates values(1,'property_search',true,now()+interval '60 days');create table icash_automation_tickets(account_id uuid,kind text,state text,created_at timestamptz,expires_at timestamptz);
 create table icash_accounts(id uuid primary key,bot_paused boolean default false);
 create table icash_wallets(account_id uuid,balance_cents int default 100,reserved_cents int default 0);
 create table icash_discovery_configs(account_id uuid primary key,rate_id int default 1,next_run_at timestamptz,revision uuid,next_page int default 3,zip text,exhausted boolean default false,enabled boolean default true,auto_enabled boolean default true,data_rights_until timestamptz default now()+interval '60 days',research_version int default 2,research_list_id text);
 create table icash_inventory_markets(account_id uuid,zip text,priority int default 100,eligible_until timestamptz default now()+interval '60 days',next_scan_at timestamptz default now()-interval '1 day',primary key(account_id,zip));
 create table icash_property_zip_geographies(zip text primary key,state_code text,name text,property_count int default 1000,checked_at timestamptz default now(),expires_at timestamptz default now()+interval '30 days');
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text);
 create table icash_discovery_inventory_receipts(operation_key text primary key,account_id uuid,revision uuid,zip text,queued_properties int,created_at timestamptz default now());
 create table icash_discovery_filter_pages(operation_key text,account_id uuid,zip text);
 create table icash_research_private.estimates(operation_key text,account_id uuid,query jsonb);
 create table fixture(ready boolean default true,member boolean default true,allowed_zip text,unknown_zip text,stalled_zip text,unknown_geography text);insert into fixture default values;
 create function icash_membership_work_allowed(uuid) returns boolean language sql as $$select member from public.fixture$$;
 create function icash_targeting_query_context(uuid,uuid,int) returns jsonb language sql as $$select jsonb_build_object('ready',ready) from public.fixture$$;
 create function icash_inventory_scope_allowed(uuid,text) returns boolean language sql as $$select allowed_zip is null or  $2=any(string_to_array(allowed_zip,',')) from public.fixture$$;
 create function icash_research_state_allowed(text) returns boolean language sql as $$select $1<>'XX'$$;
 create function icash_stalled_research_zip(uuid,text) returns boolean language sql as $$select coalesce($2=stalled_zip,false) from public.fixture$$;
 create function icash_research_zip_known(text) returns boolean language sql as $$select unknown_geography is null or $1<>unknown_geography from public.fixture$$;
 create function icash_opportunity_market_score(uuid,text) returns int language sql as $$select 1$$;
 create function icash_stalled_search_configuration(uuid,text) returns jsonb language sql as $$select jsonb_build_object('zip',unknown_zip) from public.fixture$$;
 create function icash_expand_inventory_markets(uuid) returns int language sql as $$select 0$$;
 create function icash_prepare_discovery_inventory(p_account uuid,p_revision uuid,p_page integer) returns text language plpgsql as $$begin
 perform public.icash_expand_inventory_markets(p_account);
 return 'ready';end $$;
 `);
 // Unit fixture substitutes only its tiny preparation predecessor hash. The
 // integration suite applies the unchanged migration to exact production sources.
 const fixtureHash=await v("select md5(pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure))");
 await db.exec(sql.replace('28d5e809b3ffd39089ef7a858d40ef0e',fixtureHash));
 await db.exec("update icash_research_private.market_diversity_settings set enabled=true,release_sha=repeat('a',40),activated_at=now()");
 const reset=async()=>{
  await db.exec('truncate icash_automation_tickets,icash_research_private.market_diversity_rotations,icash_accounts,icash_wallets,icash_discovery_configs,icash_inventory_markets,icash_property_zip_geographies,icash_operation_spend,icash_discovery_inventory_receipts,icash_discovery_filter_pages,icash_research_private.estimates; update icash_operating_budget set enabled=true; update fixture set ready=true,member=true,allowed_zip=null,unknown_zip=null,stalled_zip=null,unknown_geography=null');
  await q('insert into icash_accounts(id) values($1),($2)',[a,b]);await q('insert into icash_wallets(account_id) values($1),($2)',[a,b]);
  await q("insert into icash_discovery_configs(account_id,revision,zip) values($1,$2,'10001')",[a,rev]);
  for(const [zip,city] of [['10001','City A'],['10002','City A'],['20001','City B'],['30001','City C']]){
   await q("insert into icash_property_zip_geographies(zip,state_code,name) values($1,'TX',$2)",[zip,city]);
   await q('insert into icash_inventory_markets(account_id,zip) values($1,$2)',[a,zip]);
  }
  for(let n=1;n<=2;n++){
   await q("insert into icash_operation_spend values($1,$2,'settled')",['discovery:success'+n,a]);
   await q("insert into icash_discovery_inventory_receipts(operation_key,account_id,revision,zip,queued_properties) values($1,$2,$3,'10001',5)",['discovery:success'+n,a,rev]);
  }
 };
 const rotate=()=>v('select public.icash_rotate_successful_market($1,$2,3)',[a,rev]);
 await reset();await db.exec('update icash_research_private.market_diversity_settings set enabled=false');assert.equal(await rotate(),false,'Installs disabled');await db.exec('update icash_research_private.market_diversity_settings set enabled=true');assert.equal(await v('select icash_prepare_discovery_inventory($1,$2,3)',[a,rev]),'inventory_market_changed');
 assert(['20001','30001'].includes(await v('select zip from icash_discovery_configs')),'Prefer a different city');
 assert.equal(await v('select next_page from icash_discovery_configs'),1);assert.notEqual(await v('select revision from icash_discovery_configs'),rev);
 assert.equal(await v("select count(*)::int from icash_operation_spend where state='settled'"),2,'No paid work created or receipts changed');
 assert.equal(await v("select count(*)::int from icash_inventory_markets where next_scan_at>now()+interval '29 days'"),2);
 for(const [change,label] of [
  ["update icash_accounts set bot_paused=true where id='"+a+"'",'pause'],
  ['update icash_wallets set balance_cents=0','funds'],
  ['update fixture set member=false','membership'],
  ['update icash_operating_budget set enabled=false','global disable'],
  ['update fixture set ready=false','financial/exclusion readiness'],
  ['update icash_discovery_configs set research_version=1','legacy research'],
  ["update icash_discovery_configs set research_list_id='legacy'",'legacy saved lists'],
  ["update icash_discovery_configs set data_rights_until=now()-interval '1 day'",'data rights'],
  ["update fixture set allowed_zip='10001'",'single allowed ZIP'],
  ["update icash_inventory_markets set next_scan_at=now()+interval '1 day'",'cooldowns'],
  ["update icash_property_zip_geographies set expires_at=now()-interval '1 day'",'stale metadata'],
  ["update icash_discovery_inventory_receipts set queued_properties=0 where operation_key='discovery:success2'",'one successful page'],
  ["update icash_operation_spend set state='reserved' where operation_key='discovery:success2'",'own reserved work'],
  ["update icash_operation_spend set state='dispatched' where operation_key='discovery:success2'",'own unknown work'],
 ]){await reset();await db.exec(change);assert.equal(await rotate(),false,label);assert.equal(await v('select zip from icash_discovery_configs'),'10001',label+' preserves current supply');}
 await reset();assert.equal(await v('select public.icash_rotate_successful_market($1,$2,4)',[a,rev]),false,'Stale page');
 await reset();await q("insert into icash_operation_spend values('discovery:unknown',$1,'dispatched')",[b]);assert.equal(await rotate(),false,'Unknown global scope fails closed');
 await q("insert into icash_discovery_filter_pages values('discovery:unknown',$1,'20001')",[b]);assert.equal(await rotate(),true,'Known unrelated scope permits other markets');assert.equal(await v('select zip from icash_discovery_configs'),'30001');
 await reset();await db.exec("update fixture set allowed_zip='10001,10002'");assert.equal(await rotate(),true,'Authorized alternatives within an explicit city remain usable');assert.equal(await v('select zip from icash_discovery_configs'),'10002');
 await reset();await q("insert into icash_discovery_inventory_receipts values('prior',$1,$2,'20001',5,now())",[a,id(10)]);assert.equal(await rotate(),true);assert.equal(await v('select zip from icash_discovery_configs'),'30001','Prefer less represented city in own history');
 await reset();for(let n=0;n<70;n++){const zip=String(11000+n);await q("insert into icash_property_zip_geographies(zip,state_code,name) values($1,'TX','City A')",[zip]);await q('insert into icash_inventory_markets(account_id,zip,priority) values($1,$2,1)',[a,zip]);}
 assert.equal(await rotate(),true);assert(['20001','30001'].includes(await v('select zip from icash_discovery_configs')),'Dense current-city ZIPs cannot fill bounded candidate set');
 await reset();await db.exec("update fixture set stalled_zip='20001',unknown_geography='30001';update icash_property_zip_geographies set state_code='XX' where zip='10002'");assert.equal(await rotate(),false,'Stalled, unknown and blocked-state candidates are ineligible');
 await reset();await q("insert into icash_automation_tickets values($1,'discovery','issued',now(),now()+interval '1 hour'),($1,'discovery','consumed',now(),now())",[a]);assert.equal(await rotate(),false,'Competing live tickets');
 await reset();assert.equal(await v('select public.icash_rotate_successful_market($1,$2,3)',[a,id(999)]),false,'Stale revision');assert.equal(await rotate(),true);assert.equal(await rotate(),false,'Cannot rotate old revision twice');
 assert.equal(await v('select count(*)::int from icash_research_private.market_diversity_rotations'),1,'One immutable audit per rotation');
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'public.icash_rotate_successful_market(uuid,uuid,integer)','execute')",[role]),false);
 console.log('PASS per-user diversity: successful-page threshold, city spread, account-local exposure, scope/financial/unknown fences, no alternative fallback and immutable paid receipts.');
}finally{await db.close();}
