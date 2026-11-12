import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/market-hold-continuation-fixture.mjs';
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 await db.exec('create role anon;create role authenticated;create role service_role;'+f.setupSql+f.seedSql);
 await db.exec('begin;'+f.migration+'commit;');
 assert.equal(await v("select md5(pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure))"),'28d5e809b3ffd39089ef7a858d40ef0e');
 await db.exec("create table if not exists icash_research_state_exclusions(state_code text,effective_from date);");
 await db.exec(readFileSync(new URL('./fixtures/seller-atomic-quota-predicates.sql',import.meta.url),'utf8').match(/CREATE OR REPLACE FUNCTION public\.icash_research_state_allowed[\s\S]*?\$function\$;/)[0]);
 await db.exec("alter table icash_property_zip_geographies add column name text;insert into icash_property_zip_geographies values('10001','NY',1000,now(),now()+interval '30 days','New York'),('90210','CA',1000,now(),now()+interval '30 days','Beverly Hills');update icash_property_zip_geographies set name=coalesce(name,zip);");
 await db.exec(readFileSync(new URL('../config/per-user-market-diversity.sql',import.meta.url),'utf8'));
 // Retain the other account's original unknown operation; current supply is now
 // disjoint, and two original settled productive pages authorize a research turn.
 await q("update icash_discovery_configs set zip='90210' where account_id=$1",[f.account]);
 for(let n=1;n<=2;n++){
  await q("insert into icash_operation_spend(operation_key,account_id,state) values($1,$2,'settled')",['discovery:successful:'+n,f.account]);
  await q("insert into icash_discovery_inventory_receipts(operation_key,account_id,revision,zip,queued_properties,returned_properties,duplicate_properties,created_at) values($1,$2,$3,'90210',5,5,0,now())",['discovery:successful:'+n,f.account,f.revision]);
 }
 const context=()=>v('select public.icash_targeting_query_context($1,$2,1)',[f.account,f.revision]);
 assert.equal((await context()).ready,true,'Actual financial-only targeting ready without experiments');
 const prepare=()=>v('select public.icash_prepare_discovery_inventory($1,$2,1)',[f.account,f.revision]);
 const before=await v('select jsonb_agg(o order by operation_key) from icash_operation_spend o');
 assert.equal(await prepare(),'ready','Disabled install preserves original successful path');
 await db.exec("update icash_research_private.market_diversity_settings set enabled=true,release_sha=repeat('a',40),activated_at=now()");
 assert.equal(await prepare(),'inventory_market_changed');
 const after=await v('select to_jsonb(c) from icash_discovery_configs c where account_id=$1',[f.account]);
 assert.equal(after.zip,'10001','Unknown75217 excluded, current90210 not repeated');
 assert.equal(await prepare(),'inventory_held','Old revision rejected by original preparation');
 assert.equal(await v('select public.icash_reserve_research_discovery($1,$2,$3,$4)',[f.account,f.scope,f.plan,f.policy]),false,'Original final paid admission rejects stale scope');
 const newContext=await v('select public.icash_targeting_query_context($1,$2,1)',[f.account,after.revision]);assert.equal(newContext.ready,true);assert.equal(newContext.policy.version,'financial-prefilter-v1');
 assert.equal(await v('select public.icash_reserve_research_discovery($1,$2,$3,$4)',[f.account,{...f.scope,p_zip:after.zip,p_revision:after.revision},f.plan,newContext.policy]),false,'Fresh market still needs exact free estimate; rotation grants no paid authority');
 assert.deepEqual(await v('select jsonb_agg(o order by operation_key) from icash_operation_spend o'),before,'All original settled and unknown operations unchanged');
 assert((await v("select pg_get_functiondef('public.icash_prepare_discovery_inventory(uuid,uuid,integer)'::regprocedure)")).includes('public.icash_continue_held_inventory'),'Earlier hold recovery retained');
 console.log('PASS composed hold+diversity: exact production preparation/financial scope, preserved unknowns, disabled default, new-market ready, stale scope rejection and paid estimate requirement.');
}finally{await db.close();}
