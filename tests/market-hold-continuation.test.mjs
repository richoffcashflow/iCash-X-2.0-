import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/market-hold-continuation-fixture.mjs';
const pg=new PGlite();await pg.exec('create role anon;create role authenticated;create role service_role;');
await pg.exec(f.setupSql);await pg.exec(f.seedSql);
const value=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const scenario=async fn=>{await pg.exec('begin');try{await fn();}finally{await pg.exec('rollback');}};
const current=()=>value('select to_jsonb(c) from public.icash_discovery_configs c where account_id=$1',[f.account]);
const prepare=()=>value('select public.icash_prepare_discovery_inventory($1,$2,1)',[f.account,f.revision]);
const claim=()=>value(f.claimSql);
const unchanged=async before=>assert.deepEqual(await current(),before);
assert.equal((await value('select public.icash_targeting_query_context($1,$2,1)',[f.account,f.revision])).ready,false);
assert.equal(await prepare(),'inventory_held','Reproduce pre-fix bystander deadlock despite eligible authorized disjoint inventory');
await pg.exec('begin;'+f.migration+'commit;');
assert.equal(await claim(),false,'Installs disabled');
await pg.exec(f.activateSql);
await scenario(async()=>{
 const before=await current(),originalOps=await value('select jsonb_agg(o) from public.icash_operation_spend o');
 assert.equal(await prepare(),'inventory_market_changed');const after=await current();
 assert.equal(after.zip,'10001');assert.notEqual(after.revision,before.revision);assert.equal(after.next_page,1);
 const audit=await value('select to_jsonb(a) from icash_research_private.market_hold_continuations a');
 assert.deepEqual(audit.original_configuration,before);assert.deepEqual(audit.next_configuration,after);
 assert.deepEqual(audit.blocked_zips,['75217']);assert.equal(audit.blocking_operations.length,1);
 assert.deepEqual(await value('select jsonb_agg(o) from public.icash_operation_spend o'),originalOps);
 assert.equal(await claim(),false,'Exact old scope cannot rotate twice');
 assert.equal(await prepare(),'inventory_held','Old worker scope stops before purchase');
 assert.equal(await value('select public.icash_reserve_research_discovery($1,$2,$3,$4)',[f.account,{...f.scope,p_market_mode:'nationwide',p_market:null},f.plan,f.policy]),false,'Stale final paid claim rejected');
 const context=await value('select public.icash_targeting_query_context($1,$2,1)',[f.account,after.revision]);
 assert.equal(context.ready,true);assert.equal(context.policy.version,'financial-prefilter-v1');
 assert.equal(await value('select public.icash_reserve_research_discovery($1,$2,$3,$4)',[f.account,{...f.scope,p_zip:after.zip,p_revision:after.revision,p_market_mode:'nationwide',p_market:null},f.plan,context.policy]),false,'Fresh rotation alone grants no spend without exact free estimate');
});
for(const sql of [
 "update icash_research_private.market_hold_continuation_settings set enabled=false",
 "delete from icash_research_private.market_hold_continuation_settings",
 "delete from icash_research_private.targeting_query_settings",
 "delete from icash_research_private.exclusions",
 "update icash_operating_budget set enabled=false",
 "update icash_accounts set bot_paused=true",
 "update fixture_gates set allowed=false where name='membership'",
 "update icash_wallets set balance_cents=reserved_cents",
 "update icash_discovery_configs set enabled=false",
 "update icash_discovery_configs set auto_enabled=false",
 "update icash_discovery_configs set exhausted=true",
 "update icash_discovery_configs set data_rights_until=now()-interval '1 second'",
 "update icash_discovery_configs set revision=gen_random_uuid()",
 "update icash_discovery_configs set next_page=2",
 "update icash_discovery_configs set research_version=1",
 "update icash_discovery_configs set research_list_id='legacy-list'",
 "update icash_operation_rates set enabled=false",
 "update icash_operation_rates set expires_at=now()-interval '1 second'",
 "update icash_bot_setups set profile='{}'::jsonb||jsonb_build_object('marketMode','city','market','75217')",
 "update icash_research_private.financial_settings set enabled=false",
 "delete from icash_research_private.financial_settings",
 "update icash_integration_checks set checked_at=now()-interval '8 days'",
 "update icash_research_private.targeting_query_settings set enabled=false",
 "update icash_research_private.exclusions set state='pending'",
 "update icash_research_private.exclusions set list_id='other'",
 "update icash_research_private.exclusions set last_synced_at=null",
 "update icash_research_private.exclusions set last_synced_at=now()+interval '1 second'",
 "insert into icash_research_private.exclusion_items values('pending',null)",
 "update icash_inventory_markets set eligible_until=now()-interval '1 second'",
 "update icash_inventory_markets set next_scan_at=now()+interval '1 day'",
 "update fixture_gates set allowed=false where name='market'",
 "update fixture_gates set allowed=true where name='stalled'",
 "delete from icash_inventory_markets",
 "delete from icash_operation_spend",
 `insert into icash_operation_spend(operation_key,account_id,state) values('discovery:own-unknown','${f.account}','dispatched')`,
 `insert into icash_operation_spend(operation_key,account_id,state) values('discovery:own-reserved','${f.account}','reserved')`,
 `insert into icash_operation_spend(operation_key,account_id,state) values('discovery:unscoped','${f.other}','dispatched')`,
 `insert into icash_automation_tickets(account_id,kind,state,created_at,expires_at) select '${f.account}','discovery','consumed',now(),now()+interval '1 minute' from generate_series(1,2)`
])await scenario(async()=>{await pg.exec(sql);const before=await current();assert.equal(await claim(),false,sql);await unchanged(before);assert.equal(await value('select count(*)::int from icash_research_private.market_hold_continuations'),0);});
for(const query of [{locations:[{type:'zip_code',code:'10001'},{type:'zip_code',code:'90210'}]}, {locations:[{type:'city',code:'10001'}]}, {locations:[{type:'zip_code',code:'bad'}]}, {locations:{type:'zip_code',code:'10001'}}])await scenario(async()=>{
 await pg.exec(`insert into icash_operation_spend(operation_key,account_id,state) values('discovery:invalid-estimate','${f.other}','dispatched')`);
 await pg.query('insert into icash_research_private.estimates(operation_key,account_id,query) values($1,$2,$3)',['discovery:invalid-estimate',f.other,query]);
 assert.equal(await claim(),false,'Malformed/multi-location evidence does not establish a disjoint scope');
});
await scenario(async()=>{await pg.exec('delete from icash_bot_setups');assert.equal(await claim(),true,'Canonical missing setup is unrestricted');});
await scenario(async()=>{await pg.exec("update icash_bot_setups set profile='{}'");assert.equal(await claim(),true,'Canonical default market mode remains unrestricted');});
await scenario(async()=>{
 await pg.exec(`insert into icash_research_private.estimates(operation_key,account_id,query) values('discovery:${f.other}:${f.other}:1','${f.other}','{"locations":[{"type":"zip_code","code":"10001"}]}')`);
 assert.equal(await claim(),true);assert.equal((await current()).zip,'90210','All independently bound source ZIPs are excluded');
});
await scenario(async()=>{
 await pg.exec(`insert into icash_operation_spend(operation_key,account_id,state) values('discovery:foreign-binding','${f.other}','dispatched');insert into icash_research_private.estimates(operation_key,account_id,query) values('discovery:foreign-binding','${f.account}','{"locations":[{"type":"zip_code","code":"10001"}]}')`);
 assert.equal(await claim(),false,'Other account source cannot bind an unscoped operation');
});
await scenario(async()=>{await pg.exec(`insert into icash_discovery_configs(account_id,zip,enabled,exhausted) values('00000000-0000-4000-8000-000000000033','10001',true,false)`);assert.equal(await claim(),true);assert.equal((await current()).zip,'90210','Existing least-loaded market fairness is preserved');});
await scenario(async()=>{await pg.exec(`insert into icash_inventory_markets(account_id,zip,next_scan_at,priority) select '${f.account}',lpad(n::text,5,'0'),now(),3 from generate_series(20000,29999)n;insert into fixture_scores values('29999',999999)`);assert.equal(await claim(),true);assert.equal((await current()).zip,'10001','Bounded candidate ranking does not score the entire 10k inventory');});
await scenario(async()=>{
 assert.equal(await claim(),true);
 const c=await current();
 assert.equal(await value('select public.icash_prepare_discovery_inventory($1,$2,1)',[f.account,c.revision]),'ready');
 // Fixture boundaries: inherited filter-state function is a null stub, and
 // known-ZIP stub does not populate metadata needed by the real final gate.
 await pg.query("insert into icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page,exhausted,pages) values($1,$2,$3,'baseline',1,false,0)",[f.account,c.revision,c.zip]);
 await pg.query("insert into icash_property_zip_geographies(zip,state_code,property_count,checked_at,expires_at) values($1,'NY',100,now(),now()+interval '1 day')",[c.zip]);
 const context=await value('select public.icash_targeting_query_context($1,$2,1)',[f.account,c.revision]);
 const scope={...f.scope,p_zip:c.zip,p_revision:c.revision,p_market_mode:'nationwide',p_market:null};
 const query={...await f.queryFor(context.policy),locations:[{type:'zip_code',code:c.zip}]};
 assert.equal(await value('select icash_research_private.financial_query_valid($1,$2,$3,$4)',[query,context.policy,f.plan,scope]),true);
 const estimate=await value('select public.icash_claim_discovery_estimate($1,$2,$3,$4,$5)',[f.account,scope,f.plan,context.policy,query]);
 assert.equal(estimate.status,'request');
 assert.equal(await value('select public.icash_finish_discovery_estimate($1,$2,$3)',[f.account,estimate.token,f.positive]),true);
 await pg.exec('savepoint valid_admission_probe');
 assert.equal(await value('select public.icash_reserve_research_discovery($1,$2,$3,$4)',[f.account,scope,f.plan,context.policy]),true,'Current scope with exact saved estimate reaches original final admission');
 await pg.exec('rollback to savepoint valid_admission_probe');
 await pg.query("insert into icash_operation_spend(operation_key,account_id,state) values('discovery:new-conflict',$1,'dispatched')",[f.other]);
 await pg.query("insert into icash_research_private.estimates(operation_key,account_id,query) values('discovery:new-conflict',$1,$2)",[f.other,{locations:[{type:'zip_code',code:c.zip}]}]);
 assert.equal(await value('select public.icash_reserve_research_discovery($1,$2,$3,$4)',[f.account,scope,f.plan,context.policy]),false,'New scoped unknown blocks otherwise valid exact final admission');
});
for(const role of ['anon','authenticated'])assert.equal(await value('select has_function_privilege($1,$2,\'EXECUTE\')',[role,'public.icash_continue_held_inventory(uuid,uuid,integer)']),false);
for(const role of ['anon','authenticated','service_role'])for(const table of ['market_hold_continuation_settings','market_hold_continuations'])assert.equal(await value('select has_table_privilege($1,$2,\'SELECT,INSERT,UPDATE,DELETE\')',[role,'icash_research_private.'+table]),false);
assert.equal(f.migration,readFileSync(new URL('../supabase/migrations/20261111223030_market_hold_continuation.sql',import.meta.url),'utf8'));
assert.equal((f.migration.match(/with unresolved as materialized/gi)||[]).length,1);
assert.equal(f.migration.includes('limit 64'),true);
assert.doesNotMatch(f.migration,/update\s+(?:public\.)?icash_operation_spend|delete from|update\s+(?:public\.)?icash_wallets/i);
assert.doesNotMatch(f.migration,/^begin;|^commit;/m,'Caller owns body + ledger atomicity');
await pg.close();console.log('PASS market hold continuation: original failure reproduced; disabled rollout, source-scoped disjoint rotation, immutable audit/holds, final stale/spend fences, authorization, metadata, funding, fairness and bounded inventory passed.');
