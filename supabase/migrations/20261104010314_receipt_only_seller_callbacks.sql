-- A real prior seller call can identify its customer/property without creating
-- an SMS thread, granting messaging permission or inventing conversation history.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function icash_callback_private.manual_seller_source(p_account uuid,p_screening uuid,p_phone text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_seller_intakes i where i.phone=p_phone
   and ((i.assigned_account=p_account and i.screening_id=p_screening)
    or exists(select 1 from public.icash_seller_matches m where m.lead_id=i.id and m.account_id=p_account and m.screening_id=p_screening))
 ) or exists(
  select 1 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and d.screening_id=p_screening and t.recipient=p_phone
   and t.party='seller' and t.owner_buyer_test_id is null
 ) or exists(
  select 1 from public.icash_owner_contacts o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.result->'contacts')='array' then o.result->'contacts' else '[]'::jsonb end) c
  cross join lateral jsonb_array_elements(case when jsonb_typeof(c->'phones')='array' then c->'phones' else '[]'::jsonb end) n
  cross join lateral (select regexp_replace(n->>'number','[^0-9]','','g') digits) normalized
  where o.account_id=p_account and o.screening_id=p_screening
   and case when length(digits)=10 then '+1'||digits else '+'||digits end=p_phone
 );
$$;

create function icash_callback_private.call_candidates(p_phone text,p_business text default null)
returns table(account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,
 business_number text,address text,account_name text,last_contact_at timestamptz,available boolean)
