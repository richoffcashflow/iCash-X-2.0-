begin;
-- Apply after operational-contact-eligibility.sql and sms-seller-opening.sql.
-- Existing reviews remain historical evidence. Operational eligibility is not
-- recipient consent, a legal determination, or an independent approval.
alter table public.icash_text_threads
 add column operational_contact_id uuid references public.icash_operational_contacts(id),
 add column eligibility_until timestamptz,
 add column operational_sms_sender text,
 add column operational_sms_rate_hash text,
 add column operational_sms_price_micros bigint,
 add constraint icash_sms_operational_evidence_separate check (
  (operational_contact_id is null and eligibility_until is null and operational_sms_sender is null and operational_sms_rate_hash is null and operational_sms_price_micros is null)
  or (operational_contact_id is not null and eligibility_until is not null and permission_until is null and permission_evidence is null
   and sms_review_request_id is null and party='seller' and operational_sms_sender is not null
   and operational_sms_rate_hash is not null and operational_sms_rate_hash ~ '^[a-f0-9]{64}$' and operational_sms_price_micros is not null and operational_sms_price_micros>=0));
create index icash_text_operational_contact on public.icash_text_threads(operational_contact_id) where operational_contact_id is not null;

-- Compatibility for existing billing interfaces: this value bounds a dispatch,
-- and is never persisted into a recipient-consent/permission evidence field.
create function public.icash_sms_thread_dispatch_until(p_account uuid,p_thread uuid) returns timestamptz
language sql stable security invoker set search_path='' as $$
 select case when operational_contact_id is not null then eligibility_until else permission_until end
 from public.icash_text_threads where id=p_thread and account_id=p_account
$$;

alter function public.icash_sms_thread_review_current(uuid,uuid,boolean) rename to icash_sms_thread_review_before_operational;
create function public.icash_sms_thread_review_current(p_account uuid,p_thread uuid,p_check_hour boolean default true) returns boolean
language plpgsql security invoker set search_path='' as $$
declare t public.icash_text_threads;c public.icash_operational_contacts;r public.icash_operation_rates;price bigint;checked timestamptz;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return false;end if;
 if t.operational_contact_id is null then return public.icash_sms_thread_review_before_operational(p_account,p_thread,p_check_hour);end if;
 if not public.icash_operational_contact_current(p_account,t.operational_contact_id,'sms',p_check_hour) then return false;end if;
 select * into c from public.icash_operational_contacts where id=t.operational_contact_id and account_id=p_account and channel='sms' for share;
 if not found or t.party<>'seller' or t.recipient is distinct from c.phone or t.timezone is distinct from c.timezone
  or t.permission_until is not null or t.permission_evidence is not null or t.sms_review_request_id is not null
  or t.sender is distinct from t.operational_sms_sender then return false;end if;
 perform 1 from public.icash_outreach_campaigns where account_id=p_account for share;
 if not public.icash_sms_inbound_campaign_current(p_account) then return false;end if;
 perform 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account and screening_id=c.screening_id
  and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return false;end if;
 perform 1 from public.icash_text_senders where phone=t.sender and enabled for share;
 if not found then return false;end if;
 select * into r from public.icash_operation_rates where id=t.sms_rate_id for share;
 if not found or not public.icash_sms_intake_rate_current(r.id)
  or encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') is distinct from t.operational_sms_rate_hash then return false;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found or price is distinct from t.operational_sms_price_micros then return false;end if;
 checked:=clock_timestamp();
 return t.eligibility_until is not distinct from least(c.eligibility_until,r.expires_at)
  and t.eligibility_until>checked and r.verified_at<=checked and r.expires_at>checked
  and t.dnc_clear and exists(select 1 from public.icash_dnc_verification_receipts dr where dr.id=c.dnc_receipt_id
   and dr.phone=t.recipient and dr.checked_at=t.dnc_checked_at and dr.clear and dr.revoked_at is null
   and dr.checked_at between checked-interval '30 days' and checked and dr.expires_at>checked);
end $$;

