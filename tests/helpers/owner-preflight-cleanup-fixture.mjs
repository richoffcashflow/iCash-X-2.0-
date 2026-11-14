import {readFileSync} from 'node:fs';
import {setupIndexingFixture} from '../fixtures/owner-preflight-indexing-setup.mjs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const statements=[];await setupIndexingFixture({exec:async sql=>statements.push(sql)});
const before=JSON.parse(read('tests/fixtures/owner-preflight-cleanup-before.json'));
const indexing=read('config/owner-preflight-list-indexing.sql');
const renewal=read('config/owner-preflight-renewal.sql');
export const setupSql=statements.join(';\n')+`;\n
alter table icash_research_private.owner_export_settings add column preflight_indexing_enabled boolean default true,add column preflight_quota_recovery_enabled boolean default false;
alter table icash_research_private.owner_export_preflights add column indexing_checks integer default 0,add column indexing_next_step text,add column indexing_reason text;
create table icash_research_private.owner_preflight_quota_deferrals(preflight_id uuid,lease uuid);
create function icash_research_private.owner_preflight_quota_resume(uuid,jsonb,jsonb) returns jsonb language sql as $$select null::jsonb$$;
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz default clock_timestamp(),finished_at timestamptz,result jsonb);
create function public.icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable as $$select public.icash_dealmachine_capacity_available($1)$$;
create function public.icash_take_dealmachine_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean language plpgsql as $$
declare allowed boolean;begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from icash_research_private.requests where id=p_request) then return false;end if;
 select quota into allowed from public.fixture_cleanup_policy;
 insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result) values(p_request,p_kind,p_account,p_operation,allowed,case when allowed then null else '{"outcome":"quota_wait"}'::jsonb end);
 return allowed;end$$;
update icash_research_private.owner_export_settings set preflight_renewal_enabled=true;
`+indexing.slice(indexing.indexOf('create function icash_research_private.owner_preflight_list_known'),indexing.indexOf('create function icash_research_private.record_owner_preflight_indexing'))
+renewal.slice(renewal.indexOf('create function icash_research_private.guard_owner_preflight_generation'),renewal.indexOf('do $patch$'))
+Object.values(before).map(x=>x.definition).join(';\n')+';';
export const migration=read('config/owner-preflight-cleanup-handoff.sql');
export const enableSql="do $$begin if not icash_research_private.activate_owner_preflight_cleanup(repeat('a',40)) then raise exception 'Fixture cleanup activation rejected';end if;end$$";
// Production-derived state: original waiting list >30m, no cleanup attempts,
// current source, and a normal held/rate-limited ticket (or no ticket).
export const seedSql=`create function public.fixture_cleanup_seed(n integer,p_ticket boolean default true) returns jsonb language plpgsql as $$
declare c jsonb;begin
 c:=public.fixture_preflight_seed(n,true);
 alter table icash_research_private.owner_export_preflights disable trigger owner_preflight_immutable;
 update icash_research_private.owner_export_preflights set created_at=now()-interval '2 hours',started_at=now()-interval '2 hours' where id=(c->>'preflight')::uuid;
 alter table icash_research_private.owner_export_preflights enable trigger owner_preflight_immutable;
 delete from public.icash_screening_jobs where id=(c->>'fresh')::uuid;
 if not p_ticket then delete from public.icash_automation_tickets where id=(c->>'ticket')::uuid;end if;
 return c||(select jsonb_build_object('items',items,'request',request) from icash_research_private.owner_export_preflights where id=(c->>'preflight')::uuid);
end$$;`;
