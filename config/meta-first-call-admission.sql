begin;
set local lock_timeout='3s';

-- Match reservation admission: a verified contact-only Meta call collects the
-- address before underwriting. Every other seller call keeps its financial gate.
do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure);
 needle:='and not public.icash_cancellation_voice_current(o.account_id,p_operation) and';
 if (length(def)-length(replace(def,needle,'')))/length(needle)<>1 then raise exception 'Meta final claim prerequisite changed';end if;
 execute replace(def,needle,needle||' not exists(select 1 from public.icash_voice_jobs meta_job where meta_job.account_id=o.account_id and ''voice:''||meta_job.id=p_operation and public.icash_meta_voice_context(o.account_id,meta_job.id) is not null) and');
end $patch$;

-- Preserve the failed job and its zero-cost cancelled authorization. A verified
-- pre-provider failure gets one distinct replacement, never a reused spend key.
alter table public.icash_voice_jobs add column meta_retry_of uuid references public.icash_voice_jobs(id);
alter table public.icash_voice_jobs add constraint icash_meta_retry_initial_only check(meta_retry_of is null or (
 meta_retry_of<>id and permission_id is not null and operational_contact_id is null and callback_id is null
 and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null));
create unique index icash_meta_voice_retry_once on public.icash_voice_jobs(meta_retry_of) where meta_retry_of is not null;
drop index public.icash_voice_first_once;
create unique index icash_voice_first_once on public.icash_voice_jobs(permission_id)
 where callback_id is null and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null and meta_retry_of is null;

do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_meta_prepare_voice(uuid)'::regprocedure);
 needle:='select * into j from public.icash_voice_jobs where account_id=m.account_id and permission_id=p.id and callback_id is null and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null;';
 if position(needle in def)=0 then raise exception 'Meta first-call selection prerequisite changed';end if;
 execute replace(def,needle,replace(needle,';',' and (meta_retry_of is null or id=m.voice_job_id) order by (id=m.voice_job_id) desc nulls last,created_at desc limit 1;'));
end $patch$;

create function public.icash_meta_recover_unstarted_voice(p_account uuid,p_job uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;m public.icash_meta_leads;o public.icash_operation_spend;replacement uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found then return null;end if;
 select id into replacement from public.icash_voice_jobs where meta_retry_of=j.id and account_id=p_account;
 if found then return replacement;end if;
 select * into m from public.icash_meta_leads where voice_job_id=j.id and account_id=p_account for update;
 select * into o from public.icash_operation_spend where operation_key='voice:'||j.id and account_id=p_account for update;
 if m.lead_id is null or j.meta_retry_of is not null or j.state<>'held' or j.outcome is distinct from 'dispatch_permission_changed'
  or j.provider_call_sid is not null or j.conversation_id is not null or j.callback_id is not null or j.sms_source_message_id is not null
  or j.cancellation_notice_id is not null or j.meta_offer_lead_id is not null or j.operational_contact_id is not null
  or o.operation_key is null or o.state<>'cancelled' or o.dispatched_at is not null or o.financial_checked_at is not null
  or o.actual_micros is distinct from 0 or o.charged_cents is distinct from 0
  or o.settlement_evidence is distinct from 'Voice stopped before provider dispatch: dispatch_permission_changed'
  or exists(select 1 from public.icash_call_recordings where voice_job_id=j.id or operation_key=o.operation_key)
  or exists(select 1 from public.icash_live_conversations where operation_key=o.operation_key)
  or public.icash_meta_voice_context(p_account,j.id) is null
  or not public.icash_membership_work_allowed(p_account) or not public.icash_outreach_voice_current(p_account)
  or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
  or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>0) then return null;end if;
 insert into public.icash_voice_jobs(account_id,permission_id,meta_retry_of) values(p_account,j.permission_id,j.id) returning id into replacement;
 update public.icash_meta_leads set voice_job_id=replacement,next_attempt_at=now() where lead_id=m.lead_id;
 return replacement;
end $$;
revoke all on function public.icash_meta_recover_unstarted_voice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_meta_recover_unstarted_voice(uuid,uuid) to service_role;
commit;
