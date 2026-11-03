-- Additional isolated relations for the existing shared exclusion claim.
create table icash_research_private.settings(id int primary key,enabled boolean,exclusions_enabled boolean,pruned_at timestamptz);
insert into icash_research_private.settings values(1,true,true,now());
create table icash_research_private.exclusions(id int primary key,name text,list_id text,state text,token uuid,lease_until timestamptz,next_at timestamptz,batch text[],last_synced_at timestamptz);
insert into icash_research_private.exclusions values(1,'research-exclusions-00000000-0000-4000-8000-000000000001','fixture-list','ready',null,null,now()-interval '1 minute','{}',null);
create table icash_research_private.exclusion_items(property_id text primary key,synced_at timestamptz);
insert into icash_research_private.exclusion_items values('prop_1',null);
create table icash_research_private.targeting_acquired_properties(property_id text primary key,synced_at timestamptz);
create table icash_research_private.targeting_settings(id int primary key,enabled boolean);
insert into icash_research_private.targeting_settings values(1,false);
create table public.icash_discovery_filter_pages(plan jsonb,state text);
create table public.icash_discovery_configs(account_id uuid primary key,enabled boolean default true,auto_enabled boolean default true,exhausted boolean default false,data_rights_until timestamptz default now()+interval '1 day',research_version int default 2,research_list_id text default 'fixture-list');
create function public.icash_prune_research_requests() returns void language sql as $$select null::void$$;
