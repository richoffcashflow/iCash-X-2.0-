CREATE OR REPLACE FUNCTION public.icash_seller_sms_permission_current(p_account uuid, p_thread uuid, p_check_hour boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;r public.icash_operation_rates;e jsonb;price bigint;h integer;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account for share;
 if not found or t.seller_intake_id is null or t.party<>'seller' or t.paused or t.manual_only or t.ai_mode<>'auto'
  or t.dnc_clear or t.dnc_checked_at is not null or t.sms_review_request_id is not null or t.operational_contact_id is not null then return false;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return false;end if;
 e:=public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient);
 if e is null or t.permission_evidence is distinct from e->>'evidence' or t.timezone is distinct from e->>'timezone'
  or t.permission_until is distinct from (e->>'until')::timestamptz or not public.icash_outreach_sms_current(p_account) then return false;end if;
 perform 1 from public.icash_text_senders where phone=t.sender and enabled for share;
 if not found then return false;end if;
 select * into r from public.icash_operation_rates where id=t.sms_rate_id for share;
 if not found or not public.icash_sms_intake_rate_current(r.id)
  or encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') is distinct from t.seller_sms_rate_hash then return false;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found or price is distinct from t.seller_sms_price_micros then return false;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=d.screening_id and s.account_id=p_account and pc.manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=d.screening_id and state<>'resolved') then return false;end if;
 h:=extract(hour from now() at time zone t.timezone);
 return not p_check_hour or (h>=9 and h<20) or public.icash_seller_sms_inquiry_window(p_account,t.id);
end $function$
