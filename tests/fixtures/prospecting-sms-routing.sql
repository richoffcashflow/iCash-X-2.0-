-- Exact read-only production function snapshot, 2026-10-19, before route-conflict fix.
-- Used only by local simulated regression tests; no provider/network calls.
CREATE OR REPLACE FUNCTION public.icash_project_operational_sms_contacts(p_account uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_operational_contacts;r public.icash_operation_rates;v_sender text;deal uuid;price bigint;checked timestamptz;inserted integer;total integer:=0;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return 0;end if;
 perform public.icash_prepare_operational_contacts(p_account);
 -- Ambiguous sender configuration is a setup problem, never a reason to guess.
 if not exists(select 1 from public.icash_text_senders where enabled) then return 0;end if;
 select * into r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id)
  order by verified_at desc,id limit 1 for share;
 if not found then return 0;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found then return 0;end if;
 for c in select oc.* from public.icash_operational_contacts oc
  join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused
  where oc.channel='sms' and (p_account is null or oc.account_id=p_account) and oc.revoked_at is null and oc.eligibility_until>now()
   and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
    or public.icash_operational_contact_current(oc.account_id,oc.id,'sms',false))
   and not exists(select 1 from public.icash_text_threads th join public.icash_deal_files df on df.id=th.deal_id and df.account_id=th.account_id where th.retired_at is null and th.account_id=oc.account_id and df.screening_id=oc.screening_id and th.recipient=oc.phone)
  order by oc.account_id,oc.phone,oc.id limit 100
 loop
  perform pg_advisory_xact_lock(hashtextextended(c.phone,74));
  perform 1 from public.icash_accounts where id=c.account_id and not bot_paused for update;
  if not found then continue;end if;
  perform 1 from public.icash_outreach_campaigns where account_id=c.account_id for share;
  if not public.icash_outreach_sms_current(c.account_id)
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
  v_sender:=public.icash_property_text_sender(c.account_id,deal,c.phone);if v_sender is null then continue;end if;checked:=clock_timestamp();
  if least(c.eligibility_until,r.expires_at)<=checked or r.verified_at>checked then continue;end if;
  insert into public.icash_text_threads(sender_pool_assigned,account_id,deal_id,sender,recipient,timezone,dnc_checked_at,dnc_clear,sms_rate_id,
   paused,party,ai_mode,sms_intake_pending,operational_contact_id,eligibility_until,operational_sms_sender,operational_sms_rate_hash,operational_sms_price_micros)
  select true,c.account_id,deal,v_sender,c.phone,c.timezone,dr.checked_at,dr.clear,r.id,false,'seller','auto',false,c.id,
   least(c.eligibility_until,r.expires_at),v_sender,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),price
  from public.icash_dnc_verification_receipts dr where dr.id=c.dnc_receipt_id and dr.phone=c.phone
  on conflict(account_id,deal_id,sender,recipient) where retired_at is null and owner_buyer_test_id is null do nothing;
  get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 return total;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_property_text_sender(p_account uuid, p_deal uuid, p_recipient text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare chosen text;
begin
 if p_recipient is null or p_recipient!~'^\+[1-9][0-9]{7,14}$' then return null;end if;
 perform pg_advisory_xact_lock(818,1);
 if exists(select 1 from public.icash_text_suppressions where phone=p_recipient)
  or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p_recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_recipient,'UTF8')),'hex')) then return null;end if;
 select t.sender into chosen from public.icash_non_test_text_threads t where t.account_id=p_account and t.deal_id=p_deal and t.recipient=p_recipient and t.retired_at is null order by t.id limit 1;
 if chosen is not null then
  return case when exists(select 1 from public.icash_text_senders where phone=chosen and enabled) and not public.icash_text_role_conflict(chosen,p_recipient) then chosen else null end;
 end if;
 select s.phone into chosen from public.icash_text_senders s left join public.icash_webinar_text_senders w on w.phone=s.phone
 where s.enabled and not public.icash_text_role_conflict(s.phone,p_recipient)
 and not exists(select 1 from public.icash_non_test_text_threads t where t.sender=s.phone and t.recipient=p_recipient)
 order by coalesce(w.preferred,false),s.phone limit 1;
 if chosen is not null then return chosen;end if;
 select s.phone into chosen from public.icash_text_senders s left join public.icash_webinar_text_senders w on w.phone=s.phone
 where s.enabled and not public.icash_text_role_conflict(s.phone,p_recipient)
 and exists(select 1 from public.icash_non_test_text_threads t where t.sender=s.phone and t.recipient=p_recipient and t.account_id=p_account and t.party='seller')
 and not exists(select 1 from public.icash_non_test_text_threads t where t.sender=s.phone and t.recipient=p_recipient and (t.account_id<>p_account or t.party<>'seller'))
 order by coalesce(w.preferred,false),s.phone limit 1;
 return chosen;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_sms_thread_binding()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare owner_id uuid;screening uuid;
begin
 if TG_OP='UPDATE' and row(new.account_id,new.deal_id,new.sender,new.recipient,new.party,new.seller_intake_id,new.owner_buyer_test_id)
  is distinct from row(old.account_id,old.deal_id,old.sender,old.recipient,old.party,old.seller_intake_id,old.owner_buyer_test_id) then
  raise exception 'SMS property and consent binding is immutable';end if;
 if TG_OP='UPDATE' then
  if old.retired_at is not null and new.retired_at is distinct from old.retired_at then raise exception 'Retired SMS threads cannot be reopened';end if;
  return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(new.recipient,74));
 select screening_id into screening from public.icash_deal_files where id=new.deal_id and account_id=new.account_id;
 if not found then raise exception 'SMS deal ownership mismatch';end if;
 insert into public.icash_sms_routes(sender,recipient,account_id) values(new.sender,new.recipient,new.account_id) on conflict do nothing;
 select account_id into owner_id from public.icash_sms_routes where sender=new.sender and recipient=new.recipient for update;
 if owner_id is distinct from new.account_id then raise exception 'SMS number pair belongs to another account';end if;

 if new.party='buyer' and new.seller_intake_id is null and new.operational_contact_id is null and new.sms_review_request_id is null
 and exists(select 1 from public.icash_owner_buyer_tests x where x.id=new.owner_buyer_test_id and x.thread_id=new.id and x.account_id=new.account_id and x.deal_id=new.deal_id
  and x.sender=new.sender and x.phone=new.recipient and x.sms_rate_id=new.sms_rate_id and public.icash_owner_buyer_test_current(x.id)) then return new;end if;
 if new.owner_buyer_test_id is not null then raise exception 'Current exact owner test required';end if;
 if exists(select 1 from public.icash_text_threads t where t.sender=new.sender and t.recipient=new.recipient and t.retired_at is null and t.deal_id<>new.deal_id
 and not exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=t.id)) then
  if new.party<>'seller' or exists(select 1 from public.icash_text_threads t where t.sender=new.sender and t.recipient=new.recipient and t.retired_at is null and t.party<>'seller' and not exists(select 1 from public.icash_owner_buyer_tests x where x.thread_id=t.id)) then
   raise exception 'Mixed-role SMS number pair requires review';end if;
  if new.seller_intake_id is null or public.icash_seller_contact_evidence(new.account_id,screening,new.seller_intake_id,new.recipient) is null then
   raise exception 'Separate assigned property consent required';end if;
 end if;
 return new;
end $function$
;
