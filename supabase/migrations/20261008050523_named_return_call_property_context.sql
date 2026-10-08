-- Return-call continuity is distinct from SMS attribution. It changes neither
-- outbound permission nor offer/contract authority. No historical SMS is edited.
begin;
set local lock_timeout='2s';
create function icash_recorded_reception_private.return_call_focus(p_account uuid,p_phone text,p_clock timestamptz)
returns uuid language sql stable security invoker set search_path='' as $$
 select case when count(*)=1 then min(f.thread_id::text)::uuid end
 from public.icash_sms_conversation_focus f
 join public.icash_sms_routes route on route.sender=f.sender and route.recipient=f.recipient and route.account_id=f.account_id and route.revision=f.route_revision and not route.needs_review
 join public.icash_text_threads t on t.id=f.thread_id and t.account_id=f.account_id and t.sender=f.sender and t.recipient=f.recipient
 join public.icash_text_messages source on source.id=f.source_id and source.account_id=f.account_id and source.thread_id=f.thread_id and source.direction='incoming' and source.state='received'
 where f.account_id=p_account and f.recipient=p_phone and isfinite(p_clock)
 and source.created_at between p_clock-interval '30 days' and p_clock
 and t.retired_at is null and t.party='seller' and not t.paused and not t.manual_only
 and not exists(select 1 from public.icash_text_threads other where other.account_id=p_account and other.recipient=p_phone and other.retired_at is null and other.party<>'seller')
 -- The existing SMS trigger clears focus as soon as another property is sent.
 -- Also verify it here so a stale/restored focus cannot select an old property.
 and not exists(select 1 from public.icash_text_messages other join public.icash_text_threads th on th.id=other.thread_id and th.account_id=other.account_id
  where th.sender=f.sender and th.recipient=f.recipient and th.id<>f.thread_id and other.direction='outgoing'
   and other.created_at between source.created_at and p_clock)
