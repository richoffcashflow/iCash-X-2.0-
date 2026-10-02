begin;
-- REVIEW CANDIDATE ONLY. Apply after the customer-funded reception bridge and
-- call-property-context.sql. No call admission, budget or provider setting changes.
-- Existing reception stays message_only. Opt-in requires a separately reviewed
-- branch with the exact application policy hash and an explicit approval ref.
alter table icash_reception_private.config
 add column context_policy text not null default 'message_only' check(context_policy in ('message_only','property_intake_v1')),
 add column context_policy_hash text check(context_policy_hash ~ '^[a-f0-9]{64}$'),
 add column context_approval_reference text check(length(btrim(context_approval_reference)) between 10 and 500),
 add constraint reception_property_context_review check(context_policy='message_only' or (
  context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60'
  and context_policy_hash is not null and context_approval_reference is not null));

create function public.icash_reception_property_context(p_call_sid text,p_nonce text,p_contact_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r icash_reception_private.receipts;matches jsonb;address text;bound_thread uuid;first_name text;
 checked_at timestamptz:=clock_timestamp();
begin
 if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
  or p_nonce is null or p_nonce !~ '^[a-f0-9]{64}$'
  or p_contact_key is null or p_contact_key !~ '^[a-f0-9]{64}$' then return null;end if;
 -- SECURITY DEFINER is required only because service_role cannot read reception's
 -- private receipts/config. EXECUTE is revoked from every public client below.
 -- No caller-supplied account or deal ID participates in the lookup.
 select receipt.* into r from icash_reception_private.receipts receipt
 join icash_reception_private.config c on c.id=1 and c.account_id=receipt.account_id
 join public.icash_accounts a on a.id=c.account_id and a.owner_user_id=c.owner_user_id
 join public.icash_operation_spend o on o.operation_key=receipt.operation_key and o.account_id=receipt.account_id
  and o.rate_id=receipt.rate_id and o.state='dispatched' and o.charge_cap_cents=receipt.customer_charge_cap_cents
 where receipt.call_sid=p_call_sid and receipt.receipt_nonce=p_nonce and receipt.state='reserved'
  and receipt.operation_key='reception:'||p_call_sid and receipt.conversation_id is null
  and receipt.reserved_at<=checked_at and receipt.reserved_at+make_interval(secs=>receipt.max_duration_seconds+120)>checked_at
  and receipt.config_hash=c.config_hash and receipt.agent_id=c.agent_id and receipt.called_number=c.called_number
  and receipt.branch_id=c.branch_id and receipt.reviewed_version_id=c.reviewed_version_id
  and receipt.call_profile=c.call_profile and receipt.rate_id=c.rate_id
  and receipt.max_duration_seconds=c.max_duration_seconds and receipt.customer_charge_cap_cents=c.customer_charge_cap_cents
  and c.enabled and c.reviewed_until>checked_at and c.approved_at<=checked_at
  and (not a.bot_paused or (c.allow_inbound_while_paused and c.inbound_pause_approval_reference is not null))
  and c.context_policy='property_intake_v1'
  and c.context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60'
  and length(btrim(c.context_approval_reference))>=10;
 if not found then return null;end if;
 if exists(select 1 from public.icash_contact_suppressions s where s.contact_key=p_contact_key) then return null;end if;

 -- The trusted signed-webhook handler computes SHA256(from), never from an LLM
 -- or client account selector. Reception's HMAC caller hash is a separate throttle
 -- key, not proof of identity. A match permits only a property/name confirmation.
 -- Count every matching live-deal invitation before permission filtering; revoked
 -- or expired alternatives must not make an otherwise ambiguous match look unique.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id as deal_id,t.id as thread_id,p.party,
   case when jsonb_typeof(d.terms->'address')='string' then d.terms->>'address' end as address,
   (p.revoked_at is null and p.permission_until>now() and not t.paused
    and not exists(select 1 from public.icash_property_controls ctrl where ctrl.account_id=d.account_id
     and ctrl.property_id=s.snapshot->>'propertyId' and ctrl.manual)) as permission_current
  from public.icash_contact_permissions p
  join public.icash_deal_files d on d.account_id=p.account_id and d.screening_id=p.screening_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party=p.party and t.recipient=p.phone
  where p.account_id=r.account_id and p.contact_key=p_contact_key
   and p.contact_key=encode(sha256(convert_to(p.phone,'UTF8')),'hex')
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=p.phone)
   and exists(select 1 from public.icash_text_messages sent where sent.account_id=p.account_id and sent.thread_id=t.id
    and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at between now()-interval '30 days' and now())
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'permission_current')::boolean is not true or matches->0->>'party'<>'seller' then return null;end if;
 address:=btrim(matches->0->>'address');
 if address is null or length(address) not between 1 and 300 then return null;end if;
 bound_thread:=(matches->0->>'thread_id')::uuid;
 select introduced.name into first_name from (
  select m.created_at,m.id,substring(m.body from '^(?:[Hh]i[, ]+|[Hh]ello[, ]+)?(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[.!]?(?:[[:space:]]|$))') as name
  from (select m.id,m.created_at,m.body from public.icash_text_messages m
   where m.account_id=r.account_id and m.thread_id=bound_thread and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '30 days' and now()
    and exists(select 1 from public.icash_text_messages sent where sent.account_id=r.account_id and sent.thread_id=m.thread_id
     and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at>=now()-interval '30 days' and sent.created_at<=m.created_at)
   order by m.created_at desc,m.id desc limit 12) m
 ) introduced where introduced.name is not null and lower(introduced.name) not in ('interested','owner','selling','ready','not','yes','no') order by introduced.created_at desc,introduced.id desc limit 1;
 return jsonb_strip_nulls(jsonb_build_object('status','matched','address',address,'returningName',first_name));
end $$;
revoke all on function public.icash_reception_property_context(text,text,text) from public,anon,authenticated;
grant execute on function public.icash_reception_property_context(text,text,text) to service_role;
commit;
