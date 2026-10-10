begin;
set local lock_timeout='3s';
-- A demo has its own truthful brand/consent and a single presenting account.
alter table public.icash_seller_intakes drop constraint icash_seller_intakes_contact_consent_scope_check;
alter table public.icash_seller_intakes add constraint icash_seller_intakes_contact_consent_scope_check
 check(contact_consent_scope is null or contact_consent_scope in ('homeoffer_network_and_matched_buyers','icash_x_demo'));

create function public.icash_submit_bot_demo_intake(p_actor uuid,p_account uuid,p_request uuid,p_guest text,p_name text,p_address text,p_phone text,p_consented boolean,p_duplicate text,p_timezone text,p_agent_hash text)
returns uuid language plpgsql security invoker set search_path='' as $demo$
declare prior public.icash_seller_intakes;canonical uuid;new_id uuid;attribution jsonb;
 consent_version constant text:='icash-x-demo-contact-2026-10-10.1';
 consent_text constant text:='I agree to calls and texts from iCash X about this property demo, including automated texts and AI-generated voice calls. I have permission to use this number. Consent is not a condition of purchase. Message/data rates may apply. Reply STOP to end texts.';
 sharing_text constant text:='iCash X uses the details you enter to research the property and demonstrate the bot in the presenting account’s workspace. Demo requests are not distributed to other customer accounts. No offer or sale is guaranteed.';
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for share;
 if not found then raise exception 'Presenting account required';end if;
 if p_consented is distinct from true or p_guest is null or p_guest!~'^[a-f0-9]{64}$'
  or p_agent_hash is null or p_agent_hash!~'^[a-f0-9]{64}$' or p_duplicate is null or p_duplicate!~'^[a-f0-9]{64}$'
  or not exists(select 1 from public.icash_timezone_names where name=p_timezone) then raise exception 'Valid demo consent required';end if;
 attribution:=jsonb_build_object('source','icash_x_demo','demoAccountId',p_account,'contactTimezone',p_timezone,'contactTimezoneSource','seller_browser','measurementOptOut',true);
 perform pg_advisory_xact_lock(hashtextextended(p_duplicate,0));
 select * into prior from public.icash_seller_intakes where request_id=p_request;
 if found then
  if row(prior.guest_hash,prior.name,prior.address,prior.phone,prior.ai_consented,prior.consent_version,prior.consent_text,prior.sharing_text,prior.attribution)
   is distinct from row(p_guest,p_name,p_address,p_phone,p_consented,consent_version,consent_text,sharing_text,attribution) then raise exception 'Submission retry mismatch';end if;
  return prior.id;
 end if;
 select id into canonical from public.icash_seller_intakes where duplicate_key=p_duplicate and state<>'duplicate'
  and contact_consent_scope='icash_x_demo' and icash_seller_intakes.attribution->>'demoAccountId'=p_account::text
  and created_at>now()-interval '90 days' order by created_at limit 1;
 insert into public.icash_seller_intakes(request_id,guest_hash,name,address,phone,duplicate_key,ai_consented,consent_version,consent_text,sharing_text,attribution,agent_hash,state,canonical_id,owner_claimed,email_consented,contact_consent_scope)
 values(p_request,p_guest,p_name,p_address,p_phone,p_duplicate,true,consent_version,consent_text,sharing_text,attribution,p_agent_hash,case when canonical is null then 'received' else 'duplicate' end,canonical,false,false,'icash_x_demo')
 returning id into new_id;
 -- Demo requests are deliberately excluded from seller ad conversion events.
 return new_id;
end $demo$;
revoke all on function public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text) to service_role;

-- Preserve the current assignment and permission implementations, with exact
-- source checks so a changed production definition cannot be silently patched.
do $patch$
declare d text;needle text:=$old$  or l.consent_version is distinct from 'homeoffer-seller-contact-2026-10-05.4'
  or l.contact_consent_scope is distinct from 'homeoffer_network_and_matched_buyers'
  or l.consent_text is distinct from 'I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.'
$old$;replacement text:=$new$  or (
   (l.consent_version='homeoffer-seller-contact-2026-10-05.4' and l.contact_consent_scope='homeoffer_network_and_matched_buyers'
    and l.consent_text='I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.')
   or (l.consent_version='icash-x-demo-contact-2026-10-10.1' and l.contact_consent_scope='icash_x_demo'
    and l.consent_text='I agree to calls and texts from iCash X about this property demo, including automated texts and AI-generated voice calls. I have permission to use this number. Consent is not a condition of purchase. Message/data rates may apply. Reply STOP to end texts.' and l.attribution->>'demoAccountId'=p_account::text)
  ) is not true
  or l.consent_version is null or l.consent_text is null or l.contact_consent_scope is null
$new$;
begin
 d:=pg_get_functiondef('public.icash_seller_contact_evidence(uuid,uuid,uuid,text)'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'Expected icash_seller_contact_evidence(uuid,uuid,uuid,text) demo prerequisite missing';end if;
 execute replace(d,needle,replacement);
end $patch$;
do $patch$
declare d text;needle text:=$old$ and (select count(*) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<3$old$;replacement text:=$new$ and (select count(*) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<case when contact_consent_scope='icash_x_demo' then 1 else 3 end$new$;
begin
 d:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'Expected icash_assign_seller_lead_for(uuid) demo prerequisite missing';end if;
 execute replace(d,needle,replacement);
end $patch$;
do $patch$
declare d text;needle text:=$old$where public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused$old$;replacement text:=$new$where (icash_seller_intakes.contact_consent_scope is distinct from 'icash_x_demo' or icash_seller_intakes.attribution->>'demoAccountId'=ac.id::text) and public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused$new$;
begin
 d:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'Expected icash_assign_seller_lead_for(uuid) demo prerequisite missing';end if;
 execute replace(d,needle,replacement);
end $patch$;
do $patch$
declare d text;needle text:=$old$where not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>ac.id)$old$;replacement text:=$new$where (l.contact_consent_scope is distinct from 'icash_x_demo' or l.attribution->>'demoAccountId'=ac.id::text) and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>ac.id)$new$;
begin
 d:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'Expected icash_assign_seller_lead_for(uuid) demo prerequisite missing';end if;
 execute replace(d,needle,replacement);
end $patch$;
do $patch$
declare d text;needle text:=$old$'shared',true,'maximumBuyers',3$old$;replacement text:=$new$'shared',l.contact_consent_scope is distinct from 'icash_x_demo','maximumBuyers',case when l.contact_consent_scope='icash_x_demo' then 1 else 3 end$new$;
begin
 d:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 if strpos(d,needle)=0 then raise exception 'Expected icash_assign_seller_lead_for(uuid) demo prerequisite missing';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
