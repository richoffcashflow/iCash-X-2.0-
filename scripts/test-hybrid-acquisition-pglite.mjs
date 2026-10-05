// Isolated PostgreSQL simulation. Schema/function fixture is read-only production
// metadata from 2026-10-05, without customer data, credentials or provider calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const file=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const q=(sql,args=[])=>pg.query(sql,args),scalar=async(sql,args=[])=>(await q(sql,args)).rows[0].value;
try{
 const fixture=JSON.parse(file('tests/fixtures/hybrid-baseline.json'));
 await pg.exec('create role anon;create role authenticated;create role service_role;');
 await pg.exec(Object.values(fixture.tables).join('\n').replaceAll('id uuid primary key','id uuid primary key default gen_random_uuid()'));
 await pg.exec(Object.values(fixture.functions).join(';\n')+';');
 await pg.exec(file('tests/fixtures/hybrid-free-scheduler.sql'));
 await pg.exec(file('supabase/migrations/20261005183118_hybrid_inbound_priority_acquisition.sql'));
 for(const [address,state] of [['10 Main St, Dallas, TX 75201, USA','TX'],['10 Main St, Austin, Texas, United States','TX'],['10 Main St, Portland, OR','OR'],['10 Maine Street, Boston, MA 02108','MA'],['10 Main St',null]])assert.equal(await scalar('select icash_address_state($1) value',[address]),state);
 assert.equal(await scalar("select icash_research_state_allowed('TX') value"),true);
 for(const state of ['OR','IL','SC','CT','XX',null])assert.equal(await scalar('select icash_research_state_allowed($1) value',[state]),false);
 const a=randomUUID(),b=randomUUID(),rate=randomUUID(),enrich=randomUUID();
 await q("insert into icash_accounts(id,bot_paused,daily_limit_cents,billing_model) values($1,false,1000,'daily'),($2,false,5000,'daily')",[a,b]);
 await q('insert into icash_wallets(account_id,balance_cents,reserved_cents) values($1,10000,0),($2,10000,0)',[a,b]);
 await q("insert into icash_operation_rates(id,operation,charge_cents,enabled,expires_at) values($1,'property_search',51,true,now()+interval '2 days'),($2,'owner_enrichment',105,true,now()+interval '2 days')",[rate,enrich]);
 await q("insert into icash_market_shortlist(zip,state) values('75201','TX'),('97201','OR')");
 for(const id of [a,b]){
  await q("insert into icash_discovery_configs(account_id,enabled,auto_enabled,exhausted,zip,data_rights_until,rate_id) values($1,true,true,false,'75201',now()+interval '2 days',$2)",[id,rate]);
  await q("insert into icash_bot_setups(account_id,profile) values($1,'{\"marketMode\":\"nationwide\"}')",[id]);
  await q("insert into icash_daily_plans(id,account_id,state,mode,consent_version) values($1,$2,'active','live','daily-2026-10-04.1')",[randomUUID(),id]);
 }
 const due=()=>scalar('select icash_outbound_search_due($1) value',[a]);
 assert.equal(await due(),true,'low inbound permits bounded outbound');
 await q('update icash_accounts set bot_paused=true where id=$1',[a]);assert.equal(await due(),false,'pause blocks work');
 await q('update icash_accounts set bot_paused=false where id=$1',[a]);
 await q('update icash_wallets set balance_cents=0 where account_id=$1',[a]);assert.equal(await due(),false,'funds required');
 await q('update icash_wallets set balance_cents=10000 where account_id=$1',[a]);
 await q("update icash_discovery_configs set zip='97201' where account_id=$1",[a]);assert.equal(await due(),false,'excluded ZIP blocks before purchase');
 await q("update icash_discovery_configs set zip='75201' where account_id=$1",[a]);
 const lead=randomUUID();
 await q("insert into icash_seller_intakes(id,state,next_assignment_at,data_rights_until,checked_at,property,phone,customer_costs) values($1,'qualified',now(),now()+interval '2 days',now(),'{\"id\":\"prop_123\",\"city\":\"Dallas\",\"state\":\"TX\",\"zip\":\"75201\"}','+12025550101','{\"dealmachine\":10000}')",[lead]);
 assert.equal(await due(),false,'affordable due inbound gets priority');
 await q("insert into icash_outbound_property_owners(property_id,account_id) values('prop_123',$1)",[b]);assert.equal(await due(),true,'another client exclusive prospect cannot block this account');
 await q('delete from icash_seller_intakes where id=$1',[lead]);
 const screen=randomUUID();
 await q("insert into icash_screening_jobs(id,account_id,state,event_key,created_at,completed_at,snapshot,result) values($1,$2,'complete','discovery:fixture',now(),now(),'{\"propertyId\":\"prop_456\",\"raw\":{\"data\":{\"state\":\"TX\"}}}','{\"financialCheck\":{\"status\":\"eligible\"}}')",[screen,a]);
 const op=`owners:${a}:${screen}`,allowed=()=>scalar('select icash_research_purchase_allowed($1,$2,$3) value',[a,op,enrich]);
 assert.equal(await allowed(),true,'eligible owned research can reserve');
 await q("insert into icash_operation_spend(operation_key,account_id,rate_id,state,charged_cents,created_at) values('fixture-search',$1,$2,'settled',200,now())",[a,rate]);
 assert.equal(await due(),false,'search protects conversation budget');assert.equal(await allowed(),false,'owner enrichment uses the same research cap');
 await q('delete from icash_operation_spend');
 await q("update icash_screening_jobs set snapshot=snapshot||'{\"sellerRequest\":{\"id\":\"fixture\"}}' where id=$1",[screen]);assert.equal(await allowed(),false,'never repurchase submitted seller contact');
 await q("update icash_screening_jobs set snapshot=snapshot-'sellerRequest' where id=$1",[screen]);
 await q("insert into icash_outbound_property_owners(property_id,account_id) values('prop_456',$1)",[b]);assert.equal(await allowed(),false,'outbound property stays exclusive');
 await q('delete from icash_outbound_property_owners');
 await q("insert into icash_screening_jobs(id,account_id,state,event_key,created_at,completed_at,result) values($1,$2,'complete','discovery:fixture2',now(),now(),'{\"financialCheck\":{\"status\":\"eligible\"}}')",[randomUUID(),a]);
 assert.equal(await due(),false,'do not keep buying after the daily pipeline target');
 assert(Number(await scalar('select icash_hybrid_inbound_share(5000) value'))>Number(await scalar('select icash_hybrid_inbound_share(1000) value')),'higher budgets target more inbound');
 // Exercise the real persistence function with synthetic receipt/queue adapters.
 await pg.exec(`create function icash_record_cost_observation(text,text,text,bigint,text) returns void language sql as $$select$$;
 create function icash_enqueue_screening(a uuid,e text,s jsonb,t timestamptz) returns void language sql as $$insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,created_at) values(a,e,s,'queued',now())$$;`);
 const revision=randomUUID();
 await q('update icash_discovery_configs set revision=$1,next_page=1,per_page=5',[revision]);
 const result={rows:[{dm_property_id:'prop_789',state:'TX'},{dm_property_id:'prop_999',state:'OR'}],creditsUsed:2,peopleCredits:0,estimatedCredits:2,fetchedAt:new Date().toISOString(),hasNextPage:true};
 for(const [id,expected] of [[a,1],[b,0]]){
  const key=`discovery:${id}:${revision}:1`;
  await q("insert into icash_operation_spend(operation_key,account_id,rate_id,state,created_at) values($1,$2,$3,'dispatched',now())",[key,id,rate]);
  assert.equal(await scalar('select icash_save_discovery($1,$2,$3,1,$4::jsonb) value',[id,key,revision,JSON.stringify(result)]),expected,'same outbound property is queued for exactly one client; excluded state never queued');
 }
 assert.equal(Number(await scalar("select count(*) value from icash_screening_jobs where snapshot->>'propertyId'='prop_789'")),1);
 assert.equal(Number(await scalar("select count(*) value from icash_outbound_property_owners where property_id='prop_999'")),0);
 assert.equal(await scalar("select has_function_privilege('authenticated','icash_outbound_search_due(uuid)','execute') value"),false,'customer cannot invoke policy RPC');
 console.log('PASS full hybrid migration compiles; inbound priority, budget protection, paused/empty accounts, state parsing, exclusions, pipeline target, exclusive ownership and server-only privileges');
}catch(e){console.error(e.message, e.where??'', e.internalQuery??'');process.exitCode=1;}finally{await pg.close();}
