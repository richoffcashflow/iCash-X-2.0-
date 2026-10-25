-- Capacity quarantine is not a provider failure receipt or financial settlement.
-- The original operation, recipient exclusion, ticket and money holds survive.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table icash_recording_private.capacity_quarantines (
 operation_key text primary key,
 account_id uuid not null,
 voice_job_id uuid not null unique,
 recording_id uuid unique,
 contact_key text not null,
 reason text not null check(reason in ('expired_unstarted_recording','expired_unknown_dispatch')),
 quarantined_at timestamptz not null default clock_timestamp(),
 evidence jsonb not null check(jsonb_typeof(evidence)='object'),
 check(operation_key='voice:'||voice_job_id),
 foreign key(operation_key,account_id) references public.icash_operation_spend(operation_key,account_id)
);
create index icash_voice_quarantine_contact on icash_recording_private.capacity_quarantines(contact_key);
alter table icash_recording_private.capacity_quarantines enable row level security;
revoke all on icash_recording_private.capacity_quarantines from public,anon,authenticated,service_role;
create trigger icash_voice_quarantine_immutable before update or delete on icash_recording_private.capacity_quarantines
 for each row execute function icash_recording_private.audit_immutable();
create trigger icash_voice_quarantine_no_truncate before truncate on icash_recording_private.capacity_quarantines
 for each statement execute function icash_recording_private.audit_immutable();
create table icash_recording_private.capacity_sweep (
 id integer primary key check(id=1),next_check_at timestamptz not null,
 last_scanned_at timestamptz,last_scanned_job uuid
);
insert into icash_recording_private.capacity_sweep(id,next_check_at) values(1,now());
alter table icash_recording_private.capacity_sweep enable row level security;
revoke all on icash_recording_private.capacity_sweep from public,anon,authenticated,service_role;

create function public.icash_quarantine_stalled_voice_slots(p_limit integer default 20) returns integer
language plpgsql security definer set search_path='' as $$
declare candidate record;j public.icash_voice_jobs;o public.icash_operation_spend;r public.icash_call_recordings;
 t timestamptz:=clock_timestamp();cutoff timestamptz:=t-interval '20 minutes';n integer:=0;contact text;
 cursor_at timestamptz;cursor_job uuid;scanned boolean:=false;
