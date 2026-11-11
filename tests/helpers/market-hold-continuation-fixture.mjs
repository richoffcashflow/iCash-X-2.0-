import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as base from './financial-prequalification-fixture.mjs';
export {account,other,revision,scope,plan,policy,queryFor,positive} from './financial-prequalification-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const definitions=JSON.parse(read('tests/fixtures/market-hold-continuation-before.json'));
export const setupSql=base.setupSql+base.migration+`
 alter table public.icash_discovery_configs add primary key(account_id);
 alter table public.icash_market_shortlist add column city text;
 alter table public.icash_inventory_markets add column priority integer default 1,add column eligible_until timestamptz default '2099-01-01',add primary key(account_id,zip);
 create table fixture_scores(zip text primary key,score numeric not null default 0);
 create function public.icash_opportunity_market_score(uuid,text) returns numeric language sql stable as $$select coalesce((select score from public.fixture_scores where zip=$2),0)$$;
 `+definitions.map(x=>x.definition+';').join('\n');
export const seedSql=base.seedSql+base.activateSql+`
 update public.icash_operating_budget set enabled=true;
 update public.icash_bot_setups set profile='{"marketMode":"nationwide"}';
 insert into public.icash_inventory_markets(account_id,zip,next_scan_at,priority) values('${base.account}','90210',now(),2),('${base.account}','10001',now(),1),('${base.account}','75217',now(),0);
 insert into public.icash_operation_spend(operation_key,account_id,state,dispatched_at,charge_cap_cents,reserved_micros)
 values('discovery:${base.other}:${base.other}:1','${base.other}','dispatched',now()-interval '2 days',500,500000);
 insert into public.icash_discovery_filter_pages(operation_key,account_id,revision,sequence,zip,plan,state)
 values('discovery:${base.other}:${base.other}:1','${base.other}','${base.other}',1,'75217','{"version":"seller-filters-v1","strategy":"baseline"}','claimed');
 `;
export const migration=read('config/market-hold-continuation.sql');
export const activateSql="update icash_research_private.market_hold_continuation_settings set enabled=true,release_sha=repeat('a',40),activated_at=now() where id=1;";
export const claimSql=`select public.icash_continue_held_inventory('${base.account}','${base.revision}',1);`;
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify({setupSql,seedSql,migration,activateSql,claimSql,account:base.account,other:base.other,revision:base.revision,scope:base.scope,plan:base.plan,policy:base.policy}));
