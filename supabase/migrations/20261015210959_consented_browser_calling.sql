-- A source DNC flag is separate from current first-party seller consent.
-- Archived demo permissions stay revoked, but cannot poison a fresh, verified opt-in.
-- Actual recipient opt-outs and current-property revocations always remain blocking.
create or replace function public.icash_manual_contacts(p_account uuid,p_screening uuid)
returns table(phone text,name text,phone_type text,blocked boolean)
language sql stable security invoker set search_path='' as $$
 with raw as (
  select n->>'number' number,c->>'name' name,lower(n->>'type') kind,coalesce((n->>'doNotCall')::boolean,false) source_dnc
  from public.icash_owner_contacts o cross join lateral jsonb_array_elements(coalesce(o.result->'contacts','[]')) c
  cross join lateral jsonb_array_elements(coalesce(c->'phones','[]')) n where o.account_id=p_account and o.screening_id=p_screening
  union all select t.recipient,null,'unknown',false from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id where t.account_id=p_account and d.screening_id=p_screening
  union all select i.phone,i.name,'unknown',false from public.icash_seller_intakes i where (i.assigned_account=p_account and i.screening_id=p_screening) or exists(select 1 from public.icash_seller_matches m where m.lead_id=i.id and m.account_id=p_account and m.screening_id=p_screening)
 ), normalized as (
  select case when length(regexp_replace(number,'[^0-9]','','g'))=10 then '+1'||regexp_replace(number,'[^0-9]','','g') else '+'||regexp_replace(number,'[^0-9]','','g') end phone,name,kind,source_dnc from raw
 ), grouped as (
  select phone,string_agg(distinct name,' / ' order by name) name,case when bool_or(kind in ('wireless','mobile')) then 'wireless' when bool_or(kind='landline') then 'landline' else 'unknown' end kind,bool_or(source_dnc) source_dnc from normalized where phone ~ '^[+]1[2-9][0-9]{9}$' group by phone
 ), eligibility as (
  select g.*,exists(
   select 1 from public.icash_seller_intakes i where i.phone=g.phone
   and ((i.assigned_account=p_account and i.screening_id=p_screening) or exists(select 1 from public.icash_seller_matches m where m.lead_id=i.id and m.account_id=p_account and m.screening_id=p_screening))
   and public.icash_seller_contact_evidence(p_account,p_screening,i.id,g.phone) is not null
  ) opted_in from grouped g
 ) select e.phone,coalesce(e.name,'Saved contact'),e.kind,
 (e.source_dnc and not e.opted_in)
 or exists(select 1 from public.icash_text_suppressions s where s.phone=e.phone)
 or exists(select 1 from public.icash_contact_suppressions s where s.contact_key=encode(extensions.digest(e.phone,'sha256'),'hex'))
 or exists(select 1 from public.icash_contact_permissions p where p.account_id=p_account and p.phone=e.phone and p.revoked_at is not null
  and (p.screening_id=p_screening or not e.opted_in or not exists(select 1 from public.icash_screening_jobs old where old.id=p.screening_id and old.account_id=p_account and old.state='archived')))
 from eligibility e where exists(select 1 from public.icash_screening_jobs s where s.id=p_screening and s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyId' not like 'practice_%') order by 4,e.name,e.phone;
$$;
revoke all on function public.icash_manual_contacts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_manual_contacts(uuid,uuid) to service_role;

-- Resolve the business caller ID without requiring the customer to open Text first.
-- Keep an existing conversation's sender; otherwise use the configured business sender.
create or replace function public.icash_customer_call_sender(p_account uuid,p_screening uuid,p_recipient text)
returns text language sql stable security invoker set search_path='' as $$
 with existing as (
  select t.sender from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and d.screening_id=p_screening and t.recipient=p_recipient and t.retired_at is null
 ), chosen as (
  select case when exists(select 1 from existing)
   then (select e.sender from existing e join public.icash_text_senders s on s.phone=e.sender and s.enabled order by e.sender limit 1)
   else (select s.phone from public.icash_text_senders s where s.enabled order by s.phone limit 1) end sender
 ) select sender from chosen where exists(select 1 from public.icash_manual_contacts(p_account,p_screening) c where c.phone=p_recipient and not c.blocked);
$$;
revoke all on function public.icash_customer_call_sender(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_customer_call_sender(uuid,uuid,text) to service_role;

-- Preserve the current pricing, membership, credits, idempotency, recording and
-- takeover implementation. Replace only its historical Text-first dependency.
do $patch$
declare definition text;before text;after text;
begin
 definition:=pg_get_functiondef('public.icash_begin_customer_phone_call(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb)'::regprocedure);
 before:=$old$if not exists(select 1 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id join public.icash_text_senders s on s.phone=t.sender and s.enabled where t.account_id=p_account and d.screening_id=p_screening and t.recipient=p_recipient and t.sender=p_sender and t.retired_at is null) then return jsonb_build_object('error','Open this contact’s text conversation to connect its business number.');end if;$old$;
 after:=$new$if p_sender is null or p_sender is distinct from public.icash_customer_call_sender(p_account,p_screening,p_recipient) then return jsonb_build_object('error','Your business calling number is unavailable. Please try again.');end if;$new$;
 if position(before in definition)=0 then raise exception 'Customer call sender precondition changed';end if;
 execute replace(definition,before,after);
end $patch$;
