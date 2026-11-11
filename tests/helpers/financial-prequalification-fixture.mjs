import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as base from './targeting-query-binding-fixture.mjs';
export {account,other,revision,scope} from './targeting-query-binding-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const predecessors=JSON.parse(read('tests/fixtures/financial-prequalification-before.json'));
export const plan={version:'seller-filters-v1',strategy:'baseline',providerPage:1,mode:'explore'};
export const policy={version:'financial-prefilter-v1',exclusionListId:'fixture-list',asOf:'2026-11-10',tier:0};
export const migration=read('config/dealmachine-financial-prequalification.sql')+read('config/financial-query-single-filter.sql');
export const setupSql=base.setupSql+base.migration+`
 alter table icash_accounts add primary key(id);
 alter table icash_screening_jobs add primary key(id);
 alter table icash_research_private.estimates add primary key(operation_key),add column exclusion_synced_at timestamptz,add column token uuid,
  add column lease_until timestamptz,add column retry_at timestamptz,add column response jsonb,add column saved_at timestamptz,
  add column updated_at timestamptz default now(),add column shared_hits integer not null default 0;
 `+predecessors.filter(x=>['icash_claim_discovery_estimate','icash_targeting_query_context','icash_reserve_research_discovery'].includes(x.proname)).map(x=>x.definition+';').join('\n')
 +JSON.parse(read('tests/fixtures/financial-exclusions-before.json')).definition+';'
 +read('config/research-request-reuse.sql').match(/create function public\.icash_finish_discovery_estimate\([\s\S]*?\$\$;/)[0]
 +read('tests/fixtures/financial-targeting-filters-before.sql');
const nativeQuery=JSON.parse(read('tests/fixtures/financial-free-query.json'));
const filters=[...new Map(nativeQuery.filters.map(f=>[f.filter_id,{filter_id:f.filter_id,type:typeof f.value==='boolean'?'BOOLEAN':['market_status','property_type'].includes(f.filter_id)?'MULTI_SELECT':f.filter_id==='last_sale_date'?'DATE':'NUMBER',allowed_operators:f.operator?[f.operator]:['is_boolean'],is_premium_filter:false,...(f.filter_id==='market_status'?{options:[{option_id:6,label:'Off Market'}]}:{})}])).values()];
export const seedSql=base.seedSql+base.activateSql+`update icash_integration_checks set checked_at=now(),result=jsonb_build_object('status','verified','catalogVersion',4,'checkedAt',now(),'plan','{"name":"Fixture","is_paid":true}'::jsonb,'filters','${JSON.stringify(filters)}'::jsonb);`;
export const activateSql=`update icash_research_private.financial_settings set enabled=true,as_of='${policy.asOf}',release_sha=repeat('a',40),activated_at=now() where id=1;`;
export async function queryFor(p=policy,selected=plan){const {discoverPage}=await import('../../lib/discovery-pipeline.ts');let query;await discoverPage({zip:'75217',page:1,perPage:5,unitCostMicros:10000,quotedDataCostMicros:50000,filterPlan:selected,queryPolicy:p},{request:async body=>{query=body;return {estimated_credits:{this_page:0,breakdown:{people:0}}};},reserveAndClaim:async()=>{throw Error('Fixture attempted purchase');},persist:async()=>{throw Error('Fixture persisted purchase');}});return query;}
export const empty={estimated_credits:{this_page:0,breakdown:{people:0}},totals:{properties:0},pagination:{total_results:0}};
export const positive={estimated_credits:{this_page:5,breakdown:{people:0}},totals:{properties:50},pagination:{total_results:50}};
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify({setupSql,seedSql,migration,activateSql,account:base.account,other:base.other,revision:base.revision,scope:base.scope,plan,policy,query:nativeQuery,empty,positive}));
