-- Current production functions captured read-only on October 16, 2026.
-- Used only by isolated SQL tests; no customer data or provider operations.
CREATE OR REPLACE FUNCTION public.icash_seller_recipient_opener(p_account uuid, p_thread uuid, p_seller text, p_principal text, p_address text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare ordinal integer;greeting text;body text;
begin
 -- Bind the ordinal to this exact active account/property/consented intake. Copy
 -- lookup is not authorization; the caller retains its full current consent gate.
 select o.recipient_ordinal into ordinal
 from public.icash_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_seller_matches m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id and m.screening_id=d.screening_id
 join public.icash_seller_recipient_ordinals o on o.lead_id=m.lead_id and o.account_id=m.account_id
 where t.id=p_thread and t.account_id=p_account and t.party='seller' and t.retired_at is null;
 if ordinal is null or ordinal not between 1 and 3
  or nullif(trim(p_principal),'') is null or nullif(trim(p_address),'') is null then return null;end if;
 p_address:=public.icash_conversation_street(p_address);
 greeting:=case when p_seller ~ '^[A-Za-z][A-Za-z]{0,30}$' then 'Hi '||p_seller||', ' else 'Hi, ' end;
 body:=case ordinal
  when 1 then 'Is this '||case when p_seller ~ '^[A-Za-z][A-Za-z]{0,30}$' then p_seller||', ' else '' end||'the owner of '||p_address||'? I am reaching out about a possible cash offer.'
  when 2 then greeting||'do you own '||p_address||'? I wanted to ask about a possible cash offer.'
  when 3 then greeting||'is '||p_address||' your property? I am contacting you about a possible cash offer.'
 end;
 -- Never truncate the property address or silently buy more segments.
 if length(body)>160 or body ~ '[^A-Za-z0-9 .,!?]' then return null;end if;
 return body;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_submit_seller_contact_intake(p_request uuid, p_guest text, p_name text, p_address text, p_phone text, p_duplicate text, p_consented boolean, p_consent_version text, p_consent_text text, p_sharing_text text, p_attribution jsonb, p_agent_hash text, p_email text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior public.icash_seller_intakes;canonical uuid;new_id uuid;email_value text:=nullif(lower(trim(p_email)),'');
begin
 if p_consent_version='homeoffer-seller-contact-2026-10-05.4' and p_consented is distinct from true then raise exception 'Contact agreement needed';end if;
 if email_value is not null and (length(email_value)>254 or email_value !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$') then raise exception 'Invalid email';end if;
 if p_guest !~ '^[a-f0-9]{64}$' or p_agent_hash !~ '^[a-f0-9]{64}$' or p_duplicate !~ '^[a-f0-9]{64}$' or p_consent_version not in ('homeoffer-seller-contact-2026-10-05.2','homeoffer-seller-contact-2026-10-05.3','homeoffer-seller-contact-2026-10-05.4') or length(p_consent_text)<100 or length(p_sharing_text)<100 or octet_length(p_attribution::text)>1500 then raise exception 'Invalid intake evidence';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_duplicate,0));
 select * into prior from public.icash_seller_intakes where request_id=p_request;
 if found then
  if row(prior.guest_hash,prior.name,prior.address,prior.phone,prior.ai_consented,prior.consent_version,prior.consent_text,prior.sharing_text,prior.attribution,prior.email) is distinct from row(p_guest,p_name,p_address,p_phone,p_consented,p_consent_version,p_consent_text,p_sharing_text,p_attribution,email_value) then raise exception 'Submission retry mismatch';end if;
  return prior.id;
 end if;
 select id into canonical from public.icash_seller_intakes where duplicate_key=p_duplicate and state<>'duplicate' and created_at>now()-interval '90 days' order by created_at limit 1;
 insert into public.icash_seller_intakes(request_id,guest_hash,name,address,phone,duplicate_key,ai_consented,consent_version,consent_text,sharing_text,attribution,agent_hash,state,canonical_id,owner_claimed,email,email_consented,contact_consent_scope)
 values(p_request,p_guest,p_name,p_address,p_phone,p_duplicate,p_consented,p_consent_version,p_consent_text,p_sharing_text,p_attribution,p_agent_hash,case when canonical is null then 'received' else 'duplicate' end,canonical,p_consent_version<>'homeoffer-seller-contact-2026-10-05.4',email_value,p_consented and email_value is not null,case when p_consented then 'homeoffer_network_and_matched_buyers' else null end) returning id into new_id;
 if canonical is null then insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref) values(new_id,'CompleteRegistration',now(),'seller-form:'||new_id) on conflict do nothing;end if;
 return new_id;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_seller_call_request(p_account uuid, p_screening uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('name',i.name,'submittedAt',i.created_at) from public.icash_seller_matches m join public.icash_seller_intakes i on i.id=m.lead_id
 where m.account_id=p_account and m.screening_id=p_screening and i.phone=p_phone and i.ai_consented and i.state<>'duplicate';
$function$
;
