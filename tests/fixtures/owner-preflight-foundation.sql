-- Isolated admission/selection boundary fixture. Never production data.
create role anon;create role authenticated;create role service_role;
create schema icash_research_private;
create table public.icash_accounts(id uuid primary key,bot_paused boolean default false);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb);
create table icash_research_private.owner_export_settings(id integer primary key,enabled boolean);insert into icash_research_private.owner_export_settings values(1,true);
create table fixture_purchases(account_id uuid,items jsonb,request jsonb);
create table fixture_settings(quota boolean,unstarted boolean,people_available boolean,mobile boolean);
insert into fixture_settings values(true,true,true,false);
create function public.icash_membership_work_allowed(uuid) returns boolean language sql as $$select true$$;
create function public.icash_owner_export_people_available(jsonb) returns boolean language sql as $$select people_available from public.fixture_settings$$;
create function public.icash_owner_enrichment_unstarted(uuid,uuid,text) returns boolean language sql as $$select unstarted from public.fixture_settings$$;
create function public.icash_dealmachine_capacity_available(integer default 2) returns boolean language sql as $$select quota from public.fixture_settings$$;
create function public.icash_owner_targeting_pool(uuid,uuid) returns text language sql as $$select case when mobile then 'mobile' else 'active' end from public.fixture_settings$$;
create function public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text) returns boolean language sql as $$select unstarted from public.fixture_settings$$;
create function public.icash_admit_owner_active_export(p_account uuid,p_primary uuid,p_batch uuid,p_items jsonb,p_preview jsonb,p_config jsonb,p_request jsonb) returns text language plpgsql as $$
declare expected jsonb:=p_request;
begin
 if p_request is distinct from expected then return 'held';end if;
 insert into public.fixture_purchases values(p_account,p_items,p_request);return 'claimed';
end $$;
create function public.icash_enrichment_before_prospecting_budget(p_account uuid) returns uuid language sql as $$select s.id from public.icash_screening_jobs s where s.account_id=p_account order by s.id limit 1$$;
create function public.icash_owner_batch_candidates(p_account uuid,p_screening uuid) returns jsonb language sql as $$select jsonb_agg(s.id) from public.icash_screening_jobs s where s.account_id=p_account$$;
create function public.icash_pending_opportunity_count(p_account uuid) returns integer language sql as $$select count(*)::integer from public.icash_screening_jobs s where s.account_id=p_account$$;
create table icash_research_private.owner_exports(id uuid,terminal_at timestamptz,capacity_review_id uuid);
create table icash_research_private.owner_batches(id uuid,account_id uuid,created_at timestamptz);
create function public.icash_owner_export_findings() returns table(kind text,resource_id uuid,account_id uuid,since timestamptz) language sql as $$select 'owner_export'::text,e.id,b.account_id,b.created_at from icash_research_private.owner_exports e join icash_research_private.owner_batches b on b.id=e.id where e.terminal_at is null and e.capacity_review_id is null and b.created_at<now()-interval '5 minutes'$$;
