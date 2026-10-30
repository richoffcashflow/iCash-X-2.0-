import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {discoveryStrategies,selectDiscoveryFilter} from '../lib/discovery-filters.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const sql=read('config/research-market-duplicate-cooling.sql');
assert.equal(sql,read('supabase/migrations/20261030200310_research_market_duplicate_cooling.sql'));
const db=new PGlite(),q=(s,a=[])=>db.query(s,a),v=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const account=id(1),revision=id(2),policy={version:'research-efficiency-v2',exclusionListId:null};
const stats=discoveryStrategies.map(strategy=>({strategy,nextPage:1,exhausted:false,blocked:false,pages:0,attempted:0,matureAttempts:0,pendingAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true,recentUnproductivePages:0}));
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_discovery_configs(account_id uuid primary key,revision uuid,next_page integer,zip text,per_page integer,research_version integer,research_list_id text);
 create table icash_discovery_filter_pages(operation_key text primary key,account_id uuid,zip text,plan jsonb,state text,created_at timestamptz);
 create table icash_discovery_inventory_receipts(operation_key text primary key,account_id uuid,zip text,strategy text,per_page integer,query_policy jsonb,returned_properties integer,queued_properties integer,duplicate_properties integer,created_at timestamptz);
 create table icash_operation_spend(operation_key text primary key,account_id uuid,state text,actual_micros bigint,charged_cents bigint);
 create table fixture_state(value jsonb);
 create function icash_discovery_filter_state_v2(uuid,uuid,integer) returns jsonb language sql as $$select value from public.fixture_state$$;
 `);
 await q('insert into fixture_state values($1)',[stats]);
 await q("insert into icash_discovery_configs values($1,$2,1,'75217',25,2,null)",[account,revision]);
 await db.exec(sql);
 const duplicate=()=>v("select icash_market_duplicate_supply('75217','baseline',25,$1)",[policy]);
 const state=()=>v('select icash_discovery_filter_state_v2($1,$2,1)',[account,revision]);
 const add=async(n,{zip='75217',strategy='baseline',size=25,queryPolicy=policy,queued=0,duplicates=25,returned=25,spendState='settled',pageState='complete',receipt=true,age=100-n,actual=0,charged=0}={})=>{
  // Separate customer accounts demonstrate aggregation without transferring data.
  const owner=id(n+20),key=`page-${n}`;
  await q("insert into icash_discovery_filter_pages values($1,$2,$3,$4,$5,now()-$6*interval '1 minute')",[key,owner,zip,{version:'seller-filters-v1',strategy,providerPage:n,mode:'explore'},pageState,age]);
  await q('insert into icash_operation_spend values($1,$2,$3,$4,$5)',[key,owner,spendState,actual,charged]);
  if(receipt)await q("insert into icash_discovery_inventory_receipts values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()-$10*interval '1 minute')",[key,owner,zip,strategy,size,queryPolicy,returned,queued,duplicates,age]);
 };
 await add(1);await add(2);assert.equal(await duplicate(),false,'Two pages cannot cool an audience');
 await add(3);assert.equal(await duplicate(),true,'Three settled duplicate-only pages across accounts qualify, including actual zero costs');
 let current=await state();assert.equal(current[0].recentUnproductivePages,3);assert.deepEqual(current.slice(1),stats.slice(1));
 assert.equal(await v('select count(*)::int from icash_operation_spend'),3,'Selection never creates paid operations');
 assert.equal(await v('select count(*)::int from icash_discovery_configs'),1,'No cross-account configuration is created');
 // A new account or revision must honor shared waste evidence, but periodic
 // probes must survive even while productive arms are still cold.
 let probes=0;
 for(let sequence=1;sequence<=50;sequence++){
  const selected=selectDiscoveryFilter(current,sequence);
  if(selected.strategy==='baseline'){probes++;assert.equal(sequence%5,4);}
 }
 assert.equal(probes,10);
 const before=await v('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s');
 for(const [n,options,label] of [
  [4,{queued:1,duplicates:24},'A single new property immediately ends the duplicate streak'],
  [5,{spendState:'dispatched'},'Unknown charges are never negative evidence'],
  [6,{pageState:'claimed',receipt:false},'A newer unfinished request breaks the streak before receipt joins'],
  [7,{actual:null},'Missing provider cost is unknown, not zero'],
  [8,{charged:null},'Missing customer charge is unknown, not zero'],
  [9,{size:5},'Different page sizes cannot cool a 25-row query'],
  [10,{queryPolicy:{...policy,version:'research-efficiency-v1'}},'Different query versions cannot cool the current query'],
  [11,{queryPolicy:{...policy,exclusionListId:'list-1'}},'Mutable exclusion pages cannot cool static queries'],
  [12,{returned:0,duplicates:0},'An empty response is not duplicate inventory'],
 ]){
  await add(n,options);assert.equal(await duplicate(),false,label);
  assert.equal((await state())[0].recentUnproductivePages,0,label);
  await q('delete from icash_discovery_inventory_receipts where operation_key=$1',[`page-${n}`]);
  await q('delete from icash_operation_spend where operation_key=$1',[`page-${n}`]);
  await q('delete from icash_discovery_filter_pages where operation_key=$1',[`page-${n}`]);
  assert.equal(await duplicate(),true);
 }
 assert.deepEqual(await v('select jsonb_agg(to_jsonb(s) order by operation_key) from icash_operation_spend s'),before,'Holds and original cost receipts stay unchanged');
 await add(13,{zip:'10001'});await add(14,{strategy:'vacant'});
 assert.equal(await duplicate(),true,'Unrelated ZIPs and strategies do not contaminate the sample');
 await q("update icash_discovery_filter_pages set created_at=now()-interval '25 hours' where operation_key='page-3'");
 assert.equal(await duplicate(),false,'Old duplicate evidence expires');
 await q("update icash_discovery_filter_pages set created_at=now()-interval '1 minute' where operation_key='page-3'");
 await q("update icash_discovery_inventory_receipts set account_id=$1 where operation_key='page-3'",[account]);
 assert.equal(await duplicate(),false,'Receipt account must match the original page and spend');
 await q("update icash_discovery_inventory_receipts set account_id=$1 where operation_key='page-3'",[id(23)]);
 current=stats.map(s=>({...s,blocked:s.strategy==='baseline',recentUnproductivePages:s.strategy==='repairs'?3:0}));
 await q('update fixture_state set value=$1',[current]);
 const preserved=await state();assert.equal(preserved[0].blocked,true);assert.equal(preserved[3].recentUnproductivePages,3,'Local no-owner evidence stays authoritative');
 assert.notEqual(selectDiscoveryFilter(preserved,4).strategy,'baseline','Shared feedback cannot bypass unknown-page fences');
 await q("update icash_discovery_configs set research_list_id='list-1'");assert.deepEqual(await state(),current);
 await q('update fixture_state set value=null');assert.equal(await state(),null,'Disabled filter state passes through');
 for(const role of ['anon','authenticated'])for(const signature of ['icash_discovery_filter_state_v2(uuid,uuid,integer)','icash_filter_state_before_supply_cooling(uuid,uuid,integer)','icash_market_duplicate_supply(text,text,integer,jsonb)'])assert.equal(await v('select has_function_privilege($1,$2,\'execute\')',[role,signature]),false);
 // All-cooled/only-cooled supply remains usable; no outcome winner is fabricated.
 const all=stats.map(s=>({...s,recentUnproductivePages:3}));assert(selectDiscoveryFilter(all,1));
 const only=all.map(s=>({...s,exhausted:s.strategy!=='baseline'}));assert.equal(selectDiscoveryFilter(only,1).strategy,'baseline');
 console.log('PASS market duplicate cooling: bounded original receipts, cross-account aggregate only, unknown-cost fences, fresh-cursor probes, recovery and private access.');
}finally{await db.close();}
