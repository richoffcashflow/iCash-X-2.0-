-- Resume only a free request that the shared limiter durably refused locally.
-- Original provider receipts, leases, paid operations and financial holds stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table icash_research_private.owner_export_settings add column preflight_quota_recovery_enabled boolean not null default false;
create index research_requests_operation_started on icash_research_private.requests(operation_key,created_at) where admitted;
create table icash_research_private.owner_preflight_quota_deferrals(
 request_id uuid primary key references icash_research_private.requests(id),
 preflight_id uuid not null references icash_research_private.owner_export_preflights(id),
 lease uuid not null,step text not null check(step in ('create','baseline','eligible','metadata')),
 started_at timestamptz not null,receipts_hash text not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(preflight_id,lease,step)
);
alter table icash_research_private.owner_preflight_quota_deferrals enable row level security;
revoke all on icash_research_private.owner_preflight_quota_deferrals from public,anon,authenticated,service_role;
create function icash_research_private.guard_owner_preflight_quota_deferral() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Original local request denial is immutable';end$$;
create trigger owner_preflight_quota_immutable before update or delete on icash_research_private.owner_preflight_quota_deferrals
 for each row execute function icash_research_private.guard_owner_preflight_quota_deferral();

create function public.icash_defer_owner_preflight_quota(p_id uuid,p_lease uuid,p_step text,p_request uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare p icash_research_private.owner_export_preflights;r icash_research_private.requests;owner_account uuid;
begin
 if not exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled and preflight_quota_recovery_enabled) then return false;end if;
 select account_id into owner_account from icash_research_private.owner_export_preflights where id=p_id;
 if owner_account is null then return false;end if;
 -- Serialize denial registration with claim's existing account advisory lock.
 -- A claimant can therefore acquire budget/account locks before the preflight.
 perform pg_advisory_xact_lock(hashtextextended('owner-preflight:'||owner_account,0));
 select * into p from icash_research_private.owner_export_preflights where id=p_id for update;
 if not found or p.lease is distinct from p_lease or p_step not in ('create','baseline','eligible','metadata')
  or p.checked_at is not null or p.deleted_at is not null or p.cleanup_attempts<>0
  or p.started_at not between clock_timestamp()-interval '90 seconds' and clock_timestamp()
  or (p_step='create' and (p.state<>'creating' or p.list_id is not null or p.receipts<>'{}'::jsonb))
  or (p_step<>'create' and (p.state<>'checking' or p.list_id is null))
  or (p_step in ('create','baseline','eligible') and p.receipts ? p_step)
  or (p_step='eligible' and not p.receipts ? 'baseline')
  or (p_step='metadata' and to_jsonb(p)->>'indexing_next_step' is distinct from 'metadata')
  then return false;end if;
 select * into r from icash_research_private.requests where id=p_request;
 if not found or r.account_id is distinct from p.account_id or r.kind<>'owner_preview'
  or r.operation_key is distinct from 'owner-preflight:'||p.id||':'||p_step
  or r.admitted is distinct from false or r.result is distinct from '{"outcome":"quota_wait"}'::jsonb
  or r.finished_at is not null or r.created_at not between p.started_at and clock_timestamp()
  or exists(select 1 from icash_research_private.requests other where other.admitted
   and other.operation_key=r.operation_key and other.created_at>=p.started_at)
  then return false;end if;
 if exists(select 1 from icash_research_private.owner_preflight_quota_deferrals d where d.request_id=p_request) then
  return exists(select 1 from icash_research_private.owner_preflight_quota_deferrals d where d.request_id=p_request
   and d.preflight_id=p.id and d.lease=p.lease and d.step=p_step and d.started_at=p.started_at and d.receipts_hash=md5(p.receipts::text));
 end if;
 if (select count(*) from icash_research_private.owner_preflight_quota_deferrals where preflight_id=p.id)>=7 then return false;end if;
 insert into icash_research_private.owner_preflight_quota_deferrals(request_id,preflight_id,lease,step,started_at,receipts_hash)
 values(r.id,p.id,p.lease,p_step,p.started_at,md5(p.receipts::text)) on conflict do nothing;
 return found;
end $$;

