-- Prospective synchronous pre-create exits only. Never infer an old dial failed.
begin;
set local lock_timeout='5s';
create table icash_recording_private.predial_aborts(
 operation_key text primary key references public.icash_operation_spend(operation_key),
 account_id uuid not null references public.icash_accounts(id),
 job_id uuid not null unique references public.icash_voice_jobs(id),
 ticket_id uuid not null unique references public.icash_automation_tickets(id),
 dispatched_at timestamptz not null,
 token_hash text not null check(token_hash ~ '^[a-f0-9]{64}$'),
 reason text not null,
 boundary text not null check(boundary='before_recording_create_v1'),
 created_at timestamptz not null default clock_timestamp()
);
alter table icash_recording_private.predial_aborts enable row level security;
revoke all on icash_recording_private.predial_aborts from public,anon,authenticated,service_role;
create trigger predial_aborts_immutable before update or delete on icash_recording_private.predial_aborts
 for each row execute function icash_recording_private.audit_immutable();
create trigger predial_aborts_no_truncate before truncate on icash_recording_private.predial_aborts
 for each statement execute function icash_recording_private.audit_immutable();

create function public.icash_finish_voice_predial_abort(p_account uuid,p_job uuid,p_ticket uuid,p_token text,
 p_dispatched_at timestamptz,p_reason text,p_boundary text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare j public.icash_voice_jobs;o public.icash_operation_spend;t public.icash_automation_tickets;
 stamp timestamptz;proof icash_recording_private.predial_aborts;token_hash text;evidence text;
begin
 if p_account is null or p_job is null or p_ticket is null or p_dispatched_at is null or not isfinite(p_dispatched_at)
  or p_token is null or p_token !~ '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}){2}$'
  or p_boundary is distinct from 'before_recording_create_v1'
  or p_reason is null or p_reason not in ('recording_release_required','recording_review_required','business_number_verification_required',
   'live_work_not_ready','recorded_call_release_required','recorded_call_review_required') then return false;end if;
 token_hash:=encode(sha256(convert_to(p_token,'UTF8')),'hex');
 evidence:='voice-predial-abort-v1:'||p_ticket||':'||p_reason;
 -- Same budget boundary as direct recording creation and operation settlement.
 -- Acquire the immutable original operation before the job, as other recording
 -- recovery paths do. The budget lock serializes every provider admission.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return false;end if;
 select * into o from public.icash_operation_spend where operation_key='voice:'||p_job and account_id=p_account for update;
 if not found or o.dispatched_at is distinct from p_dispatched_at then return false;end if;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.operation_key is distinct from o.operation_key or j.provider_call_sid is not null or j.conversation_id is not null then return false;end if;
 select * into t from public.icash_automation_tickets where id=p_ticket and account_id=p_account for update;
 if not found or t.token is distinct from p_token or t.kind is distinct from 'voice_dispatch' or t.voice_job_id is distinct from j.id then return false;end if;
 if exists(select 1 from public.icash_call_recordings r where r.operation_key=o.operation_key or r.voice_job_id=j.id)
 or exists(select 1 from public.icash_live_conversations c where c.operation_key=o.operation_key)
 or exists(select 1 from public.icash_cost_observations c where c.source_ref=o.operation_key or c.event_key=o.operation_key
   or (c.source_ref collate "C">=(o.operation_key||':') collate "C" and c.source_ref collate "C"<(o.operation_key||';') collate "C")
   or (c.event_key collate "C">=(o.operation_key||':') collate "C" and c.event_key collate "C"<(o.operation_key||';') collate "C"))
 or exists(select 1 from icash_recording_private.capacity_quarantines q where q.operation_key=o.operation_key)
 or exists(select 1 from public.icash_cost_manifests m where m.operation_key=o.operation_key)
 or exists(select 1 from icash_private.provider_costs c where c.operation_key=o.operation_key) then return false;end if;
 select * into proof from icash_recording_private.predial_aborts where operation_key=o.operation_key;
 if found then
  return row(proof.account_id,proof.job_id,proof.ticket_id,proof.dispatched_at,proof.token_hash,proof.reason,proof.boundary)
   is not distinct from row(p_account,p_job,p_ticket,p_dispatched_at,token_hash,p_reason,p_boundary)
   and o.state='settled' and o.actual_micros=0 and o.charged_cents=0 and o.settlement_evidence=evidence
   and j.state='held' and j.outcome=p_reason;
 end if;
 stamp:=clock_timestamp();
 if o.state<>'dispatched' or o.actual_micros is not null or o.charged_cents is not null or o.settled_at is not null
  or o.settlement_evidence is not null or j.state<>'dispatching'
  or t.state<>'consumed' or t.completed_at is not null or t.outcome is not null or t.expires_at<=stamp
  or t.created_at>p_dispatched_at or t.expires_at<p_dispatched_at or p_dispatched_at>stamp or p_dispatched_at<stamp-interval '2 minutes'
  or not exists(select 1 from public.icash_operation_rates r where r.id=o.rate_id and r.operation='seller_call'
   and r.version like 'required-audio-30d-speech-v1:%')
  or not exists(select 1 from public.icash_credit_reservations r where r.id=o.credit_reservation_id and r.account_id=o.account_id
   and r.operation_key=o.operation_key and r.status='reserved' and r.amount_cents=o.charge_cap_cents)
  or exists(select 1 from public.icash_automation_tickets other where other.voice_job_id=j.id and other.id<>t.id and other.state in ('issued','consumed'))
  then return false;end if;
 insert into icash_recording_private.predial_aborts(operation_key,account_id,job_id,ticket_id,dispatched_at,token_hash,reason,boundary)
 values(o.operation_key,p_account,p_job,p_ticket,p_dispatched_at,token_hash,p_reason,p_boundary);
 perform public.icash_settle_operation(o.operation_key,0,0,evidence);
 update public.icash_voice_jobs set state='held',outcome=p_reason,updated_at=stamp where id=j.id;
 return true;
end $fn$;
revoke all on function public.icash_finish_voice_predial_abort(uuid,uuid,uuid,text,timestamptz,text,text) from public,anon,authenticated;
grant execute on function public.icash_finish_voice_predial_abort(uuid,uuid,uuid,text,timestamptz,text,text) to service_role;
commit;
