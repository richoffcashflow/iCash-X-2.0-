set local lock_timeout='1s';
create index if not exists icash_voice_first_route_lookup on public.icash_voice_jobs (account_id, (coalesce(permission_id,operational_contact_id))) where callback_id is null;
do $migration$
declare definition text := pg_get_functiondef('public.icash_finish_account_followup(uuid,uuid,boolean)'::regprocedure);
begin
 if strpos(definition,$insert$  -- Revisit unchanged historical receipts hourly after repeated zero-progress checks.
  -- New work wakes the account immediately through wake_account_followup.
  when not p_success and failures >= 4 and not fresh
   and q.claimed_notify_version <= q.notified_version
   and exists (select 1 from icash_work_private.followup_step_attempts s
    where s.ticket_id=p_ticket and not s.completed and s.evidence->>'pending'='true'
     and s.evidence->>'settled'='0')
   and not exists (select 1 from icash_work_private.followup_step_attempts s
    where s.ticket_id=p_ticket and (s.finished_at is null
     or s.step not in ('estimates','voice_receipts')
     or s.evidence->>'settled' is distinct from '0'
     or coalesce(s.evidence->>'reviewRequired','0') <> '0'))
   then interval '1 hour'
$insert$)>0 then return; end if;
 if md5(definition) <> 'd6342b2efa2d08e5a7bdf14ff83c8375' then raise exception 'Account follow-up definition changed'; end if;
 execute replace(definition,$anchor$  when not p_success then case failures$anchor$,$insert$  -- Revisit unchanged historical receipts hourly after repeated zero-progress checks.
  -- New work wakes the account immediately through wake_account_followup.
  when not p_success and failures >= 4 and not fresh
   and q.claimed_notify_version <= q.notified_version
   and exists (select 1 from icash_work_private.followup_step_attempts s
    where s.ticket_id=p_ticket and not s.completed and s.evidence->>'pending'='true'
     and s.evidence->>'settled'='0')
   and not exists (select 1 from icash_work_private.followup_step_attempts s
    where s.ticket_id=p_ticket and (s.finished_at is null
     or s.step not in ('estimates','voice_receipts')
     or s.evidence->>'settled' is distinct from '0'
     or coalesce(s.evidence->>'reviewRequired','0') <> '0'))
   then interval '1 hour'
  when not p_success then case failures$insert$);
end
$migration$;
