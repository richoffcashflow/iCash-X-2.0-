import {readFileSync} from 'node:fs';
import {continuationSetup} from './stalled-work-fixture.mjs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const before=JSON.parse(read('tests/fixtures/owner-preflight-step-before.json'));
const gates=JSON.parse(read('tests/fixtures/owner-preflight-step-gates.json'));
export const captured=signature=>before.find(x=>x.signature.replace(/^public\./,'')===signature.replace(/^public\./,'')).definition;
export const migration=read('config/owner-preflight-step-capacity.sql');
export function stepSetup(){return continuationSetup()+`;\n
alter table public.fixture_cleanup_policy add column ordinary integer not null default 3,add column starter integer not null default 0;
create table public.icash_dealmachine_request_budget(id integer primary key,minute_start timestamptz,minute_used integer,minute_limit integer,day_start timestamptz,day_used integer,day_limit integer);
insert into public.icash_dealmachine_request_budget values(1,now(),0,70,now(),0,10000);
create function public.icash_dealmachine_provider_available() returns boolean language sql stable as $$select quota from public.fixture_cleanup_policy$$;
create function icash_research_private.request_reserve_state(timestamptz default now()) returns jsonb language sql stable as $$select jsonb_build_object('ordinaryRemaining',ordinary,'reserveRemaining',starter) from public.fixture_cleanup_policy$$;
create function icash_research_private.starter_request_allowance(uuid,timestamptz default now()) returns integer language sql stable as $$select case when $1 is null then 0 else starter end from public.fixture_cleanup_policy$$;
alter table icash_research_private.owner_export_settings add column preflight_renewal_enabled boolean default false,add column preflight_indexing_enabled boolean default true,add column preflight_quota_recovery_enabled boolean default false;
alter table icash_research_private.owner_export_preflights add column generation integer default 1,add column supersedes uuid;
alter table icash_research_private.owner_exports add column if not exists terminal_at timestamptz,add column if not exists capacity_review_id uuid;
create table icash_research_private.owner_preflight_quota_deferrals(preflight_id uuid,lease uuid);
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz default clock_timestamp(),finished_at timestamptz,result jsonb);
create function public.icash_owner_active_export_enabled() returns boolean language sql stable as $$select true$$;
create function icash_research_private.unknown_export_late_capacity_blocked() returns boolean language sql stable as $$select false$$;
create function icash_research_private.owner_preflight_renewable(uuid) returns boolean language sql stable as $$select false$$;
create function icash_research_private.owner_preflight_cleanup_current(uuid,uuid) returns boolean language sql stable as $$select false$$;
create function icash_research_private.owner_preflight_quota_resume(uuid,jsonb,jsonb) returns jsonb language sql as $$select null::jsonb$$;
create or replace function public.icash_acquisition_capacity_available(uuid) returns boolean language sql stable as $$select public.icash_dealmachine_capacity_available(3)$$;
-- The shared production limiter is unchanged by this patch. This isolated
-- adapter models its atomic one-request contract for final-admission races.
create function public.icash_take_dealmachine_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean language plpgsql as $$
declare allowed boolean;begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from icash_research_private.requests where id=p_request) then return false;end if;
 select quota and ordinary>0 into allowed from public.fixture_cleanup_policy;
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result) values(p_request,p_kind,p_account,p_operation,allowed,case when allowed then null else '{"outcome":"quota_wait"}'::jsonb end);
 if allowed then update public.fixture_cleanup_policy set ordinary=ordinary-1;end if;return allowed;
end$$;
`+gates.filter(x=>x.signature.startsWith('icash_dealmachine_capacity_available')).map(x=>x.definition).join(';\n')+';\n'+read('config/preflight-continuation-fairness.sql')+'\nbegin;'+read('config/preflight-continuation-issuance.sql')+'commit;\n'+[
 'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)','public.icash_owner_active_export_capacity(uuid)',
 'public.icash_enrichment_candidate(uuid)','public.icash_pending_owner_preflight(uuid,uuid,jsonb,boolean)',
 'icash_research_private.owner_preflight_cohort(uuid,uuid)','icash_research_private.owner_preflight_list_known(uuid,boolean)',
].map(captured).join(';\n')+`;
select icash_work_private.activate_continuation_fairness(repeat('a',40));
grant execute on all functions in schema public to service_role;
`;}
