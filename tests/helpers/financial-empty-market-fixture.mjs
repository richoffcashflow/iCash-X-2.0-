import {readFileSync} from 'node:fs';
import * as base from './financial-prequalification-fixture.mjs';
export {account,other,revision,scope,plan} from './financial-prequalification-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const policy={...base.policy,tier:2};
const narrowQuery=JSON.parse(read('tests/fixtures/financial-free-query.json'));
const tierQuery=tier=>({...narrowQuery,filters:narrowQuery.filters.filter(x=>tier===0||x.filter_id!=='has_absentee_owners').filter(x=>tier<2||x.filter_id!=='last_sale_date').map(x=>x.filter_id==='estimated_equity_percentage'?{...x,value:[90,80,70][tier]}:x.filter_id==='last_sale_date'&&tier===1?{...x,value:'2019-11-10'}:x)});
export const query=tierQuery(2);
export const empty={...base.empty,pagination:{total_results:0,has_next_page:false}};
export const operation=`discovery:${base.account}:${base.revision}:1`;
export const proofTable='icash_research_private.empty_financial_markets';
export const migration=read('config/financial-empty-market.sql');
export const setupSql=`create role anon;create role authenticated;create role service_role;`+base.setupSql+base.migration+`
 alter table public.icash_discovery_configs add primary key(account_id);
 alter table public.icash_inventory_markets add column eligible_until timestamptz,add column priority integer;
 create function public.icash_inventory_scope_allowed(uuid,text) returns boolean language sql stable as $$select $2 in('75217','75218')$$;
 create function public.icash_opportunity_market_score(uuid,text) returns numeric language sql stable as $$select 0::numeric$$;
 `+JSON.parse(read('tests/fixtures/financial-empty-market-before.json')).map(x=>x.definition+';').join('\n');
const json=x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
// Synthetic predecessor evidence establishes tier2 through the real widening
// function; no production source is copied into this fixture.
let widening='';
for(let tier=0;tier<2;tier++){
 const p={...base.policy,tier},q=tierQuery(tier);
 widening+=`do $seed$ declare token uuid;begin
 token:=(public.icash_claim_discovery_estimate('${base.account}',${json(base.scope)},${json(base.plan)},${json(p)},${json(q)})->>'token')::uuid;
 if token is null or not public.icash_finish_discovery_estimate('${base.account}',token,${json(empty)}) then raise exception 'Fixture estimate failed';end if;
 if not public.icash_widen_financial_query('${base.account}',${json(base.scope)},${json(base.plan)},${json(p)}) then raise exception 'Fixture widening failed';end if;
 end $seed$;`;
}
export const seedSql=base.seedSql+base.activateSql+`
 insert into public.icash_inventory_markets(account_id,zip,next_scan_at,eligible_until,priority)
 values('${base.account}','75217',now()-interval '1 day',now()+interval '1 day',1),
 ('${base.account}','75218',now()-interval '1 day',now()+interval '1 day',2);
 insert into public.icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page,exhausted,pages)
 select '${base.account}','${base.revision}','75217',strategy,1,false,0 from unnest(array['vacant','absentee','repairs'])strategy;
 `+widening+`do $seed$ declare token uuid;begin
 token:=(public.icash_claim_discovery_estimate('${base.account}',${json(base.scope)},${json(base.plan)},${json(policy)},${json(query)})->>'token')::uuid;
 if token is null or not public.icash_finish_discovery_estimate('${base.account}',token,${json(empty)}) then raise exception 'Fixture broad estimate failed';end if;
 end $seed$;`;
