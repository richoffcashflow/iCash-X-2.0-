-- Exact operator-reviewed original pre-dial failure only; installed inactive.
-- No provider request, new ticket, recording replay, or general age/status release.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $prerequisite$
begin
 if md5(pg_get_functiondef('public.icash_settle_operation(text,bigint,bigint,text)'::regprocedure))<>'c2eb9850afe01778577ccfce5838f33b'
 then raise exception 'Reviewed undialed settlement prerequisite changed';end if;
 if position('(old.dial_claimed_at is not null and new.dial_claimed_at is distinct from old.dial_claimed_at)' in
  pg_get_functiondef('icash_recording_private.guard()'::regprocedure))=0
 then raise exception 'Immutable dial claim prerequisite missing';end if;
end $prerequisite$;

create function icash_recording_private.undialed_hash(p_value jsonb) returns text
language sql immutable set search_path='' as $$select encode(sha256(convert_to(p_value::text,'UTF8')),'hex')$$;
create function icash_recording_private.undialed_recording_snapshot(p_value jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select p_value-array['row_version','updated_at','next_reconcile_at','last_action','last_error',
 'reconcile_lease_token','reconcile_lease_expires_at','reconcile_attempts']
$$;
create function icash_recording_private.undialed_operation_snapshot(p_value jsonb) returns jsonb
language sql immutable set search_path='' as $$select p_value-'estimate_checked_at'$$;
revoke all on function icash_recording_private.undialed_hash(jsonb),
 icash_recording_private.undialed_recording_snapshot(jsonb),icash_recording_private.undialed_operation_snapshot(jsonb)
 from public,anon,authenticated,service_role;

create table icash_recording_private.undialed_reviews(
 id uuid primary key default gen_random_uuid(),
 recording_id uuid not null unique references public.icash_call_recordings(id),
 account_id uuid not null,operation_key text not null unique,job_id uuid not null,ticket_id uuid not null,
 dispatched_at timestamptz not null check(isfinite(dispatched_at)),
 reviewed_row_version bigint not null check(reviewed_row_version>0),
 events_sha256 text not null check(events_sha256~'^[a-f0-9]{64}$'),
 recording_sha256 text not null check(recording_sha256~'^[a-f0-9]{64}$'),
 operation_sha256 text not null check(operation_sha256~'^[a-f0-9]{64}$'),
 job_sha256 text not null check(job_sha256~'^[a-f0-9]{64}$'),
 ticket_sha256 text not null check(ticket_sha256~'^[a-f0-9]{64}$'),
 quarantine_sha256 text not null check(quarantine_sha256~'^[a-f0-9]{64}$'),
 database_definitions jsonb not null,
 source_evidence jsonb not null,
 reviewed_at timestamptz not null default clock_timestamp()
);
create table icash_recording_private.undialed_activations(
 review_id uuid primary key references icash_recording_private.undialed_reviews(id),
 enabled boolean not null default false,
 release_sha text not null check(release_sha~'^[a-f0-9]{40}$'),
 expires_at timestamptz not null check(isfinite(expires_at))
);
create table icash_recording_private.undialed_receipts(
 review_id uuid primary key references icash_recording_private.undialed_reviews(id),
 recording_id uuid not null unique,account_id uuid not null,operation_key text not null unique,
 final_row_version bigint not null,events_sha256 text not null,evidence text not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table icash_recording_private.undialed_reviews enable row level security;
alter table icash_recording_private.undialed_activations enable row level security;
alter table icash_recording_private.undialed_receipts enable row level security;
revoke all on icash_recording_private.undialed_reviews,icash_recording_private.undialed_activations,
 icash_recording_private.undialed_receipts from public,anon,authenticated,service_role;
create trigger undialed_reviews_immutable before update or delete on icash_recording_private.undialed_reviews
 for each row execute function icash_recording_private.audit_immutable();
create trigger undialed_reviews_no_truncate before truncate on icash_recording_private.undialed_reviews
 for each statement execute function icash_recording_private.audit_immutable();
create trigger undialed_receipts_immutable before update or delete on icash_recording_private.undialed_receipts
 for each row execute function icash_recording_private.audit_immutable();
create trigger undialed_receipts_no_truncate before truncate on icash_recording_private.undialed_receipts
 for each statement execute function icash_recording_private.audit_immutable();

create function public.icash_finish_reviewed_undialed_recording(p_review uuid,p_account uuid,p_operation text,p_release text)
-- The operator sets statement_timeout before the outer SELECT. A function-local
-- setting cannot establish an already-running statement's deadline.
returns boolean language plpgsql security definer set search_path='' set lock_timeout='500ms' as $fn$
declare
 v icash_recording_private.undialed_reviews;activation icash_recording_private.undialed_activations;
 prior icash_recording_private.undialed_receipts;r public.icash_call_recordings;
 o public.icash_operation_spend;j public.icash_voice_jobs;t public.icash_automation_tickets;
 q icash_recording_private.capacity_quarantines;credit public.icash_credit_reservations;wallet public.icash_wallets;
 began_at timestamptz:=clock_timestamp();stamp timestamptz;log_at timestamptz;history_count bigint;history_unique bigint;history_min bigint;history_max bigint;
 history_valid boolean;prefix_hash text;full_hash text;evidence text;proof jsonb;
begin
 -- An older repeatable-read snapshot can miss evidence committed before the locks.
 if current_setting('transaction_isolation') is distinct from 'read committed' then return false;end if;
 if p_review is null or p_account is null or p_operation is null or p_release is null then return false;end if;
 select * into v from icash_recording_private.undialed_reviews where id=p_review and account_id=p_account and operation_key=p_operation;
 if not found then return false;end if;
 -- The private per-original activation is never populated by the migration or service role.
 select * into activation from icash_recording_private.undialed_activations where review_id=v.id for share;
 if not found or not activation.enabled or activation.release_sha is distinct from p_release
  or activation.expires_at<=clock_timestamp() then return false;end if;
 -- These rare operator-triggered locks serialize append-only evidence writers.
 -- NOWAIT refuses in-flight evidence; it never blocks ordinary work waiting for locks.
 -- Any evidence committed before acquisition is included in the final checks below.
 lock table public.icash_cost_observations,public.icash_cost_manifests,icash_private.provider_costs,
  public.icash_usage_coverage,public.icash_credit_ledger,public.icash_recorded_gate_terminal_receipts,
  icash_recording_private.terminal_cost_receipts,icash_recording_private.call_creation_rejections,
  icash_recording_private.predial_aborts,public.icash_live_conversations,
  icash_recording_private.capacity_quarantines in share mode nowait;
 -- Match existing recorded-call recovery: budget -> operation -> recording -> job -> tickets.
 perform 1 from public.icash_operating_budget where id=1 for update nowait;
 if not found then return false;end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update nowait;
 if not found or o.dispatched_at is distinct from v.dispatched_at then return false;end if;
 select * into r from public.icash_call_recordings where id=v.recording_id and account_id=p_account and operation_key=p_operation for update nowait;
 if not found then return false;end if;
 select * into j from public.icash_voice_jobs where id=v.job_id and account_id=p_account for update nowait;
 if not found or r.voice_job_id is distinct from j.id or j.operation_key is distinct from p_operation or p_operation is distinct from 'voice:'||j.id then return false;end if;
 perform 1 from public.icash_automation_tickets where voice_job_id=j.id order by id for update nowait;
 select * into t from public.icash_automation_tickets where id=v.ticket_id and account_id=p_account;
 if not found or t.voice_job_id is distinct from j.id or t.kind is distinct from 'voice_dispatch' then return false;end if;
 select * into q from icash_recording_private.capacity_quarantines where operation_key=p_operation;
 if not found or q.account_id is distinct from p_account or q.voice_job_id is distinct from j.id or q.recording_id is distinct from r.id
  or q.reason is distinct from 'expired_unstarted_recording'
  or icash_recording_private.undialed_hash(to_jsonb(q)) is distinct from v.quarantine_sha256 then return false;end if;
 stamp:=clock_timestamp();
 -- This row carries an original positive request log, not a reconstruction from status or absence.
 proof:=v.source_evidence;
 if not icash_recording_private.keys(proof,array['version','event','stage','recordingId','holdSaved','reason',
  'requestId','deploymentId','commitSha','occurredAt','logSha256','sourceSha256','historyInvariantSha256'])
  or proof->>'version' is distinct from 'original-dial-claim-log-v1'
  or proof->>'event' is distinct from 'recording_dispatch_held' or proof->>'stage' is distinct from 'dial_claim'
  or proof->>'recordingId' is distinct from r.id::text or proof->'holdSaved' is distinct from 'false'::jsonb
  or proof->>'reason' is distinct from 'provider_or_database_outcome_unknown'
  or coalesce(proof->>'requestId','')!~'^[A-Za-z0-9_-]{10,200}$'
  or coalesce(proof->>'deploymentId','')!~'^dpl_[A-Za-z0-9]{10,100}$'
  or coalesce(proof->>'commitSha','')!~'^[a-f0-9]{40}$'
  or coalesce(proof->>'logSha256','')!~'^[a-f0-9]{64}$'
  or coalesce(proof->>'sourceSha256','')!~'^[a-f0-9]{64}$'
  or coalesce(proof->>'historyInvariantSha256','')!~'^[a-f0-9]{64}$'
  or coalesce(proof->>'occurredAt','')!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
 then return false;end if;
 log_at:=(proof->>'occurredAt')::timestamptz;
 if not isfinite(log_at) or log_at<r.created_at or log_at<v.dispatched_at or log_at>t.completed_at
  or v.reviewed_at<log_at or r.entry_policy is distinct from 'direct_recorded_v1'
  or isfinite(r.consent_deadline_at) is distinct from true or r.consent_deadline_at>stamp
  or r.dial_claimed_at is not null or r.call_sid is not null or r.start_claimed_at is not null or r.recording_sid is not null
  or r.conversation_id is not null or r.consent_at is not null or r.recording_authorized_at is not null
  or r.provider_started_at is not null or r.end_requested_at is not null or r.call_ended_at is not null
  or j.provider_call_sid is not null or j.conversation_id is not null
  or r.reconcile_lease_expires_at>stamp
  or t.completed_at is null or t.state is distinct from 'held' or t.outcome is distinct from 'provider_outcome_unknown_no_retry'
  or t.expires_at>stamp or t.created_at>v.dispatched_at or t.completed_at<t.created_at
  or exists(select 1 from public.icash_automation_tickets other where other.voice_job_id=j.id and other.state in ('issued','consumed'))
 then return false;end if;
 -- Current source/claim invariants must still exist; fail on disabled audit/guard or ledger drift.
 if v.database_definitions is distinct from jsonb_build_object(
  'guard',md5(pg_get_functiondef('icash_recording_private.guard()'::regprocedure)),
  'audit',md5(pg_get_functiondef('icash_recording_private.audit()'::regprocedure)),
  'immutable',md5(pg_get_functiondef('icash_recording_private.audit_immutable()'::regprocedure)),
  'transition',md5(pg_get_functiondef('public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)'::regprocedure)),
  'finishCredit',md5(pg_get_functiondef('public.icash_finish_credit(uuid,text,bigint,text)'::regprocedure)),
  'margin',md5(pg_get_functiondef('public.icash_account_margin_ok(uuid,bigint,bigint,boolean)'::regprocedure)),
  'settle',md5(pg_get_functiondef('public.icash_settle_operation(text,bigint,bigint,text)'::regprocedure)))
  or md5(pg_get_functiondef('public.icash_settle_operation(text,bigint,bigint,text)'::regprocedure))<>'c2eb9850afe01778577ccfce5838f33b'
  or position('(old.dial_claimed_at is not null and new.dial_claimed_at is distinct from old.dial_claimed_at)' in
   pg_get_functiondef('icash_recording_private.guard()'::regprocedure))=0
  or (select count(*) from pg_trigger where tgrelid='public.icash_call_recordings'::regclass
   and tgname in ('icash_recording_guard','icash_recording_audit','icash_recording_no_truncate') and tgenabled='O')<>3
  or (select count(*) from pg_trigger where tgrelid='icash_recording_private.events'::regclass
   and tgname in ('icash_recording_audit_immutable','icash_recording_audit_no_truncate') and tgenabled='O')<>2
 then return false;end if;
 -- All late provider/financial evidence retains its original hold.
 if exists(select 1 from public.icash_call_recordings other where (other.operation_key=p_operation or other.voice_job_id=j.id) and other.id<>r.id)
  or exists(select 1 from public.icash_live_conversations c where c.operation_key=p_operation)
  or exists(select 1 from public.icash_cost_observations c where c.source_ref=p_operation or c.event_key=p_operation
   or (c.source_ref collate "C">=(p_operation||':') collate "C" and c.source_ref collate "C"<(p_operation||';') collate "C")
   or (c.event_key collate "C">=(p_operation||':') collate "C" and c.event_key collate "C"<(p_operation||';') collate "C"))
  or exists(select 1 from public.icash_cost_manifests m where m.operation_key=p_operation)
  or exists(select 1 from icash_private.provider_costs c where c.operation_key=p_operation)
  or exists(select 1 from public.icash_usage_coverage c where c.operation_key=p_operation)
  or exists(select 1 from public.icash_credit_ledger c where c.account_id=p_account and c.event_key in ('usage:'||p_operation,'usage-coverage:'||p_operation))
  or exists(select 1 from public.icash_recorded_gate_terminal_receipts c where c.recording_id=r.id)
  or exists(select 1 from icash_recording_private.terminal_cost_receipts c where c.recording_id=r.id)
  or exists(select 1 from icash_recording_private.call_creation_rejections c where c.recording_id=r.id)
  or exists(select 1 from icash_recording_private.predial_aborts c where c.operation_key=p_operation)
 then return false;end if;
 -- The existing credit layer locks wallet before reservation. Preserve that order.
 select * into wallet from public.icash_wallets where account_id=p_account for update nowait;
 if not found or wallet.balance_cents<0 or wallet.reserved_cents is distinct from 0 then return false;end if;
 select * into credit from public.icash_credit_reservations where id=o.credit_reservation_id and account_id=p_account and operation_key=p_operation for update nowait;
 if not found or credit.amount_cents is distinct from o.charge_cap_cents then return false;end if;
 evidence:='reviewed-undialed-recording-v1:'||v.id;
 select * into prior from icash_recording_private.undialed_receipts where review_id=v.id;
 if found then
  select icash_recording_private.undialed_hash(jsonb_agg(to_jsonb(e) order by e.row_version)) into full_hash
   from icash_recording_private.events e where e.recording_id=r.id and e.row_version<prior.final_row_version;
  return prior.recording_id=r.id and prior.account_id=p_account and prior.operation_key=p_operation and prior.evidence=evidence
   and prior.events_sha256=full_hash
   and exists(select 1 from icash_recording_private.events e where e.recording_id=r.id and e.row_version=prior.final_row_version
    and e.account_id=p_account and e.operation_key=p_operation and e.action='reviewed_undialed_abort'
    and e.old_state='consent_pending' and e.new_state='failed')
   and r.row_version=prior.final_row_version and r.state='failed' and r.last_action='reviewed_undialed_abort'
   and r.last_error='original_handler_never_dialed' and r.next_reconcile_at is null
   and r.reconcile_lease_token is null and r.reconcile_lease_expires_at is null
   and o.state='settled' and o.actual_micros=0 and o.charged_cents=0 and o.settlement_evidence=evidence
   and credit.status='released' and coalesce(credit.settled_cents,0)=0
   and j.state='held' and j.outcome='original_handler_never_dialed';
 end if;
 if r.state is distinct from 'consent_pending' or j.state not in ('dispatching','held')
  or o.state is distinct from 'dispatched' or o.actual_micros is not null or o.charged_cents is not null
  or o.settled_at is not null or o.settlement_evidence is not null or o.customer_price_micros is not null
  or credit.status is distinct from 'reserved' or credit.settled_cents is not null
  or o.rate_id is distinct from r.rate_id or o.charge_cap_cents is distinct from r.charge_cap_cents
  or not exists(select 1 from public.icash_operation_rates rate where rate.id=o.rate_id
   and rate.operation='seller_call' and rate.version like 'required-audio-30d-speech-v1:%')
  or icash_recording_private.undialed_hash(icash_recording_private.undialed_recording_snapshot(to_jsonb(r))) is distinct from v.recording_sha256
  or icash_recording_private.undialed_hash(icash_recording_private.undialed_operation_snapshot(to_jsonb(o))) is distinct from v.operation_sha256
  or icash_recording_private.undialed_hash(to_jsonb(j)) is distinct from v.job_sha256
  or icash_recording_private.undialed_hash(to_jsonb(t)) is distinct from v.ticket_sha256 then return false;end if;
 select count(*),count(distinct e.row_version),min(e.row_version),max(e.row_version),
  bool_and(e.account_id=p_account and e.operation_key=p_operation and e.new_state='consent_pending'
   and case when e.row_version=1 then e.action='create' and e.old_state is null
    else e.action in ('claim_reconcile','reconcile_retry') and e.old_state='consent_pending' end),
  icash_recording_private.undialed_hash(jsonb_agg(to_jsonb(e) order by e.row_version) filter(where e.row_version<=v.reviewed_row_version)),
  icash_recording_private.undialed_hash(jsonb_agg(to_jsonb(e) order by e.row_version))
 into history_count,history_unique,history_min,history_max,history_valid,prefix_hash,full_hash
 from icash_recording_private.events e where e.recording_id=r.id;
 if history_count<>r.row_version or history_unique<>r.row_version or history_min<>1 or history_max<>r.row_version or history_valid is distinct from true
  or r.row_version<v.reviewed_row_version or prefix_hash is distinct from v.events_sha256 then return false;end if;
 -- Recheck the finite activation after all locks and reads, immediately before mutation.
 if not activation.enabled or activation.release_sha is distinct from p_release or activation.expires_at<=clock_timestamp()
  or clock_timestamp()>began_at+interval '8 seconds' then return false;end if;
 -- The same transaction permanently bars claim_dial before releasing its unused reservation.
 -- Existing ledger semantics are retained: this is pre-provider zero, not a fabricated complete-cost receipt.
 update public.icash_call_recordings set state='failed',last_error='original_handler_never_dialed',
  last_action='reviewed_undialed_abort',next_reconcile_at=null,reconcile_lease_token=null,reconcile_lease_expires_at=null,
  row_version=row_version+1,updated_at=stamp where id=r.id;
 perform public.icash_settle_operation(p_operation,0,0,evidence);
 update public.icash_voice_jobs set state='held',outcome='original_handler_never_dialed',updated_at=stamp where id=j.id;
 if not exists(select 1 from public.icash_operation_spend done where done.operation_key=p_operation and done.account_id=p_account
   and done.state='settled' and done.actual_micros=0 and done.charged_cents=0 and done.settlement_evidence=evidence)
  or not exists(select 1 from public.icash_credit_reservations done where done.id=credit.id and done.account_id=p_account
   and done.operation_key=p_operation and done.status='released' and coalesce(done.settled_cents,0)=0)
  or not exists(select 1 from public.icash_wallets done where done.account_id=p_account
   and done.balance_cents=wallet.balance_cents and done.reserved_cents=wallet.reserved_cents)
  or exists(select 1 from public.icash_usage_coverage done where done.operation_key=p_operation)
  or exists(select 1 from public.icash_credit_ledger done where done.account_id=p_account and done.event_key in ('usage:'||p_operation,'usage-coverage:'||p_operation))
 then raise exception 'Reviewed undialed ledger completion unconfirmed';end if;
 insert into icash_recording_private.undialed_receipts(review_id,recording_id,account_id,operation_key,final_row_version,events_sha256,evidence)
 values(v.id,r.id,p_account,p_operation,r.row_version+1,full_hash,evidence);
 return true;
end $fn$;
revoke all on function public.icash_finish_reviewed_undialed_recording(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_finish_reviewed_undialed_recording(uuid,uuid,text,text) to service_role;
commit;
