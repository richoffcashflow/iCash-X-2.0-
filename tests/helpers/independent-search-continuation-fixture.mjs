import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as base from './market-hold-continuation-fixture.mjs';
import {rate,plan} from './targeting-query-binding-fixture.mjs';
export {account,other,revision,scope} from './market-hold-continuation-fixture.mjs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const source=read('config/stalled-search-continuation.sql');
const readers=source.slice(source.indexOf('create index research_requests_operation'),source.indexOf('create function public.icash_continue_stalled_research'))
 .replaceAll('create function public.icash_stalled','create or replace function public.icash_stalled');
export const setupSql=base.setupSql+`
 alter table icash_research_private.settings add column stalled_search_continuation_enabled boolean default true,
  add column completed_error_continuation_enabled boolean default true;
 alter table icash_operation_rates add column charge_cents bigint default 100;
 create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,result jsonb,created_at timestamptz,finished_at timestamptz);
 create table icash_discovery_results(operation_key text,account_id uuid,result jsonb);
 create table icash_cost_observations(provider text,event_key text);
 create function icash_research_admission_quote(uuid,text,bigint) returns bigint language sql as $$select $3$$;
 create function icash_prospecting_available(uuid) returns bigint language sql as $$select balance_cents-reserved_cents from public.icash_wallets where account_id=$1$$;
 `+readers+JSON.parse(read('tests/fixtures/independent-search-continuation-before.json')).map(x=>x.definition+';').join('\n')+`
 revoke all on function public.icash_continue_stalled_research(uuid) from public,anon,authenticated;
 grant execute on function public.icash_continue_stalled_research(uuid) to service_role;
 `;
export const operation=`discovery:${base.account}:${base.revision}:1`;
export const policy={version:'research-efficiency-v2',exclusionListId:'00000000-0000-4000-8000-000000000199'};
export const seedSql=base.seedSql+`
 insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,reserved_micros,dispatched_at)
 values('${operation}','${base.account}','${rate}','dispatched',100,100000,now()-interval '2 days');
 insert into icash_research_private.requests values('00000000-0000-4000-8000-000000000191','property_search','${base.account}','${operation}',true,'{"outcome":"unknown"}',now()-interval '2 days',now()-interval '2 days'+interval '1 minute');
 insert into icash_research_private.query_claims values('${operation}','${base.account}','${JSON.stringify(policy)}');
 insert into icash_discovery_filter_pages(operation_key,account_id,revision,sequence,zip,plan,state)
 values('${operation}','${base.account}','${base.revision}',1,'75217','${JSON.stringify(plan)}','claimed');
 `;
export const migration=read('config/independent-query-stall-recovery.sql');
export const activateSql='update icash_research_private.settings set independent_query_continuation_enabled=true where id=1;';
export const claimSql=`select public.icash_continue_stalled_research('${base.account}');`;
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify({setupSql,seedSql,migration,activateSql,claimSql,operation,account:base.account,other:base.other,revision:base.revision,scope:base.scope,plan,policy}));
