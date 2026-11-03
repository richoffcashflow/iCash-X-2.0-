-- Atomic completion of the reviewed funded-work recovery.
-- Observe quota and project usable inventory without changing original holds.
begin;

-- BEGIN CONFIG research-quota-monitoring
-- Observe the shared request ceiling independently from worker uptime.
-- This never resets a window, increases a limit or admits a provider request.
set local lock_timeout='5s';
create function public.icash_research_quota_status() returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare b public.icash_dealmachine_request_budget;f icash_research_private.quota_feedback;
 day_used integer;minute_used integer;state text;next_at timestamptz;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1;
 select * into f from icash_research_private.quota_feedback where id=1;
 if b.id is null or f.id is null or b.day_limit is null or b.minute_limit is null
  or b.day_limit<=0 or b.minute_limit<=0 or b.day_used is null or b.minute_used is null
  or b.day_used<0 or b.minute_used<0 or b.day_start is null or b.minute_start is null
  or b.day_start>now() or b.minute_start>now() then
  return jsonb_build_object('checkedAt',now(),'fresh',true,'status','unavailable','warningCount',1);
 end if;
 -- The limiter starts a new window only on normal admission. An observation
 -- computes effective capacity without changing those stored counters.
 day_used:=case when b.day_start<=now()-interval '24 hours' then 0 else b.day_used end;
 minute_used:=case when b.minute_start<=now()-interval '1 minute' then 0 else b.minute_used end;
 state:=case when day_used>=b.day_limit then 'day_exhausted'
  when f.blocked_until>now() then 'provider_hold'
  when minute_used>=b.minute_limit then 'minute_exhausted' else 'available' end;
 next_at:=greatest(case when day_used>=b.day_limit then b.day_start+interval '24 hours' end,
  case when minute_used>=b.minute_limit then b.minute_start+interval '1 minute' end,
  case when f.blocked_until>now() then f.blocked_until end);
 return jsonb_build_object('checkedAt',now(),'fresh',true,'status',state,
  'warningCount',case when state in ('day_exhausted','provider_hold') then 1 else 0 end,
  'dayUsed',day_used,'dayLimit',b.day_limit,'dayRemaining',greatest(0,b.day_limit-day_used),
  'minuteUsed',minute_used,'minuteLimit',b.minute_limit,'minuteRemaining',greatest(0,b.minute_limit-minute_used),
  'dayStartedAt',b.day_start,'dayResetsAt',case when b.day_start>now()-interval '24 hours' then b.day_start+interval '24 hours' end,
  'nextAvailableAt',next_at,'providerBlockedUntil',case when f.blocked_until>now() then f.blocked_until end,
  'providerObservedAt',f.request_started_at,'providerDayLimit',f.headers->'dayLimit','providerDayRemaining',f.headers->'dayRemaining');
end $function$;
revoke all on function public.icash_research_quota_status() from public,anon,authenticated;
grant execute on function public.icash_research_quota_status() to service_role;

do $guard$
begin
 if md5(pg_get_functiondef('public.icash_refresh_account_work_snapshot()'::regprocedure))<>'73dae59d66460dddd1ab6c77c7286341' then
  raise exception 'Research quota monitor prerequisite changed';
 end if;
end $guard$;
alter function public.icash_refresh_account_work_snapshot() rename to icash_refresh_work_before_research_quota;
create function public.icash_refresh_account_work_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare v_report jsonb;previous jsonb;quota jsonb;
begin
 perform pg_advisory_xact_lock(916014);
 select s.report->'researchQuota' into previous from icash_reliability_private.snapshots s where id=1;
 v_report:=public.icash_refresh_work_before_research_quota();
 begin
  quota:=public.icash_research_quota_status();
  if quota is null or quota->>'checkedAt' is null or (quota->>'checkedAt')::timestamptz not between now()-interval '3 minutes' and now() then
   raise exception 'Research quota observation unavailable';
  end if;
 exception when others then
  quota:=coalesce(previous,'{}'::jsonb)||jsonb_build_object('checkedAt',previous->'checkedAt','fresh',false,'status','unavailable','warningCount',1);
 end;
 v_report:=v_report||jsonb_build_object('researchQuota',quota,'issueCount',
  (v_report->>'issueCount')::integer-coalesce((v_report->'researchQuota'->>'warningCount')::integer,0)+(quota->>'warningCount')::integer);
 update icash_reliability_private.snapshots s set report=v_report where s.id=1;
 return v_report;
end $function$;
revoke all on function public.icash_refresh_work_before_research_quota(),public.icash_refresh_account_work_snapshot() from public,anon,authenticated;
grant execute on function public.icash_refresh_work_before_research_quota(),public.icash_refresh_account_work_snapshot() to service_role;
-- END CONFIG research-quota-monitoring

-- BEGIN CONFIG identity-bound-opportunity-buffer
-- Count usable pending work without relabeling contacts from an old identity.
-- Only a settled result with exact old-principal provenance can leave this
-- projection. Original contacts, purchases, permission and money stay unchanged.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_pending_opportunity_count(uuid)'::regprocedure);
 if md5(d)<>'773e9a966f406d08e33ce1f23b516560' then
  raise exception 'Identity-bound buffer prerequisite changed';
 end if;
 needle:='  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in';
 replacement:=$new$  -- Changed sending identity is not fresh outreach inventory. Keep an
  -- unknown purchase, an alternative permission or any current-identity record
  -- in the buffer; absence of prepared operational evidence is not a failure.
  and not exists(
   select 1 from public.icash_owner_contacts owned
   join public.icash_operation_spend spend on spend.account_id=owned.account_id and spend.operation_key=owned.operation_key
    and spend.operation_key='owners:'||owned.account_id||':'||owned.screening_id
    and spend.state='settled' and spend.settled_at is not null
   join public.icash_customer_identities identity on identity.account_id=owned.account_id and length(trim(identity.principal))>0
   where owned.account_id=s.account_id and owned.screening_id=s.id and owned.result->>'propertyId'=s.snapshot->>'propertyId'
    and exists(select 1 from public.icash_operational_contacts old_contact
     where old_contact.account_id=s.account_id and old_contact.screening_id=s.id
      and old_contact.source_hash=encode(sha256(convert_to(owned.result::text,'UTF8')),'hex')
      and length(trim(old_contact.sending_principal))>0 and old_contact.sending_principal is distinct from identity.principal)
    and not exists(select 1 from public.icash_operational_contacts current_contact
     where current_contact.account_id=s.account_id and current_contact.screening_id=s.id
      and current_contact.source_hash=encode(sha256(convert_to(owned.result::text,'UTF8')),'hex')
      and current_contact.sending_principal=identity.principal)
    and not exists(select 1 from public.icash_contact_permissions permission
     where permission.account_id=s.account_id and permission.screening_id=s.id
      and permission.revoked_at is null and permission.permission_until>now())
    and not exists(select 1 from public.icash_operation_spend held
     join public.icash_screening_jobs prior on held.operation_key='owners:'||s.account_id||':'||prior.id
      and prior.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId'
     where held.account_id=s.account_id and held.state in ('reserved','dispatched'))
  )
  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Identity-bound buffer insertion point changed';
 end if;
 execute replace(d,needle,replacement);
end $patch$;
-- END CONFIG identity-bound-opportunity-buffer

commit;