-- Project genuine saved operational contacts into the existing SMS workflow.
-- A conflicting thread is never reassigned, unpaused, overwritten, or renewed.
create function public.icash_project_operational_sms_contacts(p_account uuid default null) returns integer
language plpgsql security invoker set search_path='' as $$
declare c public.icash_operational_contacts;r public.icash_operation_rates;v_sender text;deal uuid;price bigint;checked timestamptz;inserted integer;total integer:=0;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return 0;end if;
 perform public.icash_prepare_operational_contacts(p_account);
 -- Ambiguous sender configuration is a setup problem, never a reason to guess.
 if (select count(*) from public.icash_text_senders where enabled)<>1 then return 0;end if;
 select phone into v_sender from public.icash_text_senders where enabled for share;
 select * into r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id)
  order by verified_at desc,id limit 1 for share;
 if not found then return 0;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found then return 0;end if;
 for c in select oc.* from public.icash_operational_contacts oc
  join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused
  where oc.channel='sms' and (p_account is null or oc.account_id=p_account) and oc.revoked_at is null and oc.eligibility_until>now()
   and not exists(select 1 from public.icash_text_threads th where th.sender=v_sender and th.recipient=oc.phone)
  order by oc.account_id,oc.phone,oc.id limit 100
 loop
  perform pg_advisory_xact_lock(hashtextextended(c.phone,74));
  perform 1 from public.icash_accounts where id=c.account_id and not bot_paused for update;
  if not found then continue;end if;
  perform 1 from public.icash_outreach_campaigns where account_id=c.account_id for share;
  if not public.icash_sms_inbound_campaign_current(c.account_id)
   or not public.icash_operational_contact_current(c.account_id,c.id,'sms',false) then continue;end if;
  -- A source with two live property bindings must be resolved rather than picked.
  if (select count(*) from public.icash_deal_files d where d.account_id=c.account_id and d.screening_id=c.screening_id
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true')<>1 then continue;end if;
  select d.id into deal from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
   where d.account_id=c.account_id and d.screening_id=c.screening_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
    and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at between now()-interval '24 hours' and now()
    and not exists(select 1 from public.icash_property_controls pc where pc.account_id=c.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   for share of d,s;
  if not found then continue;end if;
  checked:=clock_timestamp();
  if least(c.eligibility_until,r.expires_at)<=checked or r.verified_at>checked then continue;end if;
  insert into public.icash_text_threads(account_id,deal_id,sender,recipient,timezone,dnc_checked_at,dnc_clear,sms_rate_id,
   paused,party,ai_mode,sms_intake_pending,operational_contact_id,eligibility_until,operational_sms_sender,operational_sms_rate_hash,operational_sms_price_micros)
  select c.account_id,deal,v_sender,c.phone,c.timezone,dr.checked_at,dr.clear,r.id,false,'seller','auto',false,c.id,
   least(c.eligibility_until,r.expires_at),v_sender,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),price
  from public.icash_dnc_verification_receipts dr where dr.id=c.dnc_receipt_id and dr.phone=c.phone
  on conflict(sender,recipient) do nothing;
  get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 return total;
end $$;

-- Replace only recipient-evidence checks in the existing chain. All campaign,
-- stale-reply, manual-handoff, exactly-once, pricing and spend code stays intact.
do $patch$
declare definition text;needle text;signature text;changed text;
begin
 signature:='public.icash_claim_text_before_ai(uuid,uuid,text)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:=$n$t.permission_until is null or t.permission_until<=now() or coalesce(length(t.permission_evidence),0)<10 or not t.dnc_clear or t.dnc_checked_at is null or t.dnc_checked_at<now()-interval '30 days'$n$;
 if position(needle in definition)=0 then raise exception 'Original SMS dispatch evidence boundary changed';end if;
 definition:=replace(definition,needle,'not public.icash_sms_thread_review_current(p_account,t.id,true)');
 definition:=replace(definition,'r,t.permission_until','r,public.icash_sms_thread_dispatch_until(p_account,t.id)');
 execute definition;

 signature:='public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:=$n$t.permission_until is null or t.permission_until<=now() or length(coalesce(t.permission_evidence,''))<10 or not t.dnc_clear or t.dnc_checked_at is null or t.dnc_checked_at>now() or t.dnc_checked_at<now()-interval '30 days'$n$;
 if position(needle in definition)=0 then raise exception 'Invitation SMS evidence boundary changed';end if;
 definition:=replace(definition,needle,'not public.icash_sms_thread_review_current(p_account,t.id,false)');
 definition:=replace(definition,'least(t.permission_until,r.reviewed_until','least(public.icash_sms_thread_dispatch_until(p_account,t.id),r.reviewed_until');
 execute definition;

 signature:='public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='t.permission_until is null or t.permission_until<=now()';
 if position(needle in definition)=0 then raise exception 'Ownership-question SMS evidence boundary changed';end if;
 execute replace(definition,needle,'not public.icash_sms_thread_review_current(p_account,t.id,false)');

 signature:='public.icash_queue_seller_opener(uuid,uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 needle:='and permission_until>now()';
 if position(needle in definition)=0 then raise exception 'Seller opener eligibility boundary changed';end if;
 execute replace(definition,needle,'and public.icash_sms_thread_review_current(p_account,id,false)');

 -- Historical named scheduler layers remain active through their wrapper calls.
 foreach signature in array array[
  'public.icash_next_automation()',
  'public.icash_next_before_sms_inbound_campaign()',
  'public.icash_next_before_unstarted_sms_recovery()'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  changed:=replace(replace(definition,'t.permission_until>now()','public.icash_sms_thread_dispatch_until(t.account_id,t.id)>now()'),
   'th.permission_until>now()','public.icash_sms_thread_dispatch_until(th.account_id,th.id)>now()');
  if changed<>definition then execute changed;end if;
 end loop;
end $patch$;

-- Incoming messages and direct reply preparation must acquire the shared budget
-- before any thread/message-trigger lock; dispatch acquires budget before thread.
-- This preserves one lock order when an incoming reply races an outgoing claim.
alter function public.icash_ingest_text_event(jsonb,boolean) rename to icash_ingest_text_event_before_operational;
create function public.icash_ingest_text_event(p_event jsonb,p_optout boolean) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform public.icash_ingest_text_event_before_operational(p_event,p_optout);
end $$;
do $locks$declare signature text;definition text;begin
 foreach signature in array array[
  'public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)',
  'public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)',
  'public.icash_queue_seller_opener(uuid,uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(E'begin\n' in definition)=0 then raise exception 'SMS entry lock boundary changed';end if;
  execute regexp_replace(definition,E'begin\n',E'begin\n perform 1 from public.icash_operating_budget where id=1 for update;\n');
 end loop;
end $locks$;
revoke all on function public.icash_ingest_text_event(jsonb,boolean),public.icash_ingest_text_event_before_operational(jsonb,boolean) from public,anon,authenticated;
grant execute on function public.icash_ingest_text_event(jsonb,boolean),public.icash_ingest_text_event_before_operational(jsonb,boolean) to service_role;

alter function public.icash_set_work_control(uuid,uuid,text,uuid) rename to icash_set_work_control_before_operational_sms;
create function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_set_work_control_before_operational_sms(p_user,p_account,p_action,p_screening);
 if p_action='resume' then perform public.icash_project_operational_sms_contacts(p_account);end if;
end $$;

alter function public.icash_next_automation() rename to icash_next_before_operational_sms;
create function public.icash_next_automation() returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(726341927);
 perform public.icash_project_operational_sms_contacts(null);
 return public.icash_next_before_operational_sms();
end $$;

revoke all on function public.icash_sms_thread_dispatch_until(uuid,uuid),public.icash_sms_thread_review_current(uuid,uuid,boolean),
 public.icash_sms_thread_review_before_operational(uuid,uuid,boolean),public.icash_project_operational_sms_contacts(uuid),
 public.icash_set_work_control_before_operational_sms(uuid,uuid,text,uuid),public.icash_set_work_control(uuid,uuid,text,uuid),
 public.icash_next_before_operational_sms(),public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_sms_thread_dispatch_until(uuid,uuid),public.icash_sms_thread_review_current(uuid,uuid,boolean),
 public.icash_sms_thread_review_before_operational(uuid,uuid,boolean),public.icash_project_operational_sms_contacts(uuid),
 public.icash_set_work_control_before_operational_sms(uuid,uuid,text,uuid),public.icash_set_work_control(uuid,uuid,text,uuid),
 public.icash_next_before_operational_sms(),public.icash_next_automation() to service_role;
commit;
