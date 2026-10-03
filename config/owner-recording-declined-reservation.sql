-- A separately requested new owner attempt may retain a completed preconsent declined call's full reserve.
-- No replay/reclassification/consent inference; all fresh proof, opt-out, lock and budget rules remain.
begin;
create or replace function icash_owner_recording_private.pending_carrier_candidate(r public.icash_owner_recording_test_runs) returns boolean language sql immutable set search_path='' as $$
 select r.state in ('failed','declined') and r.last_error='owner_carrier_price_pending' and r.reserved_micros=1000000 and r.configuration->'quote'->>'maxAttemptMicros'='1000000'
  and r.call_sid is not null and r.call_started_at is not null and r.end_requested_at is not null and r.call_ended_at is not null
  and not r.contact_opted_out and r.consent_at is null and r.consent_evidence is null
  and r.start_claimed_at is null and r.registration_claimed_at is null and r.recording_sid is null and r.conversation_id is null
  and r.provider_started_at is null and r.audio_expires_at is null and r.duration_seconds is null and r.recording_price_micros is null and r.deleted_at is null
  and r.settled_at is null and r.settled_micros is null and r.settlement is null
$$;
revoke all on function icash_owner_recording_private.pending_carrier_candidate(public.icash_owner_recording_test_runs) from public,anon,authenticated,service_role;
commit;
