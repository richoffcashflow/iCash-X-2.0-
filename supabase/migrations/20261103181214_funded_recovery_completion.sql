-- Atomic completion of the reviewed funded-work recovery.
-- New preflight policies remain disabled until exact web/worker verification.
begin;

-- BEGIN CONFIG owner-preflight-list-indexing
-- Keep the original, exactly identified free list while its provider/search
-- indexes catch up. Never recreate it or weaken the final positive-count gate.
set local lock_timeout='5s';
set local statement_timeout='30s';

alter table icash_research_private.owner_export_settings add column preflight_indexing_enabled boolean not null default false;

alter table icash_research_private.owner_export_preflights
 add column indexing_checks integer not null default 0 check(indexing_checks between 0 and 6),
 add column indexing_next_step text check(indexing_next_step in ('metadata','baseline')),
 add column indexing_reason text check(indexing_reason in ('provider_list_building','provider_search_indexing','provider_indexing_exhausted','provider_list_status_invalid'));

create function icash_research_private.owner_preflight_list_known(p_id uuid,p_complete boolean default false) returns boolean
language plpgsql stable set search_path='' as $$
declare p icash_research_private.owner_export_preflights;r jsonb;d jsonb;n integer;valid boolean;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_id;
 if not found or jsonb_typeof(p.request->'people_ids') is distinct from 'array' then return false;end if;
 n:=jsonb_array_length(p.request->'people_ids');
 r:=p.receipts->'create';d:=r->'raw'->'data';
 begin
  valid:=n between 1 and 125 and r->'httpStatus'='200'::jsonb and (r->>'rawText')::jsonb=r->'raw'
   and jsonb_typeof(p.list_id) in ('string','number') and (p.list_id#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
   and d->'list_id'=p.list_id and d->>'name'=p.list_name and d->>'source_type'='people'
   and d->>'status' in ('idle','building','completed')
   and jsonb_typeof(d->'total_count')='number' and (d->>'total_count') ~ '^[0-9]{1,3}$'
   and (d->>'total_count')::integer between 0 and n
   and (not r->'raw' ? 'credits' or (jsonb_typeof(r->'raw'->'credits')='object'
    and not exists(select 1 from jsonb_each(r->'raw'->'credits') c where c.value is distinct from '0'::jsonb)));
  if valid is distinct from true then return false;end if;
  if not p_complete or (d->>'status'='completed' and d->'total_count'=to_jsonb(n)) then return true;end if;
  r:=p.receipts->'metadata';d:=r->'raw'->'data';
  return (r->'httpStatus'='200'::jsonb and (r->>'rawText')::jsonb=r->'raw'
   and d->'list_id'=p.list_id and d->>'name'=p.list_name and d->>'source_type'='people'
   and d->>'status'='completed' and d->'total_count'=to_jsonb(n)
   and (not r->'raw' ? 'credits' or (jsonb_typeof(r->'raw'->'credits')='object'
    and not exists(select 1 from jsonb_each(r->'raw'->'credits') c where c.value is distinct from '0'::jsonb)))) is true;
 exception when others then return false;
 end;
end $$;

create function icash_research_private.record_owner_preflight_indexing(p_id uuid,p_lease uuid,p_step text,p_receipt jsonb) returns text
language plpgsql set search_path='' as $$
declare p icash_research_private.owner_export_preflights;r jsonb;d jsonb;n integer;valid boolean:=false;k text;complete boolean:=false;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_id for update;
 if not found or p.lease is distinct from p_lease or p_receipt is null or octet_length(p_receipt::text)>2200000
  or p_step not in ('create','metadata','baseline') then return 'held';end if;
 k:=case when p_step='create' then 'create' else 'indexing:'||p_lease||':'||p_step end;
 if p.receipts ? k then return case when p.receipts->k=p_receipt then case when p.state='waiting' then 'pending' else p.state end else 'held' end;end if;
 if (p_step='create' and p.state<>'creating') or (p_step<>'create' and p.state<>'checking')
  or p.deleted_at is not null or p.cleanup_attempts<>0 or p.created_at<=clock_timestamp()-interval '30 minutes'
  or p.created_at>clock_timestamp() or p.started_at<=clock_timestamp()-interval '90 seconds'
  or (p_step<>'create' and not icash_research_private.owner_preflight_list_known(p.id)) then return 'held';end if;
 -- Every observation is appended under its one-use handler, including malformed
 -- metadata. A later successful check never overwrites an earlier zero/error.
 update icash_research_private.owner_export_preflights set receipts=receipts||jsonb_build_object(k,p_receipt) where id=p.id;
 begin
  r:=p_receipt->'raw';d:=r->'data';n:=jsonb_array_length(p.request->'people_ids');
  valid:=p_receipt->'httpStatus'='200'::jsonb and (p_receipt->>'rawText')::jsonb=r and n between 1 and 125
   and (not r ? 'credits' or (jsonb_typeof(r->'credits')='object'
    and not exists(select 1 from jsonb_each(r->'credits') c where c.value is distinct from '0'::jsonb)));
  if p_step in ('create','metadata') then
   valid:=valid and jsonb_typeof(d->'list_id') in ('string','number') and (d->'list_id'#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
    and (p_step='create' or d->'list_id'=p.list_id) and d->>'name'=p.list_name and d->>'source_type'='people'
    and d->>'status' in ('idle','building','completed') and jsonb_typeof(d->'total_count')='number'
    and (d->>'total_count') ~ '^[0-9]{1,3}$' and (d->>'total_count')::integer between 0 and n;
   complete:=valid is true and d->>'status'='completed' and d->'total_count'=to_jsonb(n);
  else
   valid:=valid and icash_research_private.owner_preflight_list_known(p.id,true)
    and jsonb_typeof(r->'total_people')='number' and (r->>'total_people') ~ '^[0-9]{1,3}$'
    and (r->>'total_people')::integer between 0 and n-1 and r->'total_results'=r->'total_people'
    and jsonb_typeof(r->'total_properties')='number' and (r->>'total_properties') ~ '^[0-9]{1,10}$' and not r ? 'data';
  end if;
 exception when others then valid:=false;
 end;
 if valid is distinct from true then
  update icash_research_private.owner_export_preflights set state='held',checked_at=clock_timestamp(),indexing_reason='provider_list_status_invalid' where id=p.id;
  return 'held';
 end if;
 if p_step='create' then
  update icash_research_private.owner_export_preflights set list_id=d->'list_id',state='waiting',next_check_at=least(created_at+interval '30 minutes',clock_timestamp()+interval '90 seconds'),
   indexing_next_step='metadata',indexing_reason='provider_list_building' where id=p.id;
  return 'pending';
 end if;
 if p_step='metadata' and complete then
  update icash_research_private.owner_export_preflights set receipts=receipts||jsonb_build_object('metadata',p_receipt),
   indexing_next_step='baseline',indexing_reason='provider_search_indexing' where id=p.id and not receipts ? 'metadata';
  return 'checking';
 end if;
 if greatest(p.indexing_checks,1)>=6 then
  update icash_research_private.owner_export_preflights set state='held',checked_at=clock_timestamp(),indexing_checks=6,
   indexing_reason='provider_indexing_exhausted' where id=p.id;
  return 'held';
 end if;
 update icash_research_private.owner_export_preflights set state='waiting',indexing_checks=greatest(indexing_checks,1),
  indexing_next_step=case when p_step='metadata' then 'metadata' else 'baseline' end,
  indexing_reason=case when p_step='metadata' then 'provider_list_building' else 'provider_search_indexing' end,
  next_check_at=least(created_at+interval '30 minutes',clock_timestamp()+interval '90 seconds') where id=p.id;
 return 'pending';
end $$;

do $patch$
declare d text;needle text;replacement text;signature text;created text;expected text;
begin
 for signature,expected in select * from (values
  ('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)','1d6e3b374d07415593a4158840260a5a'),
  ('public.icash_record_owner_preflight(uuid,uuid,text,jsonb)','f9f677642b85267f8f3b199b81f74d7a'),
  ('public.icash_claim_owner_preflight_cleanup(uuid)','47ed003af6353c9a41336b9d859d90da'),
  ('public.icash_defer_owner_preflight(uuid,uuid,uuid,text,text)','fb031f5e049b7181d6be0eb7ad6eb1dd'),
  ('icash_research_private.owner_preflight_cohort(uuid,uuid)','2f0cae49088ef7457180deb94e30b634'),
  ('public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)','6ae55612293ca698391f2f2fcca939eb'),
  ('public.icash_owner_preflight_due_at(uuid,uuid)','fc16398c43e96cd241a63e32cae07707'),
  ('icash_research_private.owner_preflight_ready_current(uuid)','f8d62d79349450db162734f0f5de226d')) reviewed(signature,hash)
 loop
  if md5(pg_get_functiondef(signature::regprocedure))<>expected then raise exception 'Preflight indexing prerequisite changed: %',signature;end if;
 end loop;
 d:=pg_get_functiondef('public.icash_record_owner_preflight(uuid,uuid,text,jsonb)'::regprocedure);
 needle:='p_step not in (''create'',''baseline'',''eligible'')';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing recorder steps changed';end if;
 d:=replace(d,needle,'p_step not in (''create'',''baseline'',''eligible'',''metadata'')');
 needle:='if p.receipts ? p_step then';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing receipt guard changed';end if;
 d:=replace(d,needle,$new$if exists(select 1 from icash_research_private.owner_export_settings where id=1 and preflight_indexing_enabled) and (p_step='metadata'
  or (p_step='create' and p_receipt->'raw'->'data'->>'status' in ('idle','building'))
  or (p_step='baseline' and jsonb_typeof(p_receipt->'raw'->'total_people')='number'
   and (p_receipt->'raw'->>'total_people') ~ '^[0-9]{1,3}$'
   and (p_receipt->'raw'->>'total_people')::integer<jsonb_array_length(p.request->'people_ids'))) then
  return icash_research_private.record_owner_preflight_indexing(p_id,p_lease,p_step,p_receipt);
 end if;
 if p_step='metadata' or (p.indexing_next_step='metadata' and p_step in ('baseline','eligible')) then return 'held';end if;
 if p.receipts ? p_step then$new$);
 needle:='if p_step=''baseline'' then return ''checking'';end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing final gate changed';end if;
 execute replace(d,needle,needle||E'\n update icash_research_private.owner_export_preflights set indexing_next_step=null,indexing_reason=null where id=p.id;');

 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 needle:='update icash_research_private.owner_export_preflights set state=''checking'',lease=gen_random_uuid(),started_at=clock_timestamp()';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing check claim changed';end if;
 d:=replace(d,needle,$new$if p.indexing_next_step is not null and (p.indexing_checks>=6 or not exists(
   select 1 from icash_research_private.owner_export_settings where id=1 and preflight_indexing_enabled)) then return '{"status":"held"}';end if;
  update icash_research_private.owner_export_preflights set indexing_checks=indexing_checks+case when indexing_next_step is null then 0 else 1 end,state='checking',lease=gen_random_uuid(),started_at=clock_timestamp()$new$);
 needle:='''mobileOnly'',p.request->''mobile_only''=''true''::jsonb)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing claim output changed';end if;
 execute replace(d,needle,'''mobileOnly'',p.request->''mobile_only''=''true''::jsonb,''nextStep'',p.indexing_next_step)');

 d:=pg_get_functiondef('public.icash_defer_owner_preflight(uuid,uuid,uuid,text,text)'::regprocedure);
 needle:='return public.icash_defer_owner_enrichment(p_id,p_account,p_screening,p_token,p_operation);';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing retry delegation changed';end if;
 execute replace(d,needle,$new$if not public.icash_defer_owner_enrichment(p_id,p_account,p_screening,p_token,p_operation) then return false;end if;
 -- Do not consume another ticket merely to rediscover the same 90-second wait.
 -- The existing retry count/deadline and all original authorization stay intact.
 update public.icash_automation_tickets t set owner_preview_retry_after=greatest(t.owner_preview_retry_after,(
  select max(p.next_check_at) from icash_research_private.owner_export_preflights p
  join icash_research_private.owner_export_preflight_items i on i.preflight_id=p.id and i.account_id=p.account_id
  join public.icash_screening_jobs s on s.id=i.screening_id and s.account_id=i.account_id
  where i.account_id=p_account and i.screening_id=p_screening and i.snapshot_hash=md5(s.snapshot::text)
   and p.state='waiting' and p.indexing_next_step is not null and p.created_at>clock_timestamp()-interval '30 minutes'
   and p.deleted_at is null and p.cleanup_attempts=0))
 where t.id=p_id and t.account_id=p_account and t.screening_id=p_screening and t.token=p_token
  and t.state='held' and t.outcome='owner_preview_rate_limited';
 return true;$new$);

 -- Preserve the already-installed cohort/cleanup/priority windows and every
 -- account/source/financial predicate; only recognize the original known list.
 created:=$proof$p.list_id is not null and p.receipts->'create'->'httpStatus'='200'::jsonb
 and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
 and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
 and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
 and p.receipts->'create'->'raw'->'data'->>'status'='completed'
 and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(jsonb_array_length(p.request->'people_ids'))$proof$;
 foreach signature in array array['icash_research_private.owner_preflight_cohort(uuid,uuid)','public.icash_owner_preflight_sibling_waiting(uuid,uuid,jsonb,uuid)','public.icash_claim_owner_preflight_cleanup(uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:=case when signature like '%cleanup%' then replace(created,'p.','') else created end;
  replacement:=case when signature like '%cleanup%' then 'icash_research_private.owner_preflight_list_known(id)' else 'icash_research_private.owner_preflight_list_known(p.id)' end;
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing list lifetime proof changed: %',signature;end if;
  execute replace(d,needle,replacement);
 end loop;
 d:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);
 needle:=$proof$and jsonb_typeof(p.list_id) in ('string','number') and (p.list_id#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
   and p.receipts->'create'->'httpStatus'='200'::jsonb
   and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
   and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
   and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
   and p.receipts->'create'->'raw'->'data'->>'status'='completed'
   and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(
    case when jsonb_typeof(p.request->'people_ids')='array' then jsonb_array_length(p.request->'people_ids') end)$proof$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing due proof changed';end if;
 execute replace(d,needle,'and icash_research_private.owner_preflight_list_known(p.id)');
 d:=pg_get_functiondef('icash_research_private.owner_preflight_ready_current(uuid)'::regprocedure);
 needle:=$proof$and raw->'data'->>'source_type'='people' and raw->'data'->>'status'='completed'
   and raw->'data'->'total_count'=to_jsonb(n)$proof$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Preflight indexing ready proof changed';end if;
 execute replace(d,needle,'and raw->''data''->>''source_type''=''people'' and icash_research_private.owner_preflight_list_known(p.id,true)');
end $patch$;
revoke all on function icash_research_private.owner_preflight_list_known(uuid,boolean),icash_research_private.record_owner_preflight_indexing(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
-- END CONFIG owner-preflight-list-indexing

-- BEGIN CONFIG owner-preflight-quota-recovery
-- Resume only a free request that the shared limiter durably refused locally.
-- Original provider receipts, leases, paid operations and financial holds stay intact.
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
-- END CONFIG owner-preflight-quota-recovery

-- BEGIN CONFIG seller-opener-literal-ampersand
-- Preserve literal saved identity punctuation already counted as one GSM unit.
-- No normalization, longer copy, replay, price or contact-authority changes.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare item record;d text;original text;needle text:='[^A-Za-z0-9 .,!?]';replacement text:='[^A-Za-z0-9 .,!?&]';
begin
 for item in select * from(values
  ('icash_seller_identity_opener(text,text)','4da84d4880ec9f7ad128761e5358a5b4',1),
  ('icash_seller_recipient_opener(uuid,uuid,text,text,text)','447fff1b6f7f1e641df6e1e400fc7c67',1),
  ('icash_seller_opener_candidate_body(uuid,uuid)','57b038641afe4800048966a3ce6e3595',1),
  ('icash_queue_seller_opener(uuid,uuid)','95f6c8570b66d80578ca48347715fe12',2)
 ) expected(signature,checksum,occurrences) loop
  d:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
  original:=replace(d,replacement,needle);
  if md5(original)<>item.checksum or (length(original)-length(replace(original,needle,'')))<>length(needle)*item.occurrences then
   raise exception 'Seller opener identity prerequisite changed: %',item.signature;
  end if;
  if d=replace(original,needle,replacement) then continue;end if;
  if d<>original then raise exception 'Partially updated seller opener identity: %',item.signature;end if;
  execute replace(original,needle,replacement);
 end loop;
end $patch$;

-- END CONFIG seller-opener-literal-ampersand

-- BEGIN CONFIG text-receipt-queue-fairness
-- Fair selection of original receipt reads; no sends, new quota or financial writes.
-- Preserve the existing global lock, three/minute control, eight checks and backoff.
set local lock_timeout='2s';
create index icash_text_receipt_schedule_due
 on icash_text_receipt_private.schedule(next_check_at,message_id) where attempts<8;
do $patch$
declare
 definition text:=pg_get_functiondef('public.icash_claim_text_delivery_rechecks()'::regprocedure);
 needle text:=$needle$  select m.id,m.account_id,m.thread_id,m.provider_id,m.body,m.attachments,m.created_at,t.sender,t.recipient,
   to_jsonb(o) operation,coalesce(s.attempts,0) attempts
  from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  join public.icash_operation_rates r on r.id=o.rate_id and r.operation in ('sms_send','mms_send')
  left join icash_text_receipt_private.schedule s on s.message_id=m.id
  where m.direction='outgoing' and m.state='accepted' and m.provider_id is not null and m.last_delivery_at is null
   and m.created_at<=now()-interval '10 minutes' and o.state='settled' and o.settled_at is not null
   and o.dispatched_at is not null and coalesce(s.attempts,0)<8 and (s.next_check_at is null or s.next_check_at<=now())
  order by s.next_check_at nulls first,m.created_at,m.id limit 3 for update of m skip locked$needle$;
 replacement text:=$replacement$  -- Reserve one slot for each nonempty class, then the oldest eligible third.
  -- Each class is capped before ranking: at most six rows are materialized/locked.
  with due as materialized (
  select m.id,m.account_id,m.thread_id,m.provider_id,m.body,m.attachments,m.created_at,t.sender,t.recipient,
   to_jsonb(o) operation,coalesce(s.attempts,0) attempts,
   coalesce(s.next_check_at,m.created_at+interval '10 minutes') eligible_at
  from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  join public.icash_operation_rates r on r.id=o.rate_id and r.operation in ('sms_send','mms_send')
  join icash_text_receipt_private.schedule s on s.message_id=m.id
  where m.direction='outgoing' and m.state='accepted' and m.provider_id is not null and m.last_delivery_at is null
   and m.created_at<=now()-interval '10 minutes' and o.state='settled' and o.settled_at is not null
   and o.dispatched_at is not null and s.attempts<8 and s.next_check_at<=now()
   and s.message_id is not null
  order by s.next_check_at,m.created_at,m.id limit 3 for update of m skip locked
  ), fresh as materialized (
  select m.id,m.account_id,m.thread_id,m.provider_id,m.body,m.attachments,m.created_at,t.sender,t.recipient,
   to_jsonb(o) operation,coalesce(s.attempts,0) attempts,
   coalesce(s.next_check_at,m.created_at+interval '10 minutes') eligible_at
  from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  join public.icash_operation_rates r on r.id=o.rate_id and r.operation in ('sms_send','mms_send')
  left join icash_text_receipt_private.schedule s on s.message_id=m.id
  where m.direction='outgoing' and m.state='accepted' and m.provider_id is not null and m.last_delivery_at is null
   and m.created_at<=now()-interval '10 minutes' and o.state='settled' and o.settled_at is not null
   and o.dispatched_at is not null and coalesce(s.attempts,0)<8 and (s.next_check_at is null or s.next_check_at<=now())
   and s.message_id is null
  order by m.created_at,m.id limit 3 for update of m skip locked
  ), candidates as (
   select due.*,row_number() over(order by eligible_at,created_at,id) ordinal from due
   union all
   select fresh.*,row_number() over(order by eligible_at,created_at,id) ordinal from fresh
  )
  -- Do not copy helper columns into the immutable, exact-source request object.
  select id,account_id,thread_id,provider_id,body,attachments,created_at,sender,recipient,operation,attempts
  from candidates order by (ordinal=1) desc,eligible_at,created_at,id limit 3$replacement$;
begin
 if md5(definition)<>'d1ee0fda63cf1de46b883585aadc8e85' then
  raise exception 'Original canonical text receipt claim changed';
 end if;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Original canonical text receipt selection changed';
 end if;
 execute replace(definition,needle,replacement);
end $patch$;
-- END CONFIG text-receipt-queue-fairness

-- BEGIN CONFIG owner-retry-fair-priority
-- Keep due, proven-unstarted retry families visible when no saved list remains.
-- Ranking only: the original candidate and renewal checks still authorize work.
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))<>'c7902fc7af9afac890d7e927454e8726'
  or md5(pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure))<>'100ad1fa690b1979e00388e6799a467a' then
  raise exception 'Owner retry priority prerequisite changed';
 end if;
