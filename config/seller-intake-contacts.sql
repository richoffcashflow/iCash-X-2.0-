-- First-party requests carry their own saved consent. They are not DNC receipts.
alter table public.icash_contact_permissions add column seller_intake_id uuid references public.icash_seller_intakes(id);
alter table public.icash_contact_permissions alter column dnc_checked_at drop not null;
alter table public.icash_contact_permissions add constraint icash_permission_consent_source check (
 (seller_intake_id is null and dnc_checked_at is not null) or
 (seller_intake_id is not null and party='seller' and not dnc_clear and dnc_checked_at is null and review_request_id is null and buyer_id is null));
alter table public.icash_text_threads add column seller_intake_id uuid references public.icash_seller_intakes(id),
 add column seller_sms_rate_hash text,add column seller_sms_price_micros bigint;
alter table public.icash_text_threads add constraint icash_thread_seller_consent_source check (
 (seller_intake_id is null and seller_sms_rate_hash is null and seller_sms_price_micros is null) or
 (seller_intake_id is not null and party='seller' and not dnc_clear and dnc_checked_at is null and sms_review_request_id is null and operational_contact_id is null and seller_sms_rate_hash is not null and seller_sms_price_micros is not null));
create index icash_permission_seller_intake on public.icash_contact_permissions(seller_intake_id) where seller_intake_id is not null;
create index icash_thread_seller_intake on public.icash_text_threads(seller_intake_id) where seller_intake_id is not null;

create function public.icash_seller_contact_evidence(p_account uuid,p_screening uuid,p_lead uuid,p_phone text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;principal text;tz text;expiry timestamptz;binding jsonb;
begin
 select * into l from public.icash_seller_intakes where id=p_lead for share;
 if not found or l.phone is distinct from p_phone or not l.ai_consented or l.state<>'assigned'
  or l.consent_version is distinct from 'homeoffer-seller-contact-2026-10-05.4'
  or l.contact_consent_scope is distinct from 'homeoffer_network_and_matched_buyers'
  or l.consent_text is distinct from 'I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.'
  or l.created_at>now() or l.created_at<=now()-interval '30 days' or l.data_rights_until is null or l.data_rights_until<=now() then return null;end if;
 perform 1 from public.icash_seller_matches where lead_id=p_lead and account_id=p_account and screening_id=p_screening for share;
 if not found then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account for share;
 if nullif(trim(principal),'') is null then return null;end if;
 tz:=l.attribution->>'contactTimezone';
 if l.attribution->>'contactTimezoneSource' not in ('seller_browser','owner_test_context') or l.attribution->>'contactTimezoneSource' is null
  or not exists(select 1 from public.icash_timezone_names where name=tz)
  or exists(select 1 from public.icash_text_suppressions where phone=p_phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')) then return null;end if;
 expiry:=least(l.created_at+interval '30 days',l.data_rights_until);
 binding:=jsonb_build_object('lead',l.id,'account',p_account,'screening',p_screening,'phone',l.phone,'principal',principal,'consentVersion',l.consent_version,'consentText',l.consent_text,'scope',l.contact_consent_scope,'receivedAt',l.created_at,'timezone',tz,'timezoneSource',l.attribution->>'contactTimezoneSource');
 return jsonb_build_object('timezone',tz,'until',expiry,'evidence','seller-intake:'||l.id||':'||encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $$;

create function public.icash_seller_voice_permission_current(p_account uuid,p_permission uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare p public.icash_contact_permissions;e jsonb;
begin
 select * into p from public.icash_contact_permissions where id=p_permission and account_id=p_account for share;
 if not found or p.seller_intake_id is null or p.party<>'seller' or p.revoked_at is not null or p.permission_until<=now()
  or p.dnc_clear or p.dnc_checked_at is not null or p.review_request_id is not null or p.buyer_id is not null
  or p.contact_key is distinct from encode(sha256(convert_to(p.phone,'UTF8')),'hex') then return false;end if;
 e:=public.icash_seller_contact_evidence(p.account_id,p.screening_id,p.seller_intake_id,p.phone);
 return e is not null and p.permission_evidence is not distinct from e->>'evidence'
  and p.timezone is not distinct from e->>'timezone' and p.permission_until is not distinct from (e->>'until')::timestamptz
  and p.local_start_hour=9 and p.local_end_hour=20;
end $$;

create function public.icash_seller_sms_permission_current(p_account uuid,p_thread uuid,p_check_hour boolean default true)
returns boolean language plpgsql security invoker set search_path='' as $$
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
 return not p_check_hour or (h>=9 and h<20);
end $$;

create function public.icash_prepare_seller_contacts(p_account uuid,p_lead uuid,p_screening uuid,p_deal uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;e jsonb;r public.icash_operation_rates;chosen_sender text;price bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found then return;end if;
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account and screening_id=p_screening and stage='draft' and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return;end if;
 select * into l from public.icash_seller_intakes where id=p_lead;
 e:=public.icash_seller_contact_evidence(p_account,p_screening,p_lead,l.phone);
 if e is null then return;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=p_screening and s.account_id=p_account and pc.manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return;end if;
 if public.icash_outreach_voice_current(p_account) then
  insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,local_start_hour,local_end_hour,permission_evidence,permission_until,dnc_checked_at,dnc_clear,seller_intake_id)
  values(p_account,p_screening,'seller',l.phone,encode(sha256(convert_to(l.phone,'UTF8')),'hex'),e->>'timezone',9,20,e->>'evidence',(e->>'until')::timestamptz,null,false,l.id)
  on conflict(account_id,screening_id,party,contact_key) do nothing;
 end if;
 if not public.icash_outreach_sms_current(p_account) then return;end if;
 -- Ambiguous sender configuration must not silently select a different business number.
 if (select count(*) from public.icash_text_senders where enabled)<>1 then return;end if;
 select phone into chosen_sender from public.icash_text_senders where enabled for share;
 select * into r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id) order by verified_at desc,charge_cents,id limit 1 for share;
 if not found then return;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused,ai_mode,party,seller_intake_id,seller_sms_rate_hash,seller_sms_price_micros)
 values(p_account,p_deal,chosen_sender,l.phone,(e->>'until')::timestamptz,e->>'evidence',e->>'timezone',null,false,r.id,false,'auto','seller',l.id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),price)
 on conflict(sender,recipient) do nothing;
 -- Never reassign, unpause, renew or overwrite an existing contact on a retry.
end $$;

revoke all on function public.icash_seller_contact_evidence(uuid,uuid,uuid,text),public.icash_seller_voice_permission_current(uuid,uuid),public.icash_seller_sms_permission_current(uuid,uuid,boolean),public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_contact_evidence(uuid,uuid,uuid,text),public.icash_seller_voice_permission_current(uuid,uuid),public.icash_seller_sms_permission_current(uuid,uuid,boolean),public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid) to service_role;