create function icash_research_private.owner_preflight_quota_resume(p_id uuid,p_items jsonb,p_request jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare p icash_research_private.owner_export_preflights;d icash_research_private.owner_preflight_quota_deferrals;item jsonb;
begin
 if not exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled and preflight_quota_recovery_enabled) then return null;end if;
 select * into p from icash_research_private.owner_export_preflights where id=p_id for update;
 select * into d from icash_research_private.owner_preflight_quota_deferrals where preflight_id=p.id and lease=p.lease;
 if not found then return null;end if;
 if p.items is distinct from p_items or p.request is distinct from p_request
  or p.started_at is distinct from d.started_at or md5(p.receipts::text) is distinct from d.receipts_hash
  or p.checked_at is not null or p.deleted_at is not null or p.cleanup_attempts<>0
  or p.state not in ('creating','checking') or p.created_at>clock_timestamp()
  or p.created_at<=clock_timestamp()-(case when d.step='create' then interval '5 minutes' else interval '30 minutes' end)
  or (d.step='eligible' and p.started_at<=clock_timestamp()-interval '90 seconds')
  or exists(select 1 from icash_research_private.requests r where r.admitted
   and r.operation_key='owner-preflight:'||p.id||':'||d.step and r.created_at>=d.started_at)
  then return '{"status":"held"}';end if;
 -- Match the ordinary ticket's first 30-second backoff; its existing exponential
 -- retry limit remains authoritative. This does not reserve provider requests.
 if d.created_at>clock_timestamp()-interval '30 seconds' or not public.icash_dealmachine_capacity_available(case when d.step='baseline' then 3 else 1 end)
  then return '{"status":"pending"}';end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return '{"status":"held"}';end if;
 perform 1 from public.icash_accounts where id=p.account_id and not bot_paused for update;
 if not found or public.icash_membership_work_allowed(p.account_id) is distinct from true or public.icash_owner_export_people_available(p.request->'people_ids') is distinct from true
  then return '{"status":"held"}';end if;
 for item in select value from jsonb_array_elements(p.items) loop
  if public.icash_owner_enrichment_retry_current(p.account_id,(item->>'screeningId')::uuid) is distinct from true
   or not exists(select 1 from public.icash_screening_jobs s where s.id=(item->>'screeningId')::uuid
    and s.account_id=p.account_id and s.snapshot=item->'snapshot')
   or coalesce(p.request->'mobile_only','false'::jsonb) is distinct from to_jsonb(public.icash_owner_targeting_pool(p.account_id,(item->>'screeningId')::uuid)='mobile')
   then return '{"status":"held"}';end if;
 end loop;
 -- An eligible count retains its original baseline handler's 90-second window.
 update icash_research_private.owner_export_preflights set lease=gen_random_uuid(),
  started_at=case when d.step='eligible' then started_at else clock_timestamp() end
 where id=p.id returning * into p;
 return jsonb_build_object('status',case when d.step='create' then 'create' else 'check' end,
  'id',p.id,'lease',p.lease,'listId',p.list_id,'name',p.list_name,'ids',p.request->'people_ids',
  'mobileOnly',p.request->'mobile_only'='true'::jsonb,'nextStep',d.step);
end $$;

do $patch$
declare d text;needle text;proof_table text;exclusions text:='';
begin
 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 needle:='if p.items is distinct from p_items or p.request is distinct from p_request then return ''{"status":"held"}'';end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) or strpos(d,'owner_preflight_quota_resume')>0 then raise exception 'Preflight quota recovery prerequisite changed';end if;
 d:=replace(d,'declare p icash_research_private.owner_export_preflights;','declare quota_result jsonb;p icash_research_private.owner_export_preflights;');
 if strpos(d,'declare quota_result jsonb;')=0 then raise exception 'Preflight quota declaration changed';end if;
 d:=replace(d,needle,needle||E'\n  quota_result:=icash_research_private.owner_preflight_quota_resume(p.id,p_items,p_request);\n  if quota_result is not null then return quota_result;end if;');
 needle:='finger:=md5(jsonb_build_array(p_items,p_request)::text);';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight quota lock boundary changed';end if;
 execute replace(d,needle,needle||$locks$
 if exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled and preflight_quota_recovery_enabled)
  and exists(select 1 from icash_research_private.owner_export_preflights retry_preflight
   join icash_research_private.owner_preflight_quota_deferrals denial on denial.preflight_id=retry_preflight.id and denial.lease=retry_preflight.lease
   where retry_preflight.account_id=p_account and retry_preflight.fingerprint=finger) then
  perform 1 from public.icash_operating_budget where id=1 and enabled for update;
  if not found then return '{"status":"held"}';end if;
  perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
  if not found then return '{"status":"held"}';end if;
 end if;
$locks$);
 d:=pg_get_functiondef('public.icash_prune_research_requests()'::regprocedure);
 needle:='select id from icash_research_private.requests where created_at<now()-interval ''30 days'' order by created_at limit 10000';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Request diagnostic pruning prerequisite changed';end if;
 -- Permanent proofs retain their exact source request. Build static indexed
 -- anti-joins for tables installed on this branch; nullable quota feedback
 -- intentionally retains its existing ON DELETE SET NULL behavior.
 foreach proof_table in array array['owner_preflight_quota_deferrals','preview_rejection_recoveries','stalled_searches','owner_empty_preview_receipts','export_capacity_probes'] loop
  if to_regclass('icash_research_private.'||proof_table) is not null then
   exclusions:=exclusions||format(' and not exists(select 1 from icash_research_private.%I proof where proof.request_id=request.id)',proof_table);
  end if;
 end loop;
 execute replace(d,needle,'select request.id from icash_research_private.requests request where request.created_at<now()-interval ''30 days'''||exclusions||' order by request.created_at limit 10000');
end $patch$;
revoke all on function icash_research_private.guard_owner_preflight_quota_deferral(),icash_research_private.owner_preflight_quota_resume(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.icash_defer_owner_preflight_quota(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_defer_owner_preflight_quota(uuid,uuid,text,uuid) to service_role;
commit;
