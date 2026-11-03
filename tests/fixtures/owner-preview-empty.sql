-- Disposable local fixture: actual unstarted-evidence predicate is installed by the runner.
do $$ declare x text;begin foreach x in array array['anon','authenticated','service_role'] loop
 if not exists(select 1 from pg_roles where rolname=x) then execute format('create role %I',x);end if;end loop;end $$;
-- Native runners recreate public, so restore its production API visibility.
-- Private-schema/table access remains denied; only granted RPCs may execute.
grant usage on schema public to anon,authenticated,service_role;
create schema icash_research_private;
create schema icash_private;
revoke all on schema icash_research_private from public,anon,authenticated,service_role;
create table public.icash_accounts(id uuid primary key,bot_paused boolean default false,work_allowed boolean default true);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text,snapshot jsonb,result jsonb,completed_at timestamptz);
create table public.icash_operating_budget(id integer primary key);insert into public.icash_operating_budget values(1);
create table public.icash_property_controls(account_id uuid,property_id text,manual boolean);
create table public.icash_operation_spend(operation_key text primary key,account_id uuid,state text default 'dispatched');
create table public.icash_credit_reservations(operation_key text primary key);
create table public.icash_cost_observations(provider text,event_key text,source_ref text,amount numeric,units text);
create table public.icash_cost_manifests(operation_key text primary key);
create table icash_private.provider_costs(operation_key text primary key);
create table public.icash_owner_contacts(screening_id uuid,operation_key text);
create table public.icash_live_conversations(operation_key text,account_id uuid,screening_id uuid);
create table public.icash_operational_contacts(account_id uuid,screening_id uuid);
create table public.icash_contact_permissions(account_id uuid,screening_id uuid);
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz,finished_at timestamptz,result jsonb);
create table public.fixture_preflight_empty(account_id uuid,screening_id uuid,snapshot jsonb);
create function public.icash_membership_work_allowed(p uuid) returns boolean language sql stable as $$ select work_allowed from public.icash_accounts where id=p $$;
create function public.icash_owner_preflight_empty(p_account uuid,p_screening uuid,p_snapshot jsonb) returns boolean
language sql stable security definer set search_path='' as $$ select exists(select 1 from public.fixture_preflight_empty where account_id=p_account and screening_id=p_screening and snapshot=p_snapshot) $$;
create function public.fixture_empty_preview_seed(n integer,total integer default 5) returns jsonb language plpgsql as $$
declare a uuid:=md5('empty-account:'||n)::uuid;b uuid:=md5('empty-batch:'||n)::uuid;r uuid:=md5('empty-request:'||n)::uuid;s uuid;items jsonb:='[]';data jsonb:='[]';snapshot jsonb;i integer;
begin
 insert into icash_accounts(id) values(a);
 for i in 1..total loop
  s:=md5('empty-screening:'||n||':'||i)::uuid;
  snapshot:=jsonb_build_object('propertyId','prop_'||n||i,'propertyType','house','fetchedAt',now()-interval '1 hour');
  insert into icash_screening_jobs values(s,a,'complete',snapshot,'{"financialCheck":{"status":"eligible"}}',now()-interval '1 hour');
  items:=items||jsonb_build_array(jsonb_build_object('screeningId',s,'snapshot',snapshot));
  data:=data||jsonb_build_array(jsonb_build_object('dm_property_id','prop_'||n||i,'found',true,'contacts',jsonb_build_array(jsonb_build_object('dm_person_id','per_'||n||i,'contact_type','owner','availability',jsonb_build_object('phones',0)))));
 end loop;
 insert into icash_research_private.requests values(r,'owner_preview',a,'owner-batch:'||b,true,now()-interval '5 seconds',now()-interval '2 seconds',jsonb_build_object('outcome','response','httpStatus',200,'returned',total,'creditsUsed',0));
 -- Current original provider shape: licensed is an explicit fifth zero counter.
 return jsonb_build_object('account',a,'batch',b,'request',r,'items',items,'preview',jsonb_build_object('data',data,'totals',jsonb_build_object('submitted',total,'found',total,'not_found',0),'credits','{"used":0,"people":0,"properties":0,"deduplicated":0,"licensed":0}'::jsonb));
end $$;
