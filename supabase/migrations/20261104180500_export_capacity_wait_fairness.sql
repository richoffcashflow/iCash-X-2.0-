-- Preserve acquisition aging during a shared export wait without widening scans.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

do $guard$
begin
 if md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))<>'f571e2f4e89be30c38c360b4b95b399a' then
  raise exception 'Export wait fairness prerequisite changed';
 end if;
end $guard$;

-- Keep scheduling metadata separate from reviewed discovery configuration hashes.
create table icash_work_private.acquisition_export_waits(
 account_id uuid primary key references public.icash_discovery_configs(account_id) on delete cascade,
 waiting_since timestamptz not null,
 updated_at timestamptz not null default clock_timestamp()
);
alter table icash_work_private.acquisition_export_waits enable row level security;
revoke all on icash_work_private.acquisition_export_waits from public,anon,authenticated;
grant select,insert,update,delete on icash_work_private.acquisition_export_waits to service_role;

create function icash_work_private.record_export_wait(p_account uuid,p_due timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $function$
begin
 -- Called only for an already locked member of the original five-row scan.
 -- Preserve existing eligibility and require a real, funded contact candidate.
 if p_due is null or p_due>now() or not exists(
  select 1 from public.icash_discovery_configs c where c.account_id=p_account and c.next_run_at=p_due
   and c.contacts_enabled and c.contact_rate_id is not null)
  or public.icash_owner_active_export_capacity(p_account) is distinct from 'export_busy' then return false;end if;
 if public.icash_enrichment_before_provider_quota(p_account) is null then return false;end if;
 insert into icash_work_private.acquisition_export_waits(account_id,waiting_since)
  values(p_account,p_due)
 on conflict(account_id) do update set updated_at=clock_timestamp();
 -- The saved original due time supplies aging; polling keeps its old cooldown.
 update public.icash_discovery_configs set next_run_at=now()+interval '60 seconds' where account_id=p_account;
 return true;
end $function$;
revoke all on function icash_work_private.record_export_wait(uuid,timestamptz) from public,anon,authenticated;
grant execute on function icash_work_private.record_export_wait(uuid,timestamptz) to service_role;

do $patch$
declare d text:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);needle text;replacement text;
begin
 needle:=' join public.icash_wallets w on w.account_id=a.id';
 replacement:=needle||E'\n left join icash_work_private.acquisition_export_waits export_wait on export_wait.account_id=d.account_id';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Acquisition join changed';end if;
 d:=replace(d,needle,replacement);
 d:=replace(d,'case when d.next_run_at<now()-interval ''10 minutes'' then d.next_run_at end',
  'case when coalesce(export_wait.waiting_since,d.next_run_at)<now()-interval ''10 minutes'' then coalesce(export_wait.waiting_since,d.next_run_at) end');
 d:=replace(d,'(d.next_run_at<now()-interval ''5 minutes'') desc',
  '(coalesce(export_wait.waiting_since,d.next_run_at)<now()-interval ''5 minutes'') desc');
 d:=replace(d,'case when d.next_run_at<now()-interval ''5 minutes'' then d.next_run_at end',
  'case when coalesce(export_wait.waiting_since,d.next_run_at)<now()-interval ''5 minutes'' then coalesce(export_wait.waiting_since,d.next_run_at) end');
 needle:=' allowance:=public.icash_prospecting_available(c.account_id);';
 replacement:=E' if icash_work_private.record_export_wait(c.account_id,c.next_run_at) then continue;end if;\n'||needle;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Acquisition allowance changed';end if;
 d:=replace(d,needle,replacement);
 -- Capacity can become busy after selection. Recheck before either existing
 -- no-work cooldown; do not erase age because another account won the export.
 needle:='  update public.icash_discovery_configs set next_run_at=now()+interval ''60 seconds'' where account_id=c.account_id;';
 replacement:=E'  if icash_work_private.record_export_wait(c.account_id,c.next_run_at) then continue;end if;\n'
  ||E'  delete from icash_work_private.acquisition_export_waits where account_id=c.account_id;\n'||needle;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Acquisition no-work cooldown changed';end if;
 d:=replace(d,needle,replacement);
 needle:=' update public.icash_discovery_configs set next_run_at=now()+interval ''5 seconds'' where account_id=c.account_id;';
 replacement:=E' delete from icash_work_private.acquisition_export_waits where account_id=c.account_id;\n'||needle;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Acquisition issue cooldown changed';end if;
 d:=replace(d,needle,replacement);
 execute d;
end $patch$;
commit;
