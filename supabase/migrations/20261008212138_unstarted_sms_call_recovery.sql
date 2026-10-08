begin;
-- Retain the original failed attempt and its source. Only a separately verified
-- local rejection BEFORE any dial can release source uniqueness for a new job.
alter table public.icash_voice_jobs drop constraint icash_voice_jobs_sms_source_message_id_key;
create unique index icash_voice_sms_source_once on public.icash_voice_jobs(sms_source_message_id)
 where not (state='canceled' and outcome is not distinct from 'context_rejected_before_dial');
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_queue_seller_sms_call(uuid,uuid,uuid)'::regprocedure);
 needle:=$n$select * into j from public.icash_voice_jobs where account_id=p_account and sms_source_message_id=m.id;$n$;
 if position(needle in d)=0 then raise exception 'SMS call queue prerequisite changed';end if;
 execute replace(d,needle,$n$select * into j from public.icash_voice_jobs where account_id=p_account and sms_source_message_id=m.id
 and not (state='canceled' and outcome is not distinct from 'context_rejected_before_dial');$n$);
end $$;
commit;
