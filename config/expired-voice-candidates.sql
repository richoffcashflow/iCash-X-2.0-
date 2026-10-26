-- Expired saved targets must not occupy the limited scheduler/resume batch.
-- This only filters selection; final dispatch checks, job states and receipts stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 if md5(d)<>'3d51628287d60e6d810a4267d8036980' then raise exception 'Voice issuer changed';end if;
 needle:=$old$ where v.state='ready' and v.due_at<=now()$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Voice candidate boundaries changed';end if;
 d:=replace(d,needle,needle||$new$
 and exists(select 1 from public.icash_voice_contact_targets current_target
  where current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
    or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
   and current_target.revoked_at is null and current_target.permission_until>now())$new$);
 execute d;
 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 if md5(d)<>'bb17f23644dc806192fee93864321af7' then raise exception 'Prospecting resumer changed';end if;
 needle:=$old$  and a.available>=x.prospecting_quote_cents$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Resume candidate boundary changed';end if;
 d:=replace(d,needle,needle||$new$
  and (x.kind<>'voice_dispatch' or exists(
   select 1 from public.icash_voice_jobs v
   join public.icash_voice_contact_targets current_target
    on current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   where v.id=x.voice_job_id and v.account_id=x.account_id
    and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
     or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
    and current_target.revoked_at is null and current_target.permission_until>now()
  ))$new$);
 execute d;
end $patch$;
commit;
