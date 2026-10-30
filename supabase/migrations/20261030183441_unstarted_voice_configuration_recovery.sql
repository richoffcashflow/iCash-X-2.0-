-- Installation is inactive until compatible production maintenance verifies the
-- existing approved provider snapshot. No dial, reservation or old ticket replay.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table icash_recording_private.configuration_recoveries(
 job_id uuid primary key references public.icash_voice_jobs(id),
 account_id uuid not null references public.icash_accounts(id),
 ticket_id uuid not null references public.icash_automation_tickets(id),
 previous_outcome text not null check(previous_outcome='production_agent_review_required'),
 previous_updated_at timestamptz not null,
 config_hash text not null check(config_hash ~ '^[a-f0-9]{64}$'),
 observed_hash text not null check(observed_hash ~ '^[a-f0-9]{64}$'),
 release_sha text not null check(release_sha ~ '^[a-f0-9]{40}$'),
 provider_checked_at timestamptz not null,
 recovered_at timestamptz not null default clock_timestamp()
);
alter table icash_recording_private.configuration_recoveries enable row level security;
revoke all on icash_recording_private.configuration_recoveries from public,anon,authenticated;
grant select,insert on icash_recording_private.configuration_recoveries to service_role;
create trigger configuration_recoveries_immutable before update or delete on icash_recording_private.configuration_recoveries
 for each row execute function icash_recording_private.audit_immutable();
create index configuration_recoveries_account_recent on icash_recording_private.configuration_recoveries(account_id,recovered_at desc);
create index icash_voice_configuration_recovery_candidates on public.icash_voice_jobs(account_id,created_at,id)
 where state='held' and outcome='production_agent_review_required' and operation_key is null;

create function public.icash_recover_voice_configuration(p_agent text,p_config_hash text,p_observed_hash text,p_release text,p_checked_at timestamptz)
returns integer language plpgsql security invoker set search_path='' as $$
declare j record;n integer:=0;checked timestamptz:=clock_timestamp();
begin
 if p_agent is null or p_agent !~ '^agent_[A-Za-z0-9]+$'
  or p_config_hash is null or p_config_hash !~ '^[a-f0-9]{64}$'
  or p_observed_hash is null or p_observed_hash !~ '^[a-f0-9]{64}$'
  or p_release is null or p_release !~ '^[a-f0-9]{40}$'
  or p_checked_at is null or p_checked_at>checked or p_checked_at<checked-interval '2 minutes' then return 0;end if;
 -- Same serialization boundary as dispatch, STOP and operation admission.
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found or not public.icash_outgoing_voice_capacity_open() then return 0;end if;
 if not exists(select 1 from public.icash_voice_production_template
  where id=1 and enabled and agent_id=p_agent and agent_config_hash=p_config_hash and reviewed_until>checked) then return 0;end if;
 for j in
  select candidate.* from (
   select v.*,target.contact_key,target.screening_id,t.id as ticket_id,
    (select max(r.recovered_at) from icash_recording_private.configuration_recoveries r where r.account_id=v.account_id) as last_recovered
   from public.icash_voice_jobs v
   join public.icash_accounts a on a.id=v.account_id and not a.bot_paused
   join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
   join public.icash_voice_configs c on c.account_id=a.id and c.enabled and c.reviewed_until>checked
    and c.agent_id=p_agent and c.agent_config_hash=p_config_hash
   join public.icash_voice_contact_targets target on target.id=coalesce(v.permission_id,v.operational_contact_id)
    and target.account_id=v.account_id and target.party='seller' and target.revoked_at is null and target.permission_until>checked
    and ((v.permission_id is not null and v.operational_contact_id is null and target.eligibility_source='operator_record')
     or (v.permission_id is null and v.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
   join public.icash_screening_jobs s on s.id=target.screening_id and s.account_id=v.account_id and s.state='complete'
    and s.result->'financialCheck'->>'status'='eligible'
    and case when pg_catalog.pg_input_is_valid(s.snapshot->>'fetchedAt','timestamptz')
     then (s.snapshot->>'fetchedAt')::timestamptz between checked-interval '24 hours' and checked else false end
   join public.icash_automation_tickets t on t.voice_job_id=v.id and t.account_id=v.account_id and t.kind='voice_dispatch'
    and t.state='held' and t.outcome='production_agent_review_required' and t.completed_at is not null and t.completed_at<=p_checked_at
    and t.expires_at<=checked
   where v.state='held' and v.outcome='production_agent_review_required' and v.due_at<=checked and v.updated_at<=p_checked_at
    and v.operation_key is null and v.provider_call_sid is null and v.conversation_id is null
    -- Requested callbacks, SMS calls and Meta sequences have their own source
    -- expiry/recovery rules. Only ordinary first seller calls enter this repair.
    and v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
    and v.meta_offer_lead_id is null and v.meta_retry_of is null and v.meta_followup_lead_id is null
    and not exists(select 1 from icash_recording_private.configuration_recoveries r where r.job_id=v.id)
    and not exists(select 1 from public.icash_automation_tickets other where other.voice_job_id=v.id and other.id<>t.id)
    and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||v.id)
    and not exists(select 1 from public.icash_call_recordings r where r.voice_job_id=v.id or r.operation_key='voice:'||v.id)
    and not exists(select 1 from public.icash_live_conversations l where l.operation_key='voice:'||v.id)
    and not exists(select 1 from public.icash_voice_jobs other
     join public.icash_voice_contact_targets ot on ot.id=coalesce(other.permission_id,other.operational_contact_id) and ot.account_id=other.account_id
     where other.id<>v.id and ot.contact_key=target.contact_key and other.state in ('ready','issued','dispatching'))
   order by last_recovered nulls first,v.created_at,v.id for update of v skip locked offset 0
  ) candidate
  where public.icash_membership_work_allowed(candidate.account_id)
   and public.icash_outreach_voice_current(candidate.account_id)
   and case when candidate.operational_contact_id is not null
    then public.icash_operational_contact_current(candidate.account_id,candidate.operational_contact_id,'voice',false)
    else public.icash_seller_voice_permission_current(candidate.account_id,candidate.permission_id) end
   and public.icash_voice_outreach_hours_current(candidate.account_id,candidate.id)
   and public.icash_seller_phone_call_current(candidate.account_id,candidate.id)
   and public.icash_voice_capacity_available(candidate.account_id,p_agent,'voice:'||candidate.id,candidate.contact_key,false)
  limit 20
 loop
  -- A row visited earlier in this batch may have queued this same recipient.
  if exists(select 1 from public.icash_voice_jobs other
   join public.icash_voice_contact_targets ot on ot.id=coalesce(other.permission_id,other.operational_contact_id) and ot.account_id=other.account_id
   where other.id<>j.id and ot.contact_key=j.contact_key and other.state in ('ready','issued','dispatching')) then continue;end if;
  update public.icash_voice_jobs set state='ready',outcome='Queued after verified calling configuration recovery',updated_at=checked where id=j.id;
  if not public.icash_voice_queue_slot_open(j.account_id,j.id) then
   update public.icash_voice_jobs set state='held',outcome=j.outcome,updated_at=j.updated_at where id=j.id;
   continue;
  end if;
  insert into icash_recording_private.configuration_recoveries(job_id,account_id,ticket_id,previous_outcome,previous_updated_at,config_hash,observed_hash,release_sha,provider_checked_at)
   values(j.id,j.account_id,j.ticket_id,j.outcome,j.updated_at,p_config_hash,p_observed_hash,p_release,p_checked_at);
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.icash_recover_voice_configuration(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_recover_voice_configuration(text,text,text,text,timestamptz) to service_role;
commit;
