-- New submissions only: retain legacy evidence and preserve caller-specific permissions.
alter table public.icash_seller_intakes add column email text,
 add column email_consented boolean not null default false,
 add column contact_consent_scope text check(contact_consent_scope is null or contact_consent_scope='homeoffer_network_and_matched_buyers'),
 add constraint seller_email_consent_requires_address check(not email_consented or (email is not null and ai_consented and contact_consent_scope='homeoffer_network_and_matched_buyers'));
create function public.icash_submit_seller_contact_intake(p_request uuid,p_guest text,p_name text,p_address text,p_phone text,p_duplicate text,p_consented boolean,p_consent_version text,p_consent_text text,p_sharing_text text,p_attribution jsonb,p_agent_hash text,p_email text default null) returns uuid
language plpgsql security invoker set search_path='' as $$
declare prior public.icash_seller_intakes;canonical uuid;new_id uuid;email_value text:=nullif(lower(trim(p_email)),'');
begin
 if email_value is not null and (length(email_value)>254 or email_value !~ '^[^[:space:]<>@]+@[^[:space:]<>@]+[.][^[:space:]<>@]+$') then raise exception 'Invalid email';end if;
 if p_guest !~ '^[a-f0-9]{64}$' or p_agent_hash !~ '^[a-f0-9]{64}$' or p_duplicate !~ '^[a-f0-9]{64}$' or p_consent_version<>'homeoffer-seller-contact-2026-10-05.2' or length(p_consent_text)<100 or length(p_sharing_text)<100 or octet_length(p_attribution::text)>1500 then raise exception 'Invalid intake evidence';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_duplicate,0));
 select * into prior from public.icash_seller_intakes where request_id=p_request;
 if found then
  if row(prior.guest_hash,prior.name,prior.address,prior.phone,prior.ai_consented,prior.consent_version,prior.consent_text,prior.sharing_text,prior.attribution,prior.email) is distinct from row(p_guest,p_name,p_address,p_phone,p_consented,p_consent_version,p_consent_text,p_sharing_text,p_attribution,email_value) then raise exception 'Submission retry mismatch';end if;
  return prior.id;
 end if;
 select id into canonical from public.icash_seller_intakes where duplicate_key=p_duplicate and state<>'duplicate' and created_at>now()-interval '90 days' order by created_at limit 1;
 insert into public.icash_seller_intakes(request_id,guest_hash,name,address,phone,duplicate_key,ai_consented,consent_version,consent_text,sharing_text,attribution,agent_hash,state,canonical_id,email,email_consented,contact_consent_scope)
 values(p_request,p_guest,p_name,p_address,p_phone,p_duplicate,p_consented,p_consent_version,p_consent_text,p_sharing_text,p_attribution,p_agent_hash,case when canonical is null then 'received' else 'duplicate' end,canonical,email_value,p_consented and email_value is not null,case when p_consented then 'homeoffer_network_and_matched_buyers' else null end) returning id into new_id;
 return new_id;
end $$;
revoke all on function public.icash_submit_seller_contact_intake(uuid,text,text,text,text,text,boolean,text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.icash_submit_seller_contact_intake(uuid,text,text,text,text,text,boolean,text,text,text,jsonb,text,text) to service_role;

-- Carry the actual disclosure and scope into each genuine buyer's match.
-- This records evidence; it does not rewrite existing lead/contact permissions.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_assign_seller_lead()'::regprocedure);
 needle:=$old$'consentVersion',l.consent_version,'shared',true$old$;
 if position(needle in definition)=0 then raise exception 'Seller contact evidence anchor changed';end if;
 definition:=replace(definition,needle,$new$'consentVersion',l.consent_version,'consentText',l.consent_text,'consentScope',l.contact_consent_scope,'email',l.email,'emailConsented',l.email_consented,'shared',true$new$);
 execute definition;
end $patch$;