$$;
revoke all on function icash_recorded_reception_private.return_call_focus(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function icash_recorded_reception_private.return_call_focus(uuid,text,timestamptz) to service_role;

-- Only the person attached to this account, property, role and phone can name
-- a greeting. A discovered company is not treated as a person's first name.
create function icash_recorded_reception_private.contact_first_name(p_account uuid,p_deal uuid,p_party text,p_phone text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare names text[];name text;
begin
 with bound as (
  select d.screening_id,t.seller_intake_id from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
  where d.id=p_deal and d.account_id=p_account and t.party=p_party and t.recipient=p_phone and t.retired_at is null and not t.paused and not t.manual_only
 ), candidates as (
  select l.name from bound join public.icash_seller_intakes l on l.id=bound.seller_intake_id and l.phone=p_phone
  join public.icash_seller_matches m on m.lead_id=l.id and m.account_id=p_account and m.screening_id=bound.screening_id
  where p_party='seller' and l.state='assigned' and l.data_rights_until>now()
  union
  select b.display_name from bound join public.icash_contact_permissions p on p.screening_id=bound.screening_id and p.account_id=p_account and p.party='buyer' and p.phone=p_phone and p.revoked_at is null and p.permission_until>now()
  join public.icash_buyer_profiles b on b.id=p.buyer_id and b.account_id=p_account
  join public.icash_buyer_candidates c on c.buyer_id=b.id and c.deal_id=p_deal and c.rights_until>now()
  where p_party='buyer'
 ) select array_agg(distinct btrim(candidates.name)) into names from candidates where nullif(btrim(candidates.name),'') is not null;
 if cardinality(names) is distinct from 1 then return null;end if;
 name:=names[1];
 if length(name)>200 or name !~ '^[[:alpha:]''’ -]+$'
  or name ~* '\m(llc|inc|corp|corporation|company|properties|investments|holdings|trust|homes|partners|group)\M' then return null;end if;
 name:=split_part(btrim(regexp_replace(name,'[[:space:]]+',' ','g')),' ',1);
 if length(name) not between 1 and 40 or name ~* '^(unknown|potential|buyer|seller|owner|interested|selling|ready|not|yes|no|test|null|undefined)$' then return null;end if;
 return name;
end $$;
revoke all on function icash_recorded_reception_private.contact_first_name(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function icash_recorded_reception_private.contact_first_name(uuid,uuid,text,text) to service_role;
CREATE OR REPLACE FUNCTION public.icash_recorded_reception_property_context(p_id uuid, p_nonce_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_recorded_reception_private.sessions;matches jsonb;opportunity jsonb;focus_thread uuid;history jsonb;offer_source jsonb;checked_at timestamptz:=icash_recorded_reception_private.clock_now();
begin
 select s.* into r from icash_recorded_reception_private.sessions s
 join icash_recorded_reception_private.configs c on c.id=s.config_id
 join public.icash_accounts a on a.id=s.account_id and a.owner_user_id=c.owner_user_id
 join public.icash_operation_spend o on o.operation_key=s.operation_key and o.account_id=s.account_id
 where s.id=p_id and s.nonce_hash=p_nonce_hash and s.state='recording' and coalesce(s.consent_at,s.recording_authorized_at) is not null and s.recording_sid is not null
 and s.register_claimed_at is null and s.conversation_id is null and s.end_requested_at is null and s.call_ended_at is null
 and s.from_phone ~ '^\+[1-9][0-9]{7,14}$' and s.call_deadline_at>checked_at
 and c.enabled and not a.bot_paused and c.approved_at<=checked_at and c.reviewed_until>checked_at
 and o.state='dispatched' and o.rate_id=s.rate_id and o.charge_cap_cents=s.charge_cap_cents
 and ((c.context_policy='buyer_seller_v1' and c.context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57') or (c.context_policy='seller_offer_v2' and c.context_policy_hash='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78'))
 and length(btrim(c.context_approval_reference))>=10;
 if not found then return public.icash_recorded_reception_context_before_buyer(p_id,p_nonce_hash);end if;
 if exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(r.from_phone,'UTF8')),'hex'))
 or exists(select 1 from public.icash_text_suppressions where phone=r.from_phone) then return null;end if;
 -- Return calls remember the bound conversation after the SMS reply window.
 focus_thread:=icash_recorded_reception_private.return_call_focus(r.account_id,r.from_phone,checked_at);
 -- Caller ID permits public opportunity context only. Never seller identity,
 -- agreements, messages, account data, payment instructions or authentication.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id,t.id thread_id,t.party,d.terms->>'address' address,
   (not t.paused and not t.manual_only and not exists(select 1 from public.icash_property_controls pc where pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)) active
  from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
  where t.account_id=r.account_id and t.recipient=r.from_phone and t.retired_at is null and (focus_thread is null or t.id=focus_thread)
  and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
  and exists(select 1 from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=t.id and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at between checked_at-interval '30 days' and checked_at)
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'active')::boolean is not true or length(btrim(matches->0->>'address')) not between 1 and 300 then return null;end if;
 if matches->0->>'party'='buyer' then
  opportunity:=public.icash_buyer_package_data(r.account_id,(matches->0->>'id')::uuid);
  if opportunity is null then return null;end if;
  return jsonb_build_object('status','buyer','returningName',icash_recorded_reception_private.contact_first_name(r.account_id,(matches->0->>'id')::uuid,'buyer',r.from_phone),'address',opportunity->'address','purchasePriceCents',opportunity->'purchasePriceCents','assignmentFeeCents',opportunity->'assignmentFeeCents','askingPriceCents',opportunity->'askingPriceCents','buyerPaysClosingCosts',true);
 end if;
 if matches->0->>'party'='seller' then
  select jsonb_agg(m order by m->>'at',m->>'id') into history from (
   select jsonb_build_object('id',m.id,'direction',m.direction,'body',left(m.body,1000),'at',m.created_at) m
   from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=(matches->0->>'thread_id')::uuid
    and m.created_at between checked_at-interval '30 days' and checked_at
    and ((m.direction='incoming' and m.state='received') or (m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null))
   order by m.created_at desc,m.id desc limit 12
  ) recent;
  if r.configuration->>'context_policy'='seller_offer_v2' then
   -- Service-only underwriting source. The application recalculates eligibility
   -- and emits a strict public proposal allowlist, never this raw snapshot.
   select jsonb_build_object('dealStage',d.stage,'screeningSnapshot',sc.snapshot,'agreementPending',
    exists(select 1 from public.icash_signing_envelopes e where e.account_id=r.account_id and e.deal_id=d.id and e.kind='purchase' and e.state in ('awaiting_counterparty','completed')))
   into offer_source from public.icash_deal_files d join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
   where d.id=(matches->0->>'id')::uuid and d.account_id=r.account_id and sc.state='complete' and d.terms->>'address'=matches->0->>'address'
    and coalesce(d.terms->>'practice','false')<>'true';
  end if;
  return jsonb_build_object('status','matched','returningName',icash_recorded_reception_private.contact_first_name(r.account_id,(matches->0->>'id')::uuid,'seller',r.from_phone),'address',matches->0->>'address','smsContext',jsonb_build_object('threadId',matches->0->>'thread_id','messages',coalesce(history,'[]'::jsonb)))||coalesce(offer_source,'{}'::jsonb);
 end if;
 return null;
end $function$;

-- Keep the existing authorized buyer package and price checks; add only a name.
do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_buyer_voice_context(uuid)'::regprocedure);
 needle:=$old$return context||jsonb_build_object('purchasePriceCents',package->'purchasePriceCents'$old$;
 if position(needle in definition)=0 then raise exception 'Buyer voice context prerequisite changed';end if;
 execute replace(definition,needle,$new$return context||jsonb_build_object('firstName',icash_recorded_reception_private.contact_first_name(p.account_id,(context->>'dealId')::uuid,'buyer',p.phone),'purchasePriceCents',package->'purchasePriceCents'$new$);
end $patch$;
commit;
