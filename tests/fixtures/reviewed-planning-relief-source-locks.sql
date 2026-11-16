-- Minimal source projections for native lock tests, not a production schema.
-- Real FK edges are retained so key-share conflicts prove parent fences:
-- live-dispatch.sql; seller-opener-experiments.sql; required-call-recording.sql;
-- text-delivery-recovery.sql; migrations/20260928221806_discovery_screening_bridge.sql
-- and migrations/20260928235939_live_conversation_handoffs.sql.
alter table public.icash_automation_tickets
 add foreign key(voice_job_id) references public.icash_voice_jobs(id),
 add foreign key(opener_message_id) references public.icash_text_messages(id);
alter table public.icash_discovery_results
 add foreign key(operation_key) references public.icash_operation_spend(operation_key);
alter table public.icash_live_conversations
 add foreign key(operation_key) references public.icash_operation_spend(operation_key);
create unique index fixture_recording_operation_account on public.icash_operation_spend(operation_key,account_id);
create table public.icash_call_recordings(
 id uuid primary key,account_id uuid,operation_key text unique,
 voice_job_id uuid unique references public.icash_voice_jobs(id),
 state text,call_ended_at timestamptz,max_total_seconds integer,
 dial_claimed_at timestamptz,start_claimed_at timestamptz,
 reconcile_lease_token uuid,reconcile_lease_expires_at timestamptz,
 deletion_lease_token uuid,deletion_lease_expires_at timestamptz,
 row_version bigint,updated_at timestamptz,next_reconcile_at timestamptz,
 reconcile_attempts integer,next_delete_at timestamptz,deletion_attempts integer,
 last_error text,last_action text,recording_sid text,provider_recording_price_micros bigint,
 foreign key(operation_key,account_id) references public.icash_operation_spend(operation_key,account_id)
);
create schema icash_text_receipt_private;
create table icash_text_receipt_private.attempts(
 id uuid primary key,message_id uuid references public.icash_text_messages(id),
 account_id uuid,expires_at timestamptz,finished_at timestamptz,receipt jsonb
);
-- Estimates have no operation FK. Their canonical writer is serialized by the
-- operating-budget row instead; never add a fictional FK to prove that fence.
create table icash_research_private.estimates(
 operation_key text primary key,account_id uuid,token uuid,lease_until timestamptz,response jsonb
);
