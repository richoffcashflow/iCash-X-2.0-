-- Completed provider metadata can advance the initial whole-second recording
-- clock by one second. Preserve the initial observation and retention deadline.
-- This changes receipt reconciliation only; it creates no provider work or cost.
begin;
alter table public.icash_call_recordings add column final_provider_started_at timestamptz,
 add constraint icash_recording_final_clock check(final_provider_started_at is null or
  (isfinite(final_provider_started_at) and provider_started_at is not null and ended_at is not null and duration_seconds is not null
   and final_provider_started_at>=provider_started_at and final_provider_started_at<=provider_started_at+interval '1 second'
   and ended_at=final_provider_started_at+make_interval(secs=>duration_seconds)));

-- Patch the deployed functions in place, preserving unrelated admission,
-- consent, identity, billing and terminal-call fixes. Every prerequisite must
-- occur exactly once; unexpected schema drift aborts the entire migration.
do $patch$
declare definition text;needle text;replacement text;pair text[];
begin
 definition:=pg_get_functiondef('icash_recording_private.guard()'::regprocedure);
 needle:='  if (old.recording_authorized_at is not null and new.recording_authorized_at is distinct from old.recording_authorized_at)';
 replacement:='  if (old.final_provider_started_at is not null and new.final_provider_started_at is distinct from old.final_provider_started_at)
   or (old.ended_at is not null and row(new.ended_at,new.duration_seconds) is distinct from row(old.ended_at,old.duration_seconds))
   or (old.recording_authorized_at is not null and new.recording_authorized_at is distinct from old.recording_authorized_at)';
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'Outbound final clock prerequisite changed: recording guard';end if;
 execute replace(definition,needle,replacement);

 definition:=pg_get_functiondef('public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)'::regprocedure);
 foreach pair slice 1 in array array[
  array[$old$if r.state not in ('starting','recording','stopping','processing','failed') or r.start_claimed_at is null$old$,
   $new$if (r.state not in ('starting','recording','stopping','processing','failed') and not (p_action='available' and r.state in ('available','expired'))) or r.start_claimed_at is null$new$],
  array[$old$or (r.provider_started_at is not null and r.provider_started_at is distinct from started) then return null;end if;$old$,
   $new$or (r.provider_started_at is not null and r.provider_started_at is distinct from started
    and not (p_action='available' and started>r.provider_started_at and started<=r.provider_started_at+interval '1 second'))
   or (p_action='available' and r.final_provider_started_at is not null and r.final_provider_started_at is distinct from started) then return null;end if;$new$],
  array[$old$r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=started;r.audio_expires_at:=started+interval '720 hours';r.next_delete_at:=r.audio_expires_at;$old$,
   $new$r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=coalesce(r.provider_started_at,started);r.audio_expires_at:=r.provider_started_at+interval '720 hours';r.next_delete_at:=coalesce(r.next_delete_at,r.audio_expires_at);$new$],
  array[$old$if not isfinite(finished) or finished<started or finished>t+interval '1 minute' or finished>started+interval '601 seconds'$old$,
   $new$if not isfinite(finished) or finished<>started+make_interval(secs=>dur) or finished>t+interval '1 minute' or finished>started+interval '601 seconds'
    or (r.ended_at is not null and row(r.ended_at,r.duration_seconds) is distinct from row(finished,dur))$new$],
  array[$old$r.ended_at:=finished;r.duration_seconds:=dur;$old$,
   $new$r.final_provider_started_at:=started;r.ended_at:=finished;r.duration_seconds:=dur;$new$],
  array[$old$provider_started_at=r.provider_started_at,ended_at=r.ended_at,$old$,
   $new$provider_started_at=r.provider_started_at,final_provider_started_at=r.final_provider_started_at,ended_at=r.ended_at,$new$]
 ] loop
  needle:=pair[1];replacement:=pair[2];
  if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'Outbound final clock prerequisite changed: %',needle;end if;
  definition:=replace(definition,needle,replacement);
 end loop;
 execute definition;
end $patch$;
commit;
