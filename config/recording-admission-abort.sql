-- A synchronous rejected admission is not an uncertain provider attempt.
-- Preserve current-handler, no-recording, late-evidence and once-only guards.
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare d text:=pg_get_functiondef('public.icash_finish_voice_predial_abort(uuid,uuid,uuid,text,timestamptz,text,text)'::regprocedure);
 old_clause text:=$old$or p_boundary is distinct from 'before_recording_create_v1'
  or p_reason is null or p_reason not in ('recording_release_required','recording_review_required','business_number_verification_required',
   'live_work_not_ready','recorded_call_release_required','recorded_call_review_required')$old$;
 new_clause text:=$new$or not coalesce(
   (p_boundary='before_recording_create_v1' and p_reason in ('recording_release_required','recording_review_required','business_number_verification_required',
    'live_work_not_ready','recorded_call_release_required','recorded_call_review_required'))
   or (p_boundary='recording_admission_rejected_v1' and p_reason='recording_admission_held'),false)$new$;
begin
 if md5(d)<>'c25d27bbfe286b1cccabdfa2bc670086'
  or (length(d)-length(replace(d,old_clause,'')))<>length(old_clause)
 then raise exception 'Recording admission abort predecessor changed';end if;
 execute replace(d,old_clause,new_clause);
end $patch$;
alter table icash_recording_private.predial_aborts drop constraint predial_aborts_boundary_check;
alter table icash_recording_private.predial_aborts add constraint predial_aborts_boundary_check
 check(boundary in ('before_recording_create_v1','recording_admission_rejected_v1'));