begin
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'Invalid capacity sweep limit';end if;
 -- Never queue a scheduler behind another sweep or a spending transaction.
 select last_scanned_at,last_scanned_job into cursor_at,cursor_job
 from icash_recording_private.capacity_sweep where id=1 and next_check_at<=t for update skip locked;
 if not found then return 0;end if;
 update icash_recording_private.capacity_sweep set next_check_at=t+interval '30 seconds' where id=1;
 for candidate in
  select v.id,v.account_id,v.operation_key,s.dispatched_at from public.icash_voice_jobs v
  join public.icash_operation_spend s on s.operation_key='voice:'||v.id and s.account_id=v.account_id and s.operation_key=v.operation_key
  where (v.state='dispatching' or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))
   and v.provider_call_sid is null and v.conversation_id is null and s.state='dispatched' and s.dispatched_at<=cutoff
   and (cursor_at is null or (s.dispatched_at,v.id)>(cursor_at,cursor_job))
   and not exists(select 1 from icash_recording_private.capacity_quarantines q where q.operation_key=s.operation_key)
   and not exists(select 1 from public.icash_live_conversations l where l.operation_key=s.operation_key)
   and not exists(select 1 from public.icash_call_recordings candidate_record where (candidate_record.operation_key=s.operation_key or candidate_record.voice_job_id=v.id)
    and (candidate_record.account_id is distinct from s.account_id or candidate_record.entry_policy<>'direct_recorded_v1' or candidate_record.state not in ('consent_pending','failed','declined')
     or candidate_record.created_at>cutoff or candidate_record.consent_deadline_at>cutoff or candidate_record.dial_claimed_at>cutoff
     or candidate_record.call_sid is not null or candidate_record.recording_sid is not null or candidate_record.conversation_id is not null or candidate_record.consent_at is not null
     or candidate_record.recording_authorized_at is not null or candidate_record.start_claimed_at is not null or candidate_record.provider_started_at is not null or candidate_record.final_provider_started_at is not null or candidate_record.call_ended_at is not null))
   and not exists(select 1 from public.icash_automation_tickets ticket where ticket.voice_job_id=v.id and (ticket.expires_at>cutoff or ticket.state='issued'))
   and (exists(select 1 from public.icash_call_recordings candidate_record where candidate_record.operation_key=s.operation_key)
    or exists(select 1 from public.icash_automation_tickets ticket where ticket.voice_job_id=v.id and ticket.account_id=v.account_id
     and ticket.state='held' and ticket.outcome='provider_outcome_unknown_no_retry' and ticket.completed_at>=s.dispatched_at and ticket.completed_at<=cutoff))
  order by s.dispatched_at,v.id limit p_limit
 loop
  scanned:=true;
  update icash_recording_private.capacity_sweep set last_scanned_at=candidate.dispatched_at,last_scanned_job=candidate.id where id=1;
  -- Healthy sweeps never acquire the shared spending lock.
  perform 1 from public.icash_operating_budget where id=1 for update skip locked;
  if not found then return n;end if;
  select * into o from public.icash_operation_spend where operation_key=candidate.operation_key and account_id=candidate.account_id for update skip locked;
  if not found or o.state<>'dispatched' or o.dispatched_at is null or o.dispatched_at>cutoff then continue;end if;
  select * into r from public.icash_call_recordings where operation_key=o.operation_key or voice_job_id=candidate.id for update skip locked;
  if not found and exists(select 1 from public.icash_call_recordings where operation_key=o.operation_key or voice_job_id=candidate.id) then continue;end if;
  select * into j from public.icash_voice_jobs where id=candidate.id and account_id=o.account_id for update skip locked;
  if not found or j.operation_key is distinct from o.operation_key or j.provider_call_sid is not null or j.conversation_id is not null
   or not (j.state='dispatching' or j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) then continue;end if;
  if not exists(select 1 from public.icash_operation_rates rate where rate.id=o.rate_id and rate.operation='seller_call' and rate.voice_max_duration_seconds=600)
   or exists(select 1 from public.icash_live_conversations l where l.operation_key=o.operation_key)
   or exists(select 1 from public.icash_automation_tickets ticket where ticket.voice_job_id=j.id
    and (ticket.account_id is distinct from j.account_id or ticket.kind<>'voice_dispatch' or ticket.expires_at>cutoff or ticket.state='issued'))
   or not exists(select 1 from public.icash_automation_tickets ticket where ticket.voice_job_id=j.id and ticket.account_id=j.account_id
    and ticket.kind='voice_dispatch' and ticket.created_at<=o.dispatched_at and ticket.expires_at>=o.dispatched_at
    and ticket.expires_at<=cutoff and ticket.state in ('consumed','held')) then continue;end if;
  contact:=null;
  if r.id is not null then
   if r.account_id is distinct from o.account_id or r.operation_key is distinct from o.operation_key or r.voice_job_id is distinct from j.id
    or r.entry_policy<>'direct_recorded_v1' or r.state not in ('consent_pending','failed','declined')
    or r.max_total_seconds not between 120 and 600 or r.created_at>cutoff or r.consent_deadline_at>cutoff
    or r.dial_claimed_at>cutoff or r.call_sid is not null or r.recording_sid is not null or r.conversation_id is not null
    or r.consent_at is not null or r.recording_authorized_at is not null or r.start_claimed_at is not null
    or r.provider_started_at is not null or r.final_provider_started_at is not null or r.call_ended_at is not null then continue;end if;
   contact:=r.contact_key;
  else
   -- Legacy dispatch has no recording. Its consumed handler must have explicitly
   -- closed with an unknown outcome; age alone cannot establish this condition.
   if j.state<>'held' or j.outcome<>'provider_outcome_unknown_no_retry'
    or not exists(select 1 from public.icash_automation_tickets ticket where ticket.voice_job_id=j.id and ticket.account_id=j.account_id
     and ticket.kind='voice_dispatch' and ticket.state='held' and ticket.outcome='provider_outcome_unknown_no_retry'
     and ticket.created_at<=o.dispatched_at and ticket.expires_at>=o.dispatched_at
     and ticket.completed_at>=o.dispatched_at and ticket.completed_at<=cutoff) then continue;end if;
   select target.contact_key into contact from public.icash_voice_contact_targets target
    where target.id=coalesce(j.permission_id,j.operational_contact_id) and target.account_id=j.account_id;
  end if;
  if contact is null then continue;end if;
  insert into icash_recording_private.capacity_quarantines(operation_key,account_id,voice_job_id,recording_id,contact_key,reason,evidence)
  values(o.operation_key,o.account_id,j.id,r.id,contact,case when r.id is null then 'expired_unknown_dispatch' else 'expired_unstarted_recording' end,
   jsonb_build_object('policy','unstarted-capacity-20261025','dispatchedAt',o.dispatched_at,'jobState',j.state,'jobOutcome',j.outcome,
    'recordingState',r.state,'dialClaimedAt',r.dial_claimed_at,'startDeadline',r.consent_deadline_at,'maxSeconds',r.max_total_seconds,
    'providerOutcome','unknown','financialHold','unchanged','retryAllowed',false)) on conflict do nothing;
  if found then n:=n+1;end if;
 end loop;
 if not scanned then update icash_recording_private.capacity_sweep set last_scanned_at=null,last_scanned_job=null where id=1;end if;
 return n;
