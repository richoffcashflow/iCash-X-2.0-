-- Additive synthetic dependencies for the exact production late-evidence
-- functions. Load after unknown-export-foundation and before live-functions.
create table icash_research_private.owner_export_settings(id integer primary key,preflight_enabled boolean);
insert into icash_research_private.owner_export_settings values(1,false);
create table icash_research_private.targeting_settings(id integer primary key,mobile_verified boolean);
insert into icash_research_private.targeting_settings values(1,false);
create table icash_research_private.owner_export_preflights(
 id uuid primary key,account_id uuid,fingerprint text,items jsonb,request jsonb,
 state text,checked_at timestamptz,created_at timestamptz,started_at timestamptz,supersedes uuid
);
create function public.icash_owner_targeting_pool(uuid,uuid) returns text language sql stable as $$select 'active'::text$$;
create function public.icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable as $$select quota from public.fixture_settings$$;
create function public.icash_admit_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb) returns text language sql as $$select 'claimed'::text$$;
