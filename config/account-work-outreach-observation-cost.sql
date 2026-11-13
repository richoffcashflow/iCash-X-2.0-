-- Keep the observation disabled while verifying its full-population cost.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $check$
begin
 if md5(pg_get_functiondef('icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz)'::regprocedure))<>'1f4c569012dc84b148c6e4dc46c7f499'
  or not exists(select 1 from icash_reliability_private.outreach_wait_settings where id=1 and not enabled)
 then raise exception 'Inactive outreach observation predecessor changed';end if;
end $check$;

-- Separate evidence from activation so the exact candidate can be measured
-- read-only for every account without changing the independent monitor.
create function icash_reliability_private.account_outreach_wait_evidence(
 p_account uuid,p_completed timestamptz,p_clock timestamptz default now()) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
declare maximum integer;contact record;zone text;last_close timestamp;contacts integer:=0;
begin
 if isfinite(p_clock) is distinct from true or isfinite(p_completed) is distinct from true
  or p_completed>p_clock or p_completed<p_clock-interval '24 hours' then return false;end if;

 -- Reject open windows and old/unknown evidence before scanning conversations,
 -- opportunity history or enrichment candidates. Each contact must still pass.
 for contact in select c.timezone,c.timezone_basis,c.created_at
  from public.icash_operational_contacts c
  where c.account_id=p_account and c.channel in ('voice','sms') and c.revoked_at is null and c.eligibility_until>p_clock
 loop
  zone:=public.icash_outreach_timezone(contact.timezone,contact.timezone_basis);
  if zone is null then return false;end if;
  if public.icash_outreach_window_open(contact.timezone,contact.timezone_basis,p_clock) is distinct from false then return false;end if;
  last_close:=date_trunc('day',p_clock at time zone zone)+interval '21 hours'
   -case when extract(hour from p_clock at time zone zone)<9 then interval '1 day' else interval '0 days' end;
  if ((p_completed at time zone zone)>=last_close and contact.created_at<=p_clock
   and (contact.created_at at time zone zone)>=last_close) is distinct from true then return false;end if;
  contacts:=contacts+1;
 end loop;
 if contacts=0 then return false;end if;

 if not exists(select 1 from public.icash_operational_contacts c
  join public.icash_voice_jobs j on j.account_id=c.account_id and j.operational_contact_id=c.id
  where c.account_id=p_account and c.channel='voice' and c.revoked_at is null and c.eligibility_until>p_clock
   and j.state='ready' and j.due_at<=p_clock and j.operation_key is null and j.provider_call_sid is null and j.conversation_id is null
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null)
 then return false;end if;

 select max_open_prospects into maximum from public.icash_discovery_configs where account_id=p_account;
 if maximum is null or maximum<=0 then return false;end if;
 if not exists(select 1 from public.icash_voice_configs v
  join public.icash_operation_rates r on r.id=v.seller_rate_id and r.enabled and r.expires_at>p_clock
  where v.account_id=p_account and v.enabled and v.reviewed_until>p_clock) then return false;end if;
 if public.icash_outreach_voice_current(p_account) is distinct from true then return false;end if;

 -- A closed first-contact window does not suspend other work.
 if exists(select 1 from public.icash_screening_jobs where account_id=p_account and state in ('queued','running'))
  or exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and state in ('pending','issued','analyzing','drafted'))
  or exists(select 1 from public.icash_live_callbacks where account_id=p_account and state='pending_dispatch_review' and due_at<=p_clock)
  or exists(select 1 from public.icash_voice_jobs where account_id=p_account and state in ('ready','issued','held') and due_at<=p_clock
   and (callback_id is not null or sms_source_message_id is not null or cancellation_notice_id is not null))
  or exists(select 1 from public.icash_deal_files where account_id=p_account and stage not in ('draft','closed','cancelled'))
  or exists(select 1 from public.icash_contact_permissions where account_id=p_account and revoked_at is null and permission_until>p_clock)
 then return false;end if;

 if exists(select 1 from public.icash_operational_contacts c
  left join public.icash_owner_contacts o on o.account_id=c.account_id and o.screening_id=c.screening_id
  left join public.icash_customer_identities i on i.account_id=c.account_id
  left join public.icash_screening_jobs s on s.account_id=c.account_id and s.id=c.screening_id
  where c.account_id=p_account and c.channel in ('voice','sms') and c.revoked_at is null and c.eligibility_until>p_clock
   and (o.result is not null and c.source_hash=encode(sha256(convert_to(o.result::text,'UTF8')),'hex')
    and length(btrim(i.principal))>0 and c.sending_principal=i.principal
    and s.state='complete' and s.result->'financialCheck'->>'status'='eligible') is distinct from true)
 then return false;end if;

 if exists(select 1 from public.icash_operational_contacts c
  where c.account_id=p_account and c.channel in ('voice','sms') and c.revoked_at is null and c.eligibility_until>p_clock
   and public.icash_outreach_active_conversation(c.account_id,c.screening_id,c.phone,p_clock) is distinct from false)
 then return false;end if;

 -- These historical scans are necessary only for otherwise proven waiting.
 -- Separate statements guarantee short-circuiting regardless of SQL plan order.
 if (public.icash_pending_opportunity_count(p_account)>=maximum) is distinct from true then return false;end if;
 if public.icash_enrichment_before_prospecting_budget(p_account) is not null then return false;end if;
 return true;
end $fn$;

create or replace function icash_reliability_private.account_outreach_wait(
 p_account uuid,p_completed timestamptz,p_clock timestamptz default now()) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
begin
 if not exists(select 1 from icash_reliability_private.outreach_wait_settings where id=1 and enabled) then return false;end if;
 return icash_reliability_private.account_outreach_wait_evidence(p_account,p_completed,p_clock);
end $fn$;
revoke all on function icash_reliability_private.account_outreach_wait_evidence(uuid,timestamptz,timestamptz),
 icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function icash_reliability_private.account_outreach_wait_evidence(uuid,timestamptz,timestamptz),
 icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz) to service_role;
commit;