end $$;
revoke all on function public.icash_quarantine_stalled_voice_slots(integer) from public,anon,authenticated;
grant execute on function public.icash_quarantine_stalled_voice_slots(integer) to service_role;

-- Retain the exact existing receipt exclusions for both capacity and contact holds.
do $copy$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_active_voice_slots()'::regprocedure);
 if position('icash_recording_private.call_creation_rejections' in d)=0 or position('offset 0' in d)=0 then raise exception 'Capacity prerequisite changed';end if;
 execute replace(d,'public.icash_active_voice_slots()','public.icash_voice_contact_holds()');
end $copy$;
revoke all on function public.icash_voice_contact_holds() from public,anon,authenticated;
grant execute on function public.icash_voice_contact_holds() to service_role;
create or replace function public.icash_active_voice_slots()
returns table(operation_key text,account_id uuid,agent_id text,contact_key text)
language sql stable security definer set search_path='' as $$
 select s.* from public.icash_voice_contact_holds() s where not exists(
  select 1 from icash_recording_private.capacity_quarantines q
  where q.operation_key=s.operation_key and q.account_id=s.account_id
   and not exists(select 1 from public.icash_voice_jobs j where j.id=q.voice_job_id and (j.provider_call_sid is not null or j.conversation_id is not null))
   and not exists(select 1 from public.icash_call_recordings r where r.operation_key=q.operation_key
    and (r.call_sid is not null or r.recording_sid is not null or r.conversation_id is not null or r.consent_at is not null
     or r.recording_authorized_at is not null or r.start_claimed_at is not null or r.provider_started_at is not null or r.final_provider_started_at is not null))
   and not exists(select 1 from public.icash_live_conversations l where l.operation_key=q.operation_key)
 );
$$;
-- Preserve same-recipient exclusion even if a source contact later changes.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_voice_capacity_available(uuid,text,text,text,boolean)'::regprocedure);
 needle:=' if contact_busy or busy>=total_limit or agent_busy>=agent_limit then return false;end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Capacity admission prerequisite changed';end if;
 execute replace(d,needle,$new$
 select contact_busy or exists(select 1 from public.icash_voice_contact_holds() s where s.operation_key is distinct from p_operation and s.contact_key=p_contact)
  or exists(select 1 from icash_recording_private.capacity_quarantines q where q.contact_key=p_contact
   and exists(select 1 from public.icash_voice_contact_holds() held where held.operation_key=q.operation_key and held.account_id=q.account_id))
 into contact_busy;
 if contact_busy or busy>=total_limit or agent_busy>=agent_limit then return false;end if;$new$);
 -- This helper now reads the private quarantine registry through a fixed path.
 alter function public.icash_voice_capacity_available(uuid,text,text,text,boolean) security definer;

 d:=pg_get_functiondef('public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)'::regprocedure);
 needle:=' t:=icash_recording_private.clock_now();ns:=r.state;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Recording transition prerequisite changed';end if;
 execute replace(d,needle,needle||$fence$
 -- Locked recording serializes this fence with capacity quarantine. Late binding,
 -- stop, reconciliation and original terminal receipts remain available.
 if p_action in ('claim_dial','consent','notice_continue','authorize_recording','claim_start')
  and exists(select 1 from icash_recording_private.capacity_quarantines q where q.operation_key=r.operation_key)
 then return null;end if;$fence$);

 d:=pg_get_functiondef('public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb)'::regprocedure);
 needle:=' perform 1 from public.icash_operating_budget where id=1 for update;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Recording creation prerequisite changed';end if;
 execute replace(d,needle,needle||$fence$
 if exists(select 1 from icash_recording_private.capacity_quarantines q where q.operation_key=p_operation) then return null;end if;$fence$);

 d:=pg_get_functiondef('public.icash_next_automation()'::regprocedure);
 needle:=' if not pg_try_advisory_xact_lock(726341927) then return null;end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Scheduler prerequisite changed';end if;
 execute replace(d,needle,needle||$maintenance$
 begin
  perform public.icash_quarantine_stalled_voice_slots(20);
 exception when others then
  -- Maintenance failure must not stop unrelated automation. Preserve every
  -- hold on rollback and emit a fixed diagnostic without recipient data.
  raise log 'voice_capacity_sweep_failed sqlstate=%',sqlstate;
 end;$maintenance$);
end $patch$;
revoke all on function public.icash_voice_capacity_available(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_voice_capacity_available(uuid,text,text,text,boolean) to service_role;
commit;
