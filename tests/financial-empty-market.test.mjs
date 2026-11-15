import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/financial-empty-market-fixture.mjs';
import {queryFor} from './helpers/financial-prequalification-fixture.mjs';
const pg=new PGlite(),v=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0]??{})[0];
const finish=(scope=f.scope,plan=f.plan,policy=f.policy,account=f.account)=>v('select public.icash_finish_empty_financial_market($1,$2,$3,$4)',[account,scope,plan,policy]);
const rows=table=>v(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) from ${table} t`);
const scenario=async work=>{await pg.exec('begin');try{await work();}finally{await pg.exec('rollback');}};
try{
 assert.deepEqual(f.query,await queryFor(f.policy),'Dependency-free native query matches the actual service builder');
 // Check the implication against both actual builders, including range
 // intersections and the higher repairs floor, rather than a shadow optimizer.
 const definitions=['off_market','sale_7_10','sale_10_plus','buyer_fit','out_of_state_absentee','vacant_absentee','out_of_state_old_sale','off_market_repairs','mobile'].map((segment,index)=>({
  id:`00000000-0000-4000-8000-${String(index+100).padStart(12,'0')}`,segment,asOf:'2026-11-10',
  ...(segment==='buyer_fit'?{ranges:{estimated_value:{min:50000,max:300000},num_bedrooms:{min:2,max:5}},buyerEvidence:{accountId:f.account,buyerId:f.other,sourceReference:'fixture-buyer-requirements',observedAt:'2026-11-10T00:00:00Z',expiresAt:'2026-11-20T00:00:00Z',zips:['75217']}}:{}),
 }));
 const plans=[...['vacant','absentee','repairs'].map(strategy=>({...f.plan,strategy})),...definitions.map(targeting=>({version:'seller-targeting-v1',strategy:'target_'+targeting.id,providerPage:1,mode:'explore',targeting}))];
 const candidateQueries=await Promise.all(plans.map(plan=>queryFor(f.policy,plan)));
 for(const candidate of candidateQueries){
  assert.deepEqual({...candidate,filters:[]},{...f.query,filters:[]},'All non-filter query scope stays equal');
  for(const broad of f.query.filters){
   const narrow=candidate.filters.find(filter=>filter.filter_id===broad.filter_id);assert(narrow,'Broad predicate retained: '+broad.filter_id);
   if(JSON.stringify(narrow)===JSON.stringify(broad))continue;
   assert(['greater_than','greater_than_or_equal'].includes(broad.operator),'Only numeric lower constraints can differ from broad baseline');
   if(narrow.operator==='range')assert(narrow.value.min>broad.value||narrow.value.min===broad.value&&broad.operator==='greater_than_or_equal');
   else{assert(['greater_than','greater_than_or_equal'].includes(narrow.operator));assert(narrow.value>broad.value||narrow.value===broad.value&&(narrow.operator==='greater_than'||broad.operator==='greater_than_or_equal'));}
  }
 }
 await pg.exec(f.setupSql);await pg.exec(f.seedSql);
 for(let i=0;i<plans.length;i++)assert.equal(await v('select icash_research_private.financial_query_valid($1,$2,$3,$4)',[candidateQueries[i],f.policy,plans[i],f.scope]),true,'SQL builder agrees with subset query: '+plans[i].strategy);
 // Failing-before reproduction: a broad, current zero-total page leaves four
 // narrower cursors live and keeps the account on the same empty market.
 await scenario(async()=>{
  assert.equal(await v('select public.icash_finish_empty_filter($1,$2,1,$3,\'empty\')',[f.account,f.revision,f.plan]),true);
  assert.equal(await v('select zip from public.icash_discovery_configs where account_id=$1',[f.account]),'75217');
  assert.equal(await v('select count(*)::int from public.icash_discovery_filter_cursors where account_id=$1 and revision=$2 and not exhausted',[f.account,f.revision]),4);
 });
 const originalFunctions=await v("select jsonb_object_agg(p.oid::regprocedure::text,md5(pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','icash_research_private') and p.prokind='f'");
 await pg.exec(f.migration);
 for(const [signature,hash] of Object.entries(originalFunctions))assert.equal(await v('select md5(pg_get_functiondef($1::regprocedure))',[signature]),hash,'Original function unchanged: '+signature);
 await scenario(async()=>{
  for(const definition of definitions){
   await pg.query('insert into icash_research_private.targeting_experiments(id,definition,created_by) values($1,$2,$3)',[definition.id,definition,f.account]);
   await pg.query("insert into public.icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page,exhausted,pages) values($1,$2,'75217',$3,1,false,0)",[f.account,f.revision,'target_'+definition.id]);
  }
  assert.equal(await finish(),true,'All reviewed target segments are covered, including buyer ranges, repairs and mobile');
  assert.equal(await v('select count(*)::int from public.icash_discovery_filter_pages'),1);
  assert.equal(await v("select sum(pages)::int from public.icash_discovery_filter_cursors where account_id=$1 and revision=$2 and strategy<>'baseline'",[f.account,f.revision]),0);
 });
 const source=await rows('icash_research_private.estimates'),wallets=await rows('public.icash_wallets');
 await scenario(async()=>{
  assert.equal(await finish(),true);
  assert.equal(await finish(),false,'Concurrent/repeated original cannot finalize twice');
  assert.equal(await v('select public.icash_finish_empty_filter($1,$2,1,$3,\'empty\')',[f.account,f.revision,f.plan]),false,'Lost success response followed by legacy fallback cannot finalize the old scope again');
  assert.equal(await v('select zip from public.icash_discovery_configs where account_id=$1',[f.account]),'75218');
  assert.equal(await v('select count(*)::int from public.icash_discovery_filter_pages'),1,'Only actual baseline observation is a page');
  assert.equal(await v('select sum(pages)::int from public.icash_discovery_filter_cursors where account_id=$1 and revision=$2',[f.account,f.revision]),1,'Skipped arms do not become observations');
  assert.equal(await v('select count(*)::int from icash_research_private.empty_financial_markets'),1);
  const proof=await v('select to_jsonb(t) from icash_research_private.empty_financial_markets t');
  assert.deepEqual(proof.query,f.query);assert.deepEqual(proof.response,f.empty);assert.equal(proof.cursors.length,5);
  assert.deepEqual(await rows('icash_research_private.estimates'),source);assert.deepEqual(await rows('public.icash_wallets'),wallets);
  assert.equal(await v('select count(*)::int from public.icash_operation_spend'),0);
  for(const action of ['update icash_research_private.empty_financial_markets set zip=zip','delete from icash_research_private.empty_financial_markets','truncate icash_research_private.empty_financial_markets']){
   await pg.exec('savepoint immutable');await assert.rejects(pg.exec(action),/immutable/);await pg.exec('rollback to immutable');
  }
 });
 for(const mutation of [
  'update public.icash_accounts set bot_paused=true',
  'update public.icash_wallets set reserved_cents=balance_cents',
  "update fixture_gates set allowed=false where name in('membership','due','market')",
  'update icash_research_private.financial_settings set enabled=false',
  "update icash_research_private.exclusions set last_synced_at=now()+interval '1 second'",
  "update icash_research_private.exclusions set state='pending'",
  'update icash_research_private.exclusions set token=gen_random_uuid()',
  "update icash_research_private.estimates set saved_at=clock_timestamp()-interval '5 minutes 1 second'",
  "update icash_research_private.estimates set saved_at=now()+interval '1 second'",
  "update icash_research_private.estimates set shared_from_operation='original-peer'",
  'update icash_research_private.estimates set token=gen_random_uuid()',
  "update icash_research_private.estimates set response=response-'totals'",
  "update icash_research_private.estimates set response=jsonb_set(response,'{pagination,total_results}','1')",
  "update icash_research_private.estimates set response=jsonb_set(response,'{pagination,has_next_page}','true')",
  "update icash_research_private.estimates set response=jsonb_set(response,'{estimated_credits,breakdown,people}','1')",
  "update icash_research_private.estimates set query=jsonb_set(query,'{page}','2')",
  "update icash_research_private.estimates set query=jsonb_set(query,'{filters}','[]')",
  "update public.icash_discovery_filter_cursors set zip='99999' where strategy='vacant'",
  "update public.icash_discovery_filter_cursors set strategy='target_00000000-0000-4000-8000-000000009999' where strategy='vacant'",
  "create or replace function icash_research_private.financial_filters(p_policy jsonb,p_plan jsonb default null) returns jsonb language sql immutable as $$select '[]'::jsonb$$",
 ])await scenario(async()=>{
  await pg.exec(mutation);const before=await rows('public.icash_discovery_filter_cursors');
  assert.equal(await finish(),false,mutation);assert.deepEqual(await rows('public.icash_discovery_filter_cursors'),before);
  assert.equal(await v('select count(*)::int from icash_research_private.empty_financial_markets'),0);
 });
 for(const state of ['reserved','dispatched','cancelled','settled'])await scenario(async()=>{
  await pg.query('insert into public.icash_operation_spend(operation_key,account_id,state) values($1,$2,$3)',[f.operation,f.account,state]);
  assert.equal(await finish(),false,'No spend state allowed on current free operation: '+state);
 });
 for(const state of ['reserved','dispatched'])await scenario(async()=>{
  await pg.query('insert into public.icash_operation_spend(operation_key,account_id,state) values($1,$2,$3)',[`discovery:${f.account}:${f.revision}:999`,f.account,state]);
  assert.equal(await finish(),false,'Unknown other-arm operation retained: '+state);
 });
 await scenario(async()=>{
  await pg.query("insert into public.icash_discovery_filter_pages(operation_key,account_id,revision,sequence,zip,plan,state) values('claimed-other-arm',$1,$2,999,'75217',$3,'claimed')",[f.account,f.revision,{...f.plan,strategy:'vacant'}]);
  assert.equal(await finish(),false,'Claimed arm with no spend row is still uncertain');
 });
 for(const args of [[{...f.scope,p_zip:'75218'}],[f.scope,{...f.plan,providerPage:2}],[f.scope,{...f.plan,strategy:'vacant'}],[f.scope,f.plan,{...f.policy,tier:1}],[f.scope,f.plan,f.policy,f.other]])await scenario(async()=>assert.equal(await finish(...args),false,'Wrong original scope rejected'));
 await scenario(async()=>{
  await pg.exec("delete from public.icash_inventory_markets where zip='75218'");assert.equal(await finish(),true);
  assert.equal(await v('select exhausted from public.icash_discovery_configs where account_id=$1',[f.account]),true,'No authorized alternate does not invent a market');
 });
 for(const role of ['anon','authenticated'])assert.equal(await v("select has_function_privilege($1,'public.icash_finish_empty_financial_market(uuid,jsonb,jsonb,jsonb)','execute')",[role]),false);
 for(const role of ['anon','authenticated','service_role'])assert.equal(await v("select has_table_privilege($1,'icash_research_private.empty_financial_markets','select,insert,update,delete')",[role]),false);
 console.log('PASS financial empty market: baseline-only receipt, current scope/generation/controls, all-arm unknown holds, immutable proof, no invented arm outcomes, ordinary safe market rotation.');
}finally{await pg.close();}
