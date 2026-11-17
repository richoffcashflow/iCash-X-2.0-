begin;
set local lock_timeout='5s';

-- The authoritative current initial call can be the one linked replacement of
-- an original first call. Observe that job, not the historical original or an
-- unrelated retry. This changes findings only: no queue, retry or provider work.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_undispatched_outreach_findings()'::regprocedure);
 needle:=$old$  and j.meta_retry_of is null and j.meta_followup_lead_id is null$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position('join public.icash_voice_jobs j on j.id=m.voice_job_id and j.account_id=m.account_id' in definition)=0
  then raise exception 'Current Meta initial voice monitoring prerequisite changed';end if;
 execute replace(definition,needle,$new$  and j.meta_followup_lead_id is null
  and (j.meta_retry_of is null or exists(
   select 1 from public.icash_voice_jobs original
   where original.id=j.meta_retry_of and original.id<>j.id
    and original.account_id=j.account_id and original.permission_id=j.permission_id
    and original.meta_retry_of is null and original.meta_followup_lead_id is null
    and original.callback_id is null and original.sms_source_message_id is null
    and original.cancellation_notice_id is null and original.operational_contact_id is null
    and original.meta_offer_lead_id is null))$new$);
end $patch$;
-- Preserve every other predicate, the STABLE/INVOKER definition and its ACLs.
commit;
