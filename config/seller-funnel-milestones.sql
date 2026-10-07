begin;
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
CREATE OR REPLACE FUNCTION public.icash_collect_seller_milestones()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select distinct on(l.id) l.id,'Contact',msg.created_at,'seller-sms:'||msg.id
 from public.icash_seller_intakes l join public.icash_seller_matches sm on sm.lead_id=l.id join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone join public.icash_text_messages msg on msg.account_id=t.account_id and msg.thread_id=t.id
 where msg.direction='incoming' and msg.state='received' and msg.provider_id is not null order by l.id,msg.created_at on conflict do nothing;
 -- Completed provider conversation with an actual seller utterance, not a dial attempt.
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select distinct on (l.id) l.id,'Contact',c.completed_at,'conversation:'||c.id
 from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id join public.icash_live_conversations c on c.account_id=m.account_id and c.screening_id=m.screening_id
 where c.party='seller' and c.state='complete' and c.completed_at is not null and (c.result->>'durationSeconds')::numeric>0
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.result->'transcript')='array' then c.result->'transcript' else '[]'::jsonb end) t where t->>'role'='user' and length(trim(t->>'message'))>2)
 order by l.id,c.completed_at on conflict do nothing;
 -- User-selected advertising definition: SubmitApplication means an executed purchase.
 -- A drafted, sent, test or partially signed contract cannot create this event.
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select distinct on (l.id) l.id,'SubmitApplication',d.seller_signed_at,'executed-purchase:'||e.id
 from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
 join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' and e.provider_id is not null
 where d.seller_signed_at is not null order by l.id,d.seller_signed_at on conflict do nothing;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_finish_seller_lookup(p_id uuid, p_token uuid, p_output jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;parts jsonb;cost bigint;numbers boolean;market boolean;city_name text;st text;used integer;duplicate_property uuid;
begin
 perform 1 from public.icash_seller_controls where id=1 for update;
 select * into l from public.icash_seller_intakes where id=p_id for update;
 if not found or l.state<>'checking' or l.claim_token<>p_token or l.claimed_at<now()-interval '2 minutes' then return false;end if;
 used:=(p_output->>'creditsUsed')::integer;
 if used not between 0 and 1 or used is null or octet_length(p_output::text)>64000 then raise exception 'Invalid lookup receipt';end if;
 numbers:=coalesce((p_output->>'numbersPassed')::boolean,false) and p_output->'result'->'financialCheck'->>'status'='eligible' and (p_output->'result'->>'preliminarySellerCeilingCents')::bigint>0;
 city_name:=lower(trim(p_output->'property'->>'city'));st:=upper(p_output->'property'->>'state');
 market:=numbers;
 parts:=l.lookup_costs||jsonb_build_object('dealmachine',(l.lookup_costs->>'dealmachine')::bigint*used);
 select sum(value::numeric)::bigint into cost from jsonb_each_text(parts);
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros-l.lookup_cap_micros,lookup_used_micros=lookup_used_micros+cost where id=1;
 if p_output->'property'->>'id' is not null then
  perform pg_advisory_xact_lock(hashtextextended('seller-property:'||(p_output->'property'->>'id'),0));
  select id into duplicate_property from public.icash_seller_intakes where id<>l.id and property->>'id'=p_output->'property'->>'id' and state<>'duplicate' and checked_at is not null and created_at>now()-interval '90 days' order by created_at limit 1;
 end if;
 if duplicate_property is not null then
  update public.icash_seller_intakes set state='duplicate',canonical_id=duplicate_property,lookup_costs=parts,result=p_output->'result',property=p_output->'property',checked_at=now(),numbers_passed=false,market_qualified=false where id=l.id;
  return true;
 end if;
 update public.icash_seller_intakes set lookup_costs=parts,result=p_output->'result',property=p_output->'property',numbers_passed=coalesce(numbers,false),market_qualified=coalesce(market,false),checked_at=now(),state=case when market then 'qualified' when p_output->>'status'='unmatched' then 'unmatched' else 'numbers_review' end where id=l.id;
 if market then insert into public.icash_seller_events(lead_id,event_name,evidence_ref) values(l.id,'Lead','inbound-address:screening:'||l.id) on conflict do nothing;end if;
 return true;
end $function$
;
-- Backfill genuine recent submissions only; do not modify previously delivered event identities.
insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref) select id,'CompleteRegistration',created_at,'seller-form:'||id from public.icash_seller_intakes where state<>'duplicate' and created_at>now()-interval '7 days' on conflict do nothing;
CREATE OR REPLACE FUNCTION public.icash_claim_seller_event()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare e public.icash_seller_events;l public.icash_seller_intakes;token uuid:=gen_random_uuid();
begin
 update public.icash_seller_events set delivery_state=case when attempts>=3 or occurred_at<now()-interval '7 days' then 'review' else 'pending' end where delivery_state='sending' and attempted_at<now()-interval '2 minutes';
 update public.icash_seller_events set delivery_state='review' where delivery_state='pending' and occurred_at<now()-interval '7 days';
 select ev.* into e from public.icash_seller_events ev join public.icash_seller_intakes i on i.id=ev.lead_id where ev.delivery_state='pending' and (ev.attempted_at is null or ev.attempted_at<now()-interval '2 minutes') and i.attribution->>'source'='meta' and coalesce((i.attribution->>'measurementOptOut')::boolean,false)=false order by ev.occurred_at limit 1 for update of ev skip locked;
 if not found then return null;end if;
 select * into l from public.icash_seller_intakes where id=e.lead_id;
 update public.icash_seller_events set delivery_state='sending',delivery_token=token,attempted_at=now(),attempts=attempts+1 where id=e.id;
 return jsonb_build_object('id',e.id,'leadId',l.id,'token',token,'name',e.event_name,'occurredAt',e.occurred_at,'phone',l.phone,'actionSource',case when e.event_name='Contact' and e.evidence_ref like 'seller-sms:%' then 'chat' when e.event_name='Contact' then 'phone_call' else 'system_generated' end);
end $function$

;
commit;

