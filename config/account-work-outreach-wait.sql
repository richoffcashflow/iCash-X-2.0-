-- Completed overnight preparation can legitimately wait for first-contact hours.
-- This is an observation only: it never admits work or changes original evidence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $check$
begin
 if md5(pg_get_functiondef('public.icash_account_work_observations()'::regprocedure))<>'e29029fce23b3856ad9cdf32ecd6848d' then
  raise exception 'Account outreach wait predecessor changed';
 end if;
end $check$;

create table icash_reliability_private.outreach_wait_settings(
 id integer primary key check(id=1),enabled boolean not null default false
);
insert into icash_reliability_private.outreach_wait_settings(id) values(1);
alter table icash_reliability_private.outreach_wait_settings enable row level security;
revoke all on icash_reliability_private.outreach_wait_settings from public,anon,authenticated;
grant select,update on icash_reliability_private.outreach_wait_settings to service_role;

create function icash_reliability_private.account_outreach_wait(
 p_account uuid,p_completed timestamptz,p_clock timestamptz default now()) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
declare maximum integer;contacts integer;all_waiting boolean;prepared boolean;
begin
 if not exists(select 1 from icash_reliability_private.outreach_wait_settings where id=1 and enabled)
  or isfinite(p_clock) is distinct from true or isfinite(p_completed) is distinct from true
  or p_completed>p_clock or p_completed<p_clock-interval '24 hours' then return false;end if;
 select max_open_prospects into maximum from public.icash_discovery_configs where account_id=p_account;
 if maximum is null or maximum<=0 or (public.icash_pending_opportunity_count(p_account)>=maximum) is distinct from true
  or public.icash_enrichment_before_prospecting_budget(p_account) is not null
  or public.icash_outreach_voice_current(p_account) is distinct from true then return false;end if;

 -- A closed first-contact window does not suspend other work. Be conservative
 -- about existing conversations, requested calls, live deals and unfinished prep.
 if exists(select 1 from public.icash_screening_jobs where account_id=p_account and state in ('queued','running'))
  or exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and state in ('pending','issued','analyzing','drafted'))
  or exists(select 1 from public.icash_live_callbacks where account_id=p_account and state='pending_dispatch_review' and due_at<=p_clock)
  or exists(select 1 from public.icash_voice_jobs where account_id=p_account and state in ('ready','issued','held') and due_at<=p_clock
   and (callback_id is not null or sms_source_message_id is not null or cancellation_notice_id is not null))
  or exists(select 1 from public.icash_deal_files where account_id=p_account and stage not in ('draft','closed','cancelled'))
  -- Other permission routes require their own proof; do not infer their hours.
  or exists(select 1 from public.icash_contact_permissions where account_id=p_account and revoked_at is null and permission_until>p_clock)
 then return false;end if;

 with current_contacts as materialized (
  select c.*,public.icash_outreach_timezone(c.timezone,c.timezone_basis) zone,
   o.result source_result,i.principal,s.state screening_state,s.result screening_result
  from public.icash_operational_contacts c
  left join public.icash_owner_contacts o on o.account_id=c.account_id and o.screening_id=c.screening_id
  left join public.icash_customer_identities i on i.account_id=c.account_id
  left join public.icash_screening_jobs s on s.account_id=c.account_id and s.id=c.screening_id
  where c.account_id=p_account and c.channel in ('voice','sms') and c.revoked_at is null and c.eligibility_until>p_clock
 ), clocks as (
  select c.*,
   -- Most recent 9 PM in this recipient's current operating clock.
   date_trunc('day',p_clock at time zone zone)+interval '21 hours'
    -case when extract(hour from p_clock at time zone zone)<9 then interval '1 day' else interval '0 days' end last_close
  from current_contacts c
 )
 select count(*),bool_and(coalesce(
   zone is not null and not public.icash_outreach_window_open(timezone,timezone_basis,p_clock)
   and (p_completed at time zone zone)>=last_close
   and created_at<=p_clock and (created_at at time zone zone)>=last_close
   and source_result is not null and source_hash=encode(sha256(convert_to(source_result::text,'UTF8')),'hex')
   and length(btrim(principal))>0 and sending_principal=principal
   and screening_state='complete' and screening_result->'financialCheck'->>'status'='eligible'
   and not public.icash_outreach_active_conversation(account_id,screening_id,phone,p_clock),false)),
  bool_or(channel='voice' and exists(select 1 from public.icash_voice_jobs j
   where j.account_id=p_account and j.operational_contact_id=clocks.id and j.state='ready' and j.due_at<=p_clock
    and j.operation_key is null and j.provider_call_sid is null and j.conversation_id is null
    and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null))
 into contacts,all_waiting,prepared from clocks;
 return contacts>0 and all_waiting is true and prepared is true;
end $fn$;
revoke all on function icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz) to service_role;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_account_work_observations()'::regprocedure);
 needle:=$old$and (available>=search_minimum or public.icash_enrichment_before_prospecting_budget(id) is not null) then 'no_completed_work'$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Account work observation boundary changed';end if;
 execute replace(d,needle,$new$and (available>=search_minimum or public.icash_enrichment_before_prospecting_budget(id) is not null)
    and not icash_reliability_private.account_outreach_wait(id,completed,now()) then 'no_completed_work'$new$);
end $patch$;
notify pgrst,'reload schema';
commit;