end $guard$;

-- Distinct from the issued/consumed active-ticket index. Only the finite held
-- retry family enters this ordered lookup, never the full ticket history.
create index icash_automation_owner_retry_due on public.icash_automation_tickets(account_id,owner_preview_retry_after,id)
 include(owner_preview_retry_until)
 where kind='contacts' and state='held' and outcome='owner_preview_rate_limited' and owner_preview_deferrals between 1 and 7;

create function public.icash_owner_retry_due_at(p_account uuid) returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare due_at timestamptz;
begin
 select t.owner_preview_retry_after into due_at from public.icash_automation_tickets t
  where t.account_id=p_account and t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited'
   and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=now() and t.owner_preview_retry_until>now()
  order by t.owner_preview_retry_after,t.id limit 1;
 -- Ordinary accounts do no added membership/budget work in account ordering.
 if not found then return null;end if;
 if not exists(
  select 1 from public.icash_discovery_configs c
  join public.icash_accounts a on a.id=c.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
  join public.icash_operation_rates r on r.id=c.contact_rate_id and r.operation='owner_enrichment'
   and r.enabled and r.verified_at<=now() and r.expires_at>now()
  where c.account_id=p_account and c.enabled and c.auto_enabled and c.contacts_enabled and c.data_rights_until>now()
   and jsonb_typeof(r.costs_micros->'dealmachine')='number'
   and c.contact_credit_cap::numeric*c.property_credit_micros<=case when jsonb_typeof(r.costs_micros->'dealmachine')='number' then (r.costs_micros->>'dealmachine')::numeric end
   and exists(select 1 from public.icash_operating_budget where id=1 and enabled)
   and public.icash_membership_work_allowed(c.account_id)
   and public.icash_prospecting_available(c.account_id)>=public.icash_research_admission_quote(c.account_id,'owner_enrichment',r.charge_cents)
   and not exists(select 1 from public.icash_billing_reviews b where b.account_id=c.account_id and b.resolved_at is null)
 ) then return null;end if;
 -- This inexpensive hint is deliberately not admission proof. The unchanged
 -- final candidate repeats retry_current, original receipt/unstarted evidence,
 -- source hash/scope, immutable approval cap, recipient controls and same-property financial holds. A stale
 -- hint can only use one of the existing five candidate slots, never issue work.
 return due_at;
end
$$;
revoke all on function public.icash_owner_retry_due_at(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_owner_retry_due_at(uuid) to service_role;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:=$old$   then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end nulls last,
  (d.next_run_at<now()-interval '5 minutes') desc,$old$;
 replacement:=$new$   then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end nulls last,
  case when d.contacts_enabled and d.contact_rate_id is not null
   and public.icash_owner_active_export_capacity() in ('disabled','ready')
   then public.icash_owner_retry_due_at(d.account_id) end nulls last,
  (d.next_run_at<now()-interval '5 minutes') desc,$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner retry account ordering changed';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 needle:=' order by public.icash_owner_preflight_due_at(p_account,s.id) nulls last,public.icash_opportunity_score';
 replacement:=$new$ order by public.icash_owner_preflight_due_at(p_account,s.id) nulls last,
  case when t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited'
   and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=now() and t.owner_preview_retry_until>now()
   then t.owner_preview_retry_after end nulls last,public.icash_opportunity_score$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner retry property ordering changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
-- END CONFIG owner-retry-fair-priority

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

commit;
