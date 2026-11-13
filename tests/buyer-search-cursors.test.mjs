import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {nextBuyerSearch,nextBuyerSearchFromReceipts,discoverBuyerPage} from '../lib/buyer-discovery.ts';
import {loadService} from './helpers/simulated-journey-services.mjs';
import {dealMachineRequest} from '../lib/dealmachine-request.ts';
import {SharedLearningSafetyHold} from '../lib/shared-learning.ts';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fn=(file,name)=>read(file).match(new RegExp('create (?:or replace )?function public\\.'+name+'\\([\\s\\S]*?end \\$\\$;'))[0];
const A='00000000-0000-4000-8000-000000000001',D='00000000-0000-4000-8000-000000000002',R='00000000-0000-4000-8000-000000000003',S='00000000-0000-4000-8000-000000000004';
const record=(page,strategy,providerPage,more,first='corporate_owners')=>({page,has_next_page:more,receipt:{strategy,providerPage,learningVersion:'shared-v1',firstStrategy:first,zip:'75217'}});
const history=[record(1,'corporate_owners',1,true),record(2,'recent_corporate',1,false)];
assert.equal(nextBuyerSearch(history.at(-1),5,'corporate_owners'),null,'Reproduce old abandonment despite remaining broad results');
assert.deepEqual(nextBuyerSearchFromReceipts(history,5,'corporate_owners'),{page:3,providerPage:2,strategy:'corporate_owners'});
const pg=new PGlite(),q=(s,a=[])=>pg.query(s,a),val=async(s,a=[])=>Object.values((await q(s,a)).rows[0]??{})[0];
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_learning_assignments(account_id uuid,domain text,subject text,variant text,policy_version text default 'shared-v1',market text);
 create table icash_buyer_search_configs(account_id uuid,revision uuid,max_pages integer,per_page integer,enabled boolean,rights_until timestamptz);
 create table icash_buyer_search_receipts(deal_id uuid,revision uuid,page integer,operation_key text,has_next_page boolean,receipt jsonb,primary key(deal_id,revision,page));
 create table icash_accounts(id uuid,bot_paused boolean);
 create table icash_deal_files(id uuid,account_id uuid,screening_id uuid,stage text);
 create table icash_screening_jobs(id uuid,account_id uuid,snapshot jsonb);
 create table icash_signing_envelopes(id uuid,account_id uuid,deal_id uuid,kind text,state text,test_mode boolean);
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_operation_spend(operation_key text primary key,state text,account_id uuid);
 create table fixture_costs(operation_key text primary key,credits numeric);
 create function icash_record_cost_observation(text,text,text,numeric,text) returns void language sql as $$insert into public.fixture_costs values($2,$4) on conflict do nothing$$;`);
 await q("insert into icash_learning_assignments(account_id,domain,subject,variant,market) values($1,'buyer_search',$2,'corporate_owners','75217')",[A,D+':'+R]);
 await q("insert into icash_buyer_search_configs values($1,$2,5,10,true,now()+interval '1 day')",[A,R]);
 await q('insert into icash_accounts values($1,false)',[A]);
 await q("insert into icash_deal_files values($1,$2,$3,'under_contract')",[D,A,S]);
 await q("insert into icash_screening_jobs values($1,$2,'{\"propertyId\":\"prop_fixture\",\"raw\":{\"data\":{\"zip\":\"75217\"}}}')",[S,A]);
 await q("insert into icash_signing_envelopes values($1,$2,$3,'purchase','completed',false)",[S,A,D]);
 await pg.exec(fn('config/platform-shared-learning.sql','icash_shared_buyer_cursor'));
 await pg.exec(fn('config/platform-shared-learning.sql','icash_save_empty_buyer_search'));
 await pg.exec(fn('config/buyer-discovery.sql','icash_save_buyer_search').replace('public.icash_save_buyer_search(', 'public.icash_save_buyer_search_before_shared(').replace("p_operation<>'buyers:'||p_deal||':'||p_revision||':'||p_page then", "p_operation<>'buyers:'||p_deal||':'||p_revision||':'||p_page||(case when p_receipt->>'strategy'='corporate_owners' then ':corporate' else '' end) then"));
 await pg.exec(fn('config/platform-shared-learning.sql','icash_save_buyer_search'));
 const seed=async(rows,first='corporate_owners')=>{
  await q('delete from icash_buyer_search_receipts');
  await q('update icash_learning_assignments set variant=$1',[first]);
  for(const row of rows)await q('insert into icash_buyer_search_receipts(deal_id,revision,page,has_next_page,receipt) values($1,$2,$3,$4,$5)',[D,R,row.page,row.has_next_page,JSON.stringify(row.receipt)]);
 };
 const permitted=(c,account=A)=>val('select icash_shared_buyer_cursor($1,$2,$3,$4,$5,$6)',[account,D,R,c.page,c.strategy,c.providerPage]);
 await seed(history);
 const fallback={page:3,strategy:'corporate_owners',providerPage:2};
 assert.equal(await permitted(fallback),false,'Old database rejects continuation');
 await pg.exec(read('config/buyer-search-independent-cursors.sql'));
 assert.equal(await permitted(fallback),true);
 assert.equal(await permitted(fallback,S),false,'Cross-account history cannot authorize a cursor');
 assert.equal(await val("select has_function_privilege('authenticated','icash_shared_buyer_cursor(uuid,uuid,uuid,integer,text,integer)','execute')"),false);
 assert.equal(await val("select provolatile='s' and not prosecdef from pg_proc where oid='icash_shared_buyer_cursor(uuid,uuid,uuid,integer,text,integer)'::regprocedure"),true);
 const before=await val('select jsonb_agg(to_jsonb(r) order by page) from icash_buyer_search_receipts r');
 await q("select icash_save_empty_buyer_search($1,$2,$3,3,'corporate_owners',2,'75217')",[A,D,R]);
 await q("select icash_save_empty_buyer_search($1,$2,$3,3,'corporate_owners',2,'75217')",[A,D,R]);
 assert.equal(await val('select count(*) from icash_buyer_search_receipts'),3,'Duplicate empty receipt is idempotent');
 assert.deepEqual(await val('select jsonb_agg(to_jsonb(r) order by page) from icash_buyer_search_receipts r where page<3'),before,'Original receipts unchanged');
 await assert.rejects(q("select icash_save_empty_buyer_search($1,$2,$3,4,'corporate_owners',3,'75217')",[A,D,R]),/Shared buyer cursor/);
 // Exhaust every complete current-policy history through the unchanged five-page cap.
 let cases=0;
 for(const first of ['recent_corporate','corporate_owners']){
  const pending=[[]];
  while(pending.length){
   const rows=pending.shift(),next=nextBuyerSearchFromReceipts(rows,5,first);await seed(rows,first);cases++;
   if(next){assert.equal(await permitted(next),true);for(const more of [false,true])pending.push([...rows,record(next.page,next.strategy,next.providerPage,more,first)]);}
   for(const strategy of ['recent_corporate','corporate_owners'])for(let providerPage=1;providerPage<=5;providerPage++){
    assert.equal(await permitted({page:rows.length+1,strategy,providerPage}),!!next&&strategy===next.strategy&&providerPage===next.providerPage,'SQL and app select the same single next page');
   }
  }
 }
 for(const bad of [history.slice(1),[history[0],{...history[1],page:1}],[history[0],record(2,'corporate_owners',2,false)],
  [history[0],{...history[1],receipt:{...history[1].receipt,providerPage:'1'}}],[record(1,'corporate_owners',1,false),history[1],record(3,'corporate_owners',2,true)],
  [history[0],{...history[1],receipt:{...history[1].receipt,firstStrategy:'recent_corporate'}}]]){
  assert.throws(()=>nextBuyerSearchFromReceipts(bad,5,'corporate_owners'),/REVIEW_REQUIRED/);
  await seed(bad.filter((r,i)=>bad.findIndex(x=>x.page===r.page)===i));assert.equal(await permitted(fallback),false);
 }
 assert.deepEqual(nextBuyerSearchFromReceipts([{page:1,has_next_page:true,receipt:{}}],5),nextBuyerSearch({page:1,has_next_page:true,receipt:{}},5),'Legacy receipts retain old semantics');
 // Actual service + provider protocol, SQL cursor and real empty persistence.
 process.env.ICASH_LIVE_WORK_READY='true';process.env.DEALMACHINE_API_KEY='fixture-no-network';
 let requests=[],sqlEnabled=true,claimAllowed=true,existingState=null,assignHeld=false,settled=[];
 const db=async(path,method='GET',body)=>{
  if(path==='rpc/icash_shared_buyer_cursor')return sqlEnabled&&await permitted({page:body.p_page,strategy:body.p_strategy,providerPage:body.p_provider_page});
  if(path==='rpc/icash_save_empty_buyer_search')return q('select icash_save_empty_buyer_search($1,$2,$3,$4,$5,$6,$7)',[body.p_account,body.p_deal,body.p_revision,body.p_page,body.p_strategy,body.p_provider_page,body.p_zip]);
  if(path==='rpc/icash_take_dealmachine_request')return true;
  if(path==='rpc/icash_finish_dealmachine_request')return null;
  if(path==='rpc/icash_reserve_operation')return q("insert into icash_operation_spend values($1,'reserved',$2) on conflict do nothing",[body.p_operation,body.p_account]);
  if(path==='rpc/icash_claim_buyer_search'){if(!claimAllowed)return false;return (await q("update icash_operation_spend set state='dispatched' where operation_key=$1 and state='reserved' returning operation_key",[body.p_operation])).rows.length===1;}
  if(path==='rpc/icash_save_buyer_search')return q('select icash_save_buyer_search($1,$2,$3,$4,$5,$6)',[body.p_account,body.p_deal,body.p_revision,body.p_page,body.p_operation,JSON.stringify(body.p_receipt)]);
  if(path==='rpc/icash_settle_dealmachine_usage'){settled.push(body.p_operation);return null;}
  if(path.startsWith('icash_buyer_search_configs?'))return [{enabled:true,rights_until:new Date(Date.now()+86400000).toISOString(),revision:R,max_pages:5,per_page:10,since:'2025-01-01',unit_cost_micros:1000,rate_id:'rate'}];
  if(path.startsWith('icash_deal_files?'))return [{screening_id:S,stage:'under_contract'}];
  if(path.startsWith('icash_accounts?'))return [{bot_paused:false}];
  if(path.startsWith('icash_signing_envelopes?'))return [{id:S}];
  if(path.startsWith('icash_screening_jobs?'))return [{snapshot:{propertyId:'prop_fixture',raw:{data:{zip:'75217'}}}}];
  if(path.startsWith('icash_property_controls?'))return [];
  if(path.startsWith('icash_buyer_search_receipts?')){assert(path.includes('order=page.asc&limit=6'));return (await q('select page,has_next_page,receipt from icash_buyer_search_receipts order by page')).rows;}
  if(path.startsWith('icash_operation_spend?'))return existingState?[{state:existingState}]:[];
  if(path.startsWith('icash_operation_rates?'))return [{enabled:true,operation:'buyer_discovery',expires_at:new Date(Date.now()+86400000).toISOString(),costs_micros:{dealmachine:10000}}];
  throw Error('Unexpected fixture call '+path);
 };
 let estimate=0,paidFailure=false;
 const fetch=async(url,options)=>{assert.equal(url,'https://api.v2.dealmachine.com/v1/properties/search');const body=JSON.parse(options.body);requests.push(body);if(!body.estimate_cost){if(paidFailure)throw Error('uncertain fixture receipt');return Response.json({data:[],credits:{used:1,people:1,properties:0},pagination:{has_next_page:true}});}return Response.json({estimated_credits:{this_page:estimate,breakdown:{properties:0,people:estimate}}});};
 const service=await loadService('lib/buyer-discovery-service.ts',{db,fetch,dealMachineRequest,nextBuyerSearchFromReceipts,discoverBuyerPage,SharedLearningSafetyHold,assignSharedLearning:async()=>{if(assignHeld)throw new SharedLearningSafetyHold();return {variant:'corporate_owners',version:'shared-v1',mode:'explore'};}});
 await seed(history);sqlEnabled=false;assert.equal((await service.discoverBuyersForDeal(A,D)).status,'buyer_cursor_review_required');assert.equal(requests.length,0,'Mixed deployment holds before requests');
 sqlEnabled=true;assignHeld=true;assert.equal((await service.discoverBuyersForDeal(A,D)).status,'learning_safety_hold');assert.equal(requests.length,0);assignHeld=false;
 existingState='dispatched';assert.equal((await service.discoverBuyersForDeal(A,D)).status,'buyer_receipt_reconciliation_required');assert.equal(requests.length,0);existingState=null;
 assert.equal((await service.discoverBuyersForDeal(A,D)).status,'no_candidates');assert.equal(requests.length,1);assert.equal(requests[0].page,2);assert.deepEqual(requests[0].filters,[{filter_id:'is_corporate_owned',value:true}]);
 assert.equal((await service.discoverBuyersForDeal(A,D)).status,'buyer_search_complete');assert.equal(requests.length,1,'Exhausted sources are not searched again');
 // The first two empty/search outcomes must schedule a remaining cursor immediately.
 await seed([history[0]]);requests=[];assert.equal((await service.discoverBuyersForDeal(A,D)).canContinue,true,'An empty second strategy keeps the unfinished first strategy due');
 await seed(history);requests=[];estimate=1;claimAllowed=false;assert.equal((await service.discoverBuyersForDeal(A,D)).status,'held');assert.equal(requests.length,1,'Final admission still prevents paid request');
 claimAllowed=true;requests=[];
 assert.equal((await service.discoverBuyersForDeal(A,D)).canContinue,true);
 assert.equal(requests.length,2);assert.equal(requests[1].page,2);
 const saved=(await q('select * from icash_buyer_search_receipts where page=3')).rows[0];
 assert.equal(saved.operation_key,`buyers:${D}:${R}:3:corporate`);assert.equal(saved.receipt.providerPage,2);assert.equal(saved.has_next_page,true);
 assert.deepEqual(settled,[saved.operation_key]);assert.equal(Number(await val('select credits from fixture_costs')),1);
 await q('select icash_save_buyer_search($1,$2,$3,3,$4,$5)',[A,D,R,saved.operation_key,JSON.stringify({...saved.receipt,candidates:[]})]);
 assert.equal(await val('select count(*) from icash_buyer_search_receipts'),3,'Paid receipt replay remains idempotent');
 await q('delete from icash_operation_spend');await seed(history);
 claimAllowed=true;requests=[];paidFailure=true;await assert.rejects(service.discoverBuyersForDeal(A,D),/uncertain/);assert.equal(requests.length,2,'One estimate and one paid attempt, no retry');
 console.log(`PASS buyer independent cursors: ${cases} complete histories, SQL/app parity, original receipts, bounded fallback, actual service dispatch and mixed-release holds.`);
}finally{await pg.close();}
