begin;
set local lock_timeout='5s';

-- Initial Meta calls must wait before issuance/reservation, not fail the final
-- dispatch gate after a second call has already reserved its operation key.
-- The existing budget row lock serializes preparation and final voice claims.
-- Keep every permission, membership, credit, pause and job-selection predicate.
-- Do not reset a held job, cancel/reopen spend or create a replacement here.
do $patch$
declare definition text;needle text;budget_lock text;
begin
 definition:=pg_get_functiondef('public.icash_meta_prepare_voice(uuid)'::regprocedure);
 budget_lock:='perform 1 from public.icash_operating_budget where id=1 for update;';
 needle:=$old$ if j.state<>'ready' or j.due_at>now() then return null;end if;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or (length(definition)-length(replace(definition,budget_lock,'')))/length(budget_lock)<>1
  or position(budget_lock in definition)>position(needle in definition)
  then raise exception 'Meta initial voice serialization prerequisite changed';end if;
 execute replace(definition,needle,$new$ if j.state<>'ready' or j.due_at>now() then return null;end if;
 -- Include issued work: the next scheduler invocation can precede reservation
 -- or the final claim. Unknown provider outcomes remain blocking, never retried.
 if exists(select 1 from public.icash_voice_jobs v
  left join public.icash_voice_contact_targets t on t.id=coalesce(v.permission_id,v.operational_contact_id)
  where v.id<>j.id and (v.state in ('issued','dispatching')
   or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))
   and (v.account_id=m.account_id or t.contact_key=p.contact_key))
  or exists(select 1 from public.icash_live_conversations
   where state in ('waiting','review') and (account_id=m.account_id or contact_key=p.contact_key)) then return null;end if;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;$new$);
end $patch$;
-- The generic voice issuer also sees ready Meta jobs. Keep current contact-only
-- initial calls on the guarded Meta path, before its ordering/LIMIT. Do not use
-- consent eligibility to decide routing: revoked consent must not reopen the
-- generic route. Completed screening and other voice job purposes stay intact.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 needle:=$old$ where v.state='ready' and v.due_at<=now() order by v.due_at for update of v skip locked limit 1;$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  then raise exception 'Meta generic voice routing prerequisite changed';end if;
 execute replace(definition,needle,$new$ where v.state='ready' and v.due_at<=now()
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 order by v.due_at for update of v skip locked limit 1;$new$);
end $patch$;
-- CREATE OR REPLACE preserves INVOKER security and existing service-only ACLs.
commit;