language sql stable security invoker set search_path='' as $$
 with receipts as (
  select r.account_id,r.screening_id,r.from_phone business_number,r.provider_account_sid,r.dial_claimed_at at
  from public.icash_call_recordings r
  where r.to_phone=p_phone and r.party='seller' and r.call_sid~'^CA[0-9a-fA-F]{32}$'
   and r.provider_account_sid~'^AC[0-9a-fA-F]{32}$'
   and (r.from_phone='+14243948384' or r.caller_id_sid~'^PN[0-9a-fA-F]{32}$')
   and r.dial_claimed_at between now()-interval '30 days' and now()
  union all
  select c.account_id,c.screening_id,c.business_phone,c.provider_account_sid,c.created_at
  from public.icash_customer_phone_calls c
  where c.recipient_phone=p_phone and c.child_sid~'^CA[0-9a-fA-F]{32}$'
   and c.provider_account_sid~'^AC[0-9a-fA-F]{32}$'
   and c.created_at between now()-interval '30 days' and now()
   and icash_callback_private.manual_seller_source(c.account_id,c.screening_id,p_phone)
 ), evidence as (
  select r.account_id,r.screening_id,r.business_number,min(r.provider_account_sid) provider_account_sid,
   count(distinct r.provider_account_sid)=1 one_provider,max(r.at) at
  from receipts r where r.business_number in ('+14243948384','+17208134296','+14244377030','+14154208230','+16195364770')
   and (p_business is null or r.business_number=p_business)
  group by r.account_id,r.screening_id,r.business_number
 )
 select e.account_id,d.id,e.screening_id,null::uuid,e.business_number,
  coalesce(label.address,'Address pending'),coalesce(nullif(a.legal_name,''),nullif(a.assistant_name,''),'Customer account'),e.at,
  coalesce(not a.bot_paused and s.state='complete' and (d.id is null or d.stage not in ('closed','cancelled'))
   and e.one_provider and length(btrim(label.address)) between 1 and 300 and label.address!~'[<>{}[:cntrl:]]'
   and not exists(select 1 from public.icash_property_controls pc where pc.account_id=e.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   and not exists(select 1 from public.icash_contact_suppressions cs where cs.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex'))
   and not exists(select 1 from public.icash_text_suppressions ts where ts.phone=p_phone)
   and not exists(select 1 from public.icash_webinar_phone_suppressions ws where ws.phone=p_phone)
   and not exists(select 1 from public.icash_sms_routes route where route.sender=e.business_number and route.recipient=p_phone and (route.account_id<>e.account_id or route.needs_review))
   and not exists(select 1 from public.icash_text_threads t join public.icash_deal_files td on td.id=t.deal_id and td.account_id=t.account_id
    where t.account_id=e.account_id and td.screening_id=e.screening_id and t.recipient=p_phone
     and (t.retired_at is not null or t.paused or t.manual_only or t.party<>'seller' or t.owner_buyer_test_id is not null))
   and ((e.business_number='+14243948384' and exists(select 1 from icash_recorded_reception_private.configs c
     where c.called_number='+17816093521' and c.callback_template_id is null and c.provider_account_sid=e.provider_account_sid))
    or exists(select 1 from public.icash_business_voice_numbers n where n.phone=e.business_number
     and n.provider_account_sid=e.provider_account_sid and n.outbound_enabled and n.forwarding_ready and n.caller_id_sid is not null)),false)
 from evidence e
 join public.icash_screening_jobs s on s.id=e.screening_id and s.account_id=e.account_id
 join public.icash_accounts a on a.id=e.account_id
 left join public.icash_deal_files d on d.screening_id=e.screening_id and d.account_id=e.account_id
 cross join lateral (select coalesce(nullif(d.terms->>'address',''),nullif(s.result#>>'{property,address}',''),
  nullif(s.snapshot->>'address',''),nullif(s.snapshot#>>'{raw,data,full_address}','')) address) label
 where p_phone~'^\+1[2-9][0-9]{9}$'
  and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
  -- Existing threads, including paused and retired ones, retain their original
  -- candidate and controls. A second receipt-only row must not bypass them.
  and not exists(select 1 from public.icash_text_threads t join public.icash_deal_files td on td.id=t.deal_id and td.account_id=t.account_id
   where t.account_id=e.account_id and td.screening_id=e.screening_id and t.recipient=p_phone and t.sender=e.business_number and t.party='seller');
$$;

-- A real buyer call or a manual call with no positive seller-source binding
-- must not make another account's seller candidate appear uniquely attributable.
create function icash_callback_private.call_role_conflict(p_phone text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_call_recordings r where r.to_phone=p_phone and r.party is distinct from 'seller'
  and r.call_sid~'^CA[0-9a-fA-F]{32}$' and r.provider_account_sid~'^AC[0-9a-fA-F]{32}$'
  and r.dial_claimed_at between now()-interval '30 days' and now())
 or exists(select 1 from public.icash_customer_phone_calls c where c.recipient_phone=p_phone
  and c.child_sid~'^CA[0-9a-fA-F]{32}$' and c.provider_account_sid~'^AC[0-9a-fA-F]{32}$'
  and c.created_at between now()-interval '30 days' and now()
  and not icash_callback_private.manual_seller_source(c.account_id,c.screening_id,p_phone));
$$;
revoke all on function icash_callback_private.manual_seller_source(uuid,uuid,text),icash_callback_private.call_candidates(text,text),icash_callback_private.call_role_conflict(text) from public,anon,authenticated;
grant execute on function icash_callback_private.manual_seller_source(uuid,uuid,text),icash_callback_private.call_candidates(text,text),icash_callback_private.call_role_conflict(text) to service_role;

-- Keep the current threaded implementation, including all later guards, intact.
do $threaded$
declare definition text;needle text:='FUNCTION icash_callback_private.candidates(p_phone text, p_business text DEFAULT NULL::text)';
begin
 if to_regprocedure('icash_callback_private.thread_candidates(text,text)') is not null then raise exception 'Threaded callback snapshot already exists';end if;
 definition:=pg_get_functiondef('icash_callback_private.candidates(text,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position($numbers$('+14243948384','+17208134296','+14244377030','+14154208230','+16195364770')$numbers$ in definition)=0 then
  raise exception 'Expanded threaded callback prerequisite changed';end if;
 execute replace(definition,needle,'FUNCTION icash_callback_private.thread_candidates(p_phone text, p_business text DEFAULT NULL::text)');
end $threaded$;
revoke all on function icash_callback_private.thread_candidates(text,text) from public,anon,authenticated;
grant execute on function icash_callback_private.thread_candidates(text,text) to service_role;

create or replace function icash_callback_private.candidates(p_phone text,p_business text default null)
returns table(account_id uuid,deal_id uuid,screening_id uuid,thread_id uuid,
 business_number text,address text,account_name text,last_contact_at timestamptz,available boolean)
language sql stable security invoker set search_path='' as $$
 select * from icash_callback_private.thread_candidates(p_phone,p_business)
 union all select * from icash_callback_private.call_candidates(p_phone,p_business);
$$;

do $route$
declare definition text;patch record;
begin
 definition:=pg_get_functiondef('icash_callback_private.route(text)'::regprocedure);
 for patch in select * from (values
  ('count(distinct deal_id) deals','count(distinct screening_id) deals'),
  ('when accounts<>1 then',
   $role$when icash_callback_private.call_role_conflict(p_phone) then jsonb_build_object('status','ambiguous_account')
  when accounts<>1 then$role$),
  ($old$'threadId',thread_id,'screeningId',screening_id,'businessNumber',business_number)$old$,
   $new$'threadId',thread_id,'screeningId',screening_id,'businessNumber',business_number)||case when thread_id is null then jsonb_build_object('source','call') else '{}'::jsonb end$new$)
 ) changes(needle,replacement)
 loop
  if (length(definition)-length(replace(definition,patch.needle,'')))/length(patch.needle)<>1 then raise exception 'Callback route boundary changed';end if;
  definition:=replace(definition,patch.needle,patch.replacement);
 end loop;
 execute definition;
end $route$;

-- A call-only session stays bound to the exact current tuple and mode. An added
-- thread, draft, conflicting account/property, missing receipt or late hold
-- invalidates it; no account or property is guessed during an admitted call.
do $session$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('icash_callback_private.session_current(icash_recorded_reception_private.sessions)'::regprocedure);
 needle:=$old$and case when s.callback_route->>'status'='matched' then exists($old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Callback session boundary changed';end if;
 execute replace(definition,needle,$new$and case when s.callback_route->>'source'='call' then
   s.callback_route->>'status'='matched' and s.callback_route->>'threadId' is null
   and icash_callback_private.route(s.from_phone)->>'status'='matched'
   and icash_callback_private.route(s.from_phone)->>'source'='call'
   and exists(select 1 from icash_callback_private.call_candidates(s.from_phone) t where t.account_id=s.account_id
    and t.thread_id is null and t.screening_id=(s.callback_route->>'screeningId')::uuid
    and t.deal_id is not distinct from (s.callback_route->>'dealId')::uuid
    and t.business_number=s.callback_route->>'businessNumber' and t.available)
  when s.callback_route->>'status'='matched' then exists($new$);
end $session$;

create function icash_callback_private.call_context(s icash_recorded_reception_private.sessions)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('status','matched','address',t.address,'callbackSource','call')
 from icash_callback_private.call_candidates(s.from_phone) t
 where s.callback_route->>'source'='call' and s.callback_route->>'status'='matched'
  and t.account_id=s.account_id and t.screening_id=(s.callback_route->>'screeningId')::uuid
  and t.deal_id is not distinct from (s.callback_route->>'dealId')::uuid
  and t.business_number=s.callback_route->>'businessNumber' and t.thread_id is null and t.available
  and icash_callback_private.session_current(s);
$$;
revoke all on function icash_callback_private.call_context(icash_recorded_reception_private.sessions) from public,anon,authenticated,service_role;

-- Insert after the existing full nonce/recording/account/template/rate/deadline
-- admission and recipient suppression checks. No provider prompt or tool policy
-- is replaced; this branch grants only public property context, not SMS/history,
-- ownership verification, agreement authority or a fabricated inbound binding.
do $context$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_reception_context_before_agreement(uuid,text)'::regprocedure);
 needle:=$old$if r.callback_route->>'status'='ambiguous' then return jsonb_build_object('status','ambiguous');end if;$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Admitted callback context boundary changed';end if;
 execute replace(definition,needle,needle||chr(10)||$new$ if r.callback_route->>'source'='call' then return icash_callback_private.call_context(r);end if;$new$);

 definition:=pg_get_functiondef('public.icash_reception_context_before_payoff(uuid,text)'::regprocedure);
 needle:=' context:=public.icash_reception_context_before_agreement(p_id,p_nonce_hash);';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Agreement callback wrapper changed';end if;
 execute replace(definition,needle,needle||chr(10)||$new$ if context->>'callbackSource'='call' then return context;end if;$new$);
end $context$;
commit;
