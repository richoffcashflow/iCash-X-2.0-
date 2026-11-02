-- Synthetic boundary tables for the actual recovery and renewable functions.
create schema icash_research_private;
create schema icash_owner_review_private;
create table icash_research_private.owner_export_settings(id int primary key,enabled boolean,preflight_enabled boolean,preflight_renewal_enabled boolean);
insert into icash_research_private.owner_export_settings values(1,true,true,true);
create table icash_research_private.owner_export_preflights(
 id uuid primary key,account_id uuid,items jsonb,request jsonb,state text,list_name text,list_id jsonb,receipts jsonb,
 created_at timestamptz,started_at timestamptz,deleted_at timestamptz,checked_at timestamptz,supersedes uuid
);
create table icash_owner_review_private.changes(kind text,after_row jsonb,recorded_at timestamptz);
create table fixture_cleanup_policy(people_available boolean,mobile boolean);
insert into fixture_cleanup_policy values(true,false);
create function public.icash_owner_export_people_available(jsonb) returns boolean language sql as $$select people_available from public.fixture_cleanup_policy$$;
create function public.icash_owner_targeting_pool(uuid,uuid) returns text language sql as $$select case when mobile then 'mobile' else 'all' end from public.fixture_cleanup_policy$$;
