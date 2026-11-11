import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import * as f from './helpers/financial-prequalification-fixture.mjs';
import {combineFinancialFilters} from '../lib/financial-query-filters.ts';
import {discoveryFilters} from '../lib/discovery-filters.ts';
import {financialPrefilters,researchEligibilityFilters} from '../lib/research-query-policy.ts';
import {targetingFilters,selectTargetingPlan} from '../lib/dealmachine-targeting.ts';
const pg=new PGlite();await pg.exec('create role anon;create role authenticated;create role service_role;');await pg.exec(f.setupSql);await pg.exec(f.migration);await pg.exec(f.seedSql);await pg.exec(f.activateSql);
const value=async(sql,args=[])=>Object.values((await pg.query(sql,args)).rows[0])[0];
const compare=async input=>{const normalized=combineFinancialFilters(input);assert.deepEqual(await value('select icash_research_private.combine_financial_filters($1)',[input]),normalized);if(normalized)assert.equal(new Set(normalized.map(f=>f.filter_id)).size,normalized.length);return normalized;};
const segments=['off_market','sale_7_10','sale_10_plus','out_of_state_absentee','vacant_absentee','out_of_state_old_sale','off_market_repairs','mobile'];
const id='11111111-1111-4111-8111-111111111111';
for(let tier=0;tier<3;tier++){
 const policy={...f.policy,tier};
 for(const strategy of ['baseline','vacant','absentee','repairs']){
  const plan={...f.plan,strategy};const raw=[...discoveryFilters(strategy),...researchEligibilityFilters(policy.version),...financialPrefilters(policy,strategy==='repairs'?25000:0)];
  const normalized=await compare(raw);assert(normalized);
  assert.equal(normalized.find(x=>x.filter_id==='estimated_equity_percentage').value,tier===0?90:tier===1?80:70);
  assert.equal(normalized.find(x=>x.filter_id==='estimated_repair_cost').value,strategy==='repairs'?25000:0);
  const query=await f.queryFor(policy,plan);assert.deepEqual(query.filters,normalized);
  assert.equal(await value('select icash_research_private.financial_query_valid($1,$2,$3,$4)',[query,policy,plan,f.scope]),true);
  for(const bad of [raw,[...normalized,normalized[0]],normalized.filter(x=>x.filter_id!=='has_active_lien'),normalized.map(x=>x.filter_id==='estimated_equity_percentage'?{...x,value:69}:x)]){
   if(JSON.stringify(bad)===JSON.stringify(normalized))continue;
   assert.equal(await value('select icash_research_private.financial_query_valid($1,$2,$3,$4)',[{...query,filters:bad},policy,plan,f.scope]),false);
  }
 }
 for(const segment of segments){
  const targeting={id,segment,asOf:'2026-11-09'},plan={version:'seller-targeting-v1',strategy:'target_'+id,providerPage:1,mode:'explore',targeting};
  const raw=[...discoveryFilters(),...targetingFilters(targeting),...researchEligibilityFilters(policy.version),...financialPrefilters(policy,segment==='off_market_repairs'?25000:0)];
  const normalized=await compare(raw);assert(normalized,segment+' tier '+tier);
  const query=await f.queryFor(policy,plan);assert.deepEqual(query.filters,normalized);
  assert.equal(await value('select icash_research_private.financial_query_valid($1,$2,$3,$4)',[query,policy,plan,f.scope]),true,segment+' tier '+tier);
 }
}
for(const input of [
 [{filter_id:'has_active_lien',value:false},{filter_id:'has_active_lien',value:true}],
 [{filter_id:'estimated_value',operator:'range',value:{min:10000,max:50000}},{filter_id:'estimated_value',operator:'greater_than',value:14285.72}],
 [{filter_id:'last_sale_date',operator:'date_range',value:{start:'2016-11-10',end:'2019-11-10'}},{filter_id:'last_sale_date',operator:'is_before',value:'2016-11-10'}],
])assert.equal(await compare(input),null,'Unrepresentable/empty intersections never weaken a required rule');
for(const input of [
 [{filter_id:'estimated_value',operator:'range',value:{min:20000,max:50000}},{filter_id:'estimated_value',operator:'greater_than',value:14285.72}],
 [{filter_id:'estimated_value',operator:'greater_than_or_equal',value:30000},{filter_id:'estimated_value',operator:'range',value:{min:20000,max:50000}}],
 [{filter_id:'estimated_value',operator:'greater_than_or_equal',value:5},{filter_id:'estimated_value',operator:'greater_than',value:5}],
])assert(await compare(input));
const legacy=['baseline','vacant','absentee','repairs'].map(strategy=>({strategy,nextPage:1,exhausted:false,pages:0,attempted:0,matureAttempts:0,pendingAttempts:0,interested:0,optedOut:0,costCents:0,costsComplete:true,recentUnproductivePages:0}));
const definition={id,segment:'sale_7_10',asOf:'2026-11-10'};
const capabilities={status:'verified',checkedAt:new Date().toISOString(),plan:{name:'Fixture',is_paid:true},filters:[{filter_id:'last_sale_date',type:'DATE',allowed_operators:['date_range'],is_premium_filter:false}]};
const selected=selectTargetingPlan(legacy,1,[],{enabled:true,dedupReady:true,capabilities,queryContext:{policy:f.policy},experiments:[{definition,nextPage:1,pages:0,exhausted:false,blocked:false}]},f.account,'75217');
assert.equal(selected.version,'seller-filters-v1','An impossible experiment must yield to another eligible audience instead of stalling the account');
for(const role of ['anon','authenticated','service_role'])assert.equal(await value('select has_function_privilege($1,$2,$3)',[role,'icash_research_private.combine_financial_filters(jsonb)','EXECUTE']),false);
await pg.close();console.log('PASS financial query filters: 36 query combinations, unique field IDs, strict intersections, exact SQL admission, unavailable-arm fallback and private ACLs.');
