-- Synthetic boundary dependencies; runners load actual hash/current/unstarted,
-- immutable recorder, recovery, and token-bound finish implementations.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end $$;
grant usage on schema public to anon,authenticated,service_role;
create schema icash_private;
create schema icash_research_private;
create schema icash_owner_review_private;
create table icash_private.provider_costs(operation_key text);
create table public.icash_operational_contacts(account_id uuid,screening_id uuid);
create table public.icash_contact_permissions(account_id uuid,screening_id uuid);
create table icash_research_private.owner_export_settings(id integer primary key,enabled boolean not null);
insert into icash_research_private.owner_export_settings values(1,true);
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz,finished_at timestamptz,result jsonb);
create index fixture_request_scope on icash_research_private.requests(account_id,created_at);
create index fixture_request_operation on icash_research_private.requests(operation_key);
create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,items jsonb);
create table icash_research_private.owner_batch_items(screening_id uuid primary key,batch_id uuid,operation_key text);
create index fixture_batch_items on icash_research_private.owner_batch_items(batch_id);
create table icash_research_private.owner_exports(id uuid primary key);
create table icash_research_private.owner_export_preflights(id uuid primary key,account_id uuid,created_at timestamptz);
create table icash_owner_review_private.changes(kind text,after_row jsonb,recorded_at timestamptz);
create table public.fixture_preview_policy(member boolean not null);insert into public.fixture_preview_policy values(true);
create function public.icash_membership_work_allowed(uuid) returns boolean language sql stable set search_path='' as $$select member from public.fixture_preview_policy$$;
create function public.icash_research_state_allowed(text) returns boolean language sql stable set search_path='' as $$select $1='TX'$$;
create function public.icash_prospecting_available(uuid) returns bigint language sql stable set search_path='' as $$select balance_cents-reserved_cents from public.icash_wallets where account_id=$1$$;
create function public.icash_owner_preflight_empty(uuid,uuid,jsonb) returns boolean language sql stable as $$select false$$;
insert into public.icash_operating_budget(id,enabled) values(1,true);

create function public.fixture_preview_rejection_seed(n integer,deferrals integer default 0) returns jsonb language plpgsql as $$
declare a uuid:=md5('rejection-account:'||n)::uuid;rate_id uuid:=md5('rejection-rate:'||n)::uuid;
 s uuid:=md5('rejection-screen:'||n)::uuid;t uuid:=md5('rejection-ticket:'||n)::uuid;r uuid:=md5('rejection-request:'||n)::uuid;b uuid:=md5('rejection-batch:'||n)::uuid;
 ts timestamptz:=clock_timestamp()-interval '10 minutes';screen_hash text;
begin
 insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused) values(a,a,'Synthetic preview fixture',false);
 insert into icash_wallets(account_id,balance_cents) values(a,10000);
 insert into icash_operation_rates(id,operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
 values(rate_id,'owner_enrichment','Synthetic preview '||n,105,'{"dealmachine":250000}','Synthetic approved rate',ts-interval '1 day',ts+interval '2 days',true);
 insert into icash_discovery_configs(account_id,enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,contacts_enabled,contact_rate_id,contact_credit_cap,next_run_at)
 values(a,true,'75217',rate_id,10000,ts+interval '2 days',100000,true,rate_id,25,clock_timestamp()+interval '1 hour');
 insert into icash_screening_jobs(id,account_id,event_key,snapshot,state,result,completed_at)
 values(s,a,'Synthetic preview '||n,jsonb_build_object('propertyId','prop_'||n,'propertyType','house','fetchedAt',ts-interval '1 hour','raw',jsonb_build_object('data',jsonb_build_object('dm_property_id','prop_'||n,'state','TX'))),'complete','{"financialCheck":{"status":"eligible"}}',ts-interval '1 hour');
 select public.icash_owner_enrichment_screening_hash(j) into screen_hash from icash_screening_jobs j where id=s;
 insert into icash_automation_tickets(id,account_id,kind,screening_id,state,created_at,completed_at,expires_at,outcome,issue_attempts,owner_preview_deferrals,owner_preview_retry_after,owner_preview_retry_until,owner_preview_screening_hash)
 values(t,a,'contacts',s,'held',ts,ts+interval '4 seconds',ts+interval '2 minutes','held_for_reconciliation',3,deferrals,
  case when deferrals>0 then ts-interval '1 minute' end,case when deferrals>0 then ts+interval '2 hours' end,case when deferrals>0 then screen_hash end);
 insert into icash_research_private.requests values(r,'owner_preview',a,'owner-batch:'||b,true,ts+interval '1 second',ts+interval '2 seconds','{"outcome":"response","httpStatus":200,"creditsUsed":0,"returned":5}');
 insert into icash_owner_review_private.changes select 'rate',to_jsonb(x),ts-interval '1 day' from icash_operation_rates x where id=rate_id;
 return jsonb_build_object('ticket',t,'account',a,'screening',s,'request',r,'batch',b,
  'ticketHash',(select encode(sha256(convert_to(to_jsonb(x)::text,'UTF8')),'hex') from icash_automation_tickets x where id=t),
  'requestHash',(select md5(to_jsonb(x)::text) from icash_research_private.requests x where id=r),
  'screeningHash',screen_hash,'configHash',(select md5((to_jsonb(x)-'next_run_at')::text) from icash_discovery_configs x where account_id=a),
  'rateHash',(select md5(to_jsonb(x)::text) from icash_operation_rates x where id=rate_id),'release',repeat('a',40),
  'trace',jsonb_build_object('evidenceKind','reviewed_local_handler','rawPreviewAvailable',false,'deployment','dpl_SyntheticFixture123','rpc','icash_record_empty_owner_preview','httpStatus',200,'responseBytes',5,
   'ticketId',t,'requestId',r,'accountId',a,'screeningId',s,'batchId',b,'recordedAt',ts+interval '2.5 seconds','finishAt',ts+interval '3 seconds'));
end $$;
