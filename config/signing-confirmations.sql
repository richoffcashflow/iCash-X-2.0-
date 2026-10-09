begin;
-- Signature receipts are created only from verified production provider evidence.
-- They use the existing text thread, delivery receipts and one-use send claim.
create table public.icash_signature_confirmation_texts(
 message_id uuid primary key references public.icash_text_messages(id),
 account_id uuid not null references public.icash_accounts(id),
 envelope_id uuid not null references public.icash_signing_envelopes(id),
 signer_id text not null,kind text not null check(kind in ('seller_signed','fully_signed')),
 terms_hash text not null,created_at timestamptz not null default now(),
 unique(envelope_id,signer_id,kind)
);
alter table public.icash_signature_confirmation_texts enable row level security;
revoke all on public.icash_signature_confirmation_texts from public,anon,authenticated;
grant select,insert on public.icash_signature_confirmation_texts to service_role;

create function public.icash_signature_confirmation_body(p_kind text,p_address text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare body text;street text:=public.icash_conversation_street(p_address);
begin
 if p_kind='seller_signed' then
  body:='Thanks, your signature for '||street||' is in. We will text you when everyone has signed.';
  if not public.icash_sms_single_segment(body) then body:='Thanks, your signature is in. We will text you when everyone has signed.';end if;
 elsif p_kind='fully_signed' then
  body:='All signatures are in for '||street||'. We will follow up about the next steps.';
  if not public.icash_sms_single_segment(body) then body:='All signatures are in on your agreement. We will follow up about the next steps.';end if;
 end if;
 return body;
end $$;

create function public.icash_signed_seller_evidence(p_account uuid,p_envelope uuid,p_signer text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_signing_envelopes e
  join public.icash_deal_files d on d.account_id=e.account_id and d.id=e.deal_id
  cross join lateral jsonb_array_elements(e.recipients) with ordinality r(value,position)
  where e.account_id=p_account and e.id=p_envelope and e.kind='purchase' and not e.test_mode
  and e.state in ('awaiting_counterparty','customer_signature_needed','completed') and e.provider_id is not null
  and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
  and d.terms->'address'=e.terms->'address' and d.terms->'priceCents'=e.terms->'priceCents'
  and e.provider_evidence->>'id'=e.provider_id::text and e.provider_evidence->'test_mode'='false'::jsonb
  and e.provider_evidence->'apply_signing_order'='true'::jsonb
  and e.provider_evidence->'metadata'->>'icash_envelope'=e.id::text
  and e.provider_evidence->'metadata'->>'terms_hash'=e.terms_hash
  and r.position<jsonb_array_length(e.recipients) and r.value->>'id'=p_signer
  and r.value->>'phone' ~ '^\+1[2-9][0-9]{9}$'
  and exists(select 1 from jsonb_array_elements(e.provider_evidence->'recipients') s
   where s->>'id'=p_signer and s->>'phone'=r.value->>'phone' and s->>'status'='signed'
   and (s->>'signing_order')::bigint=r.position)
  and (e.state<>'completed' or (lower(e.provider_evidence->>'status')='completed'
   and jsonb_array_length(e.provider_evidence->'recipients')=jsonb_array_length(e.recipients)
   and not exists(select 1 from jsonb_array_elements(e.provider_evidence->'recipients') s where s->>'status' is distinct from 'signed')))
 );
$$;

create function public.icash_queue_signature_confirmations(p_account uuid,p_envelope uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes;r jsonb;t public.icash_text_threads;mid uuid;event_kind text;queued integer:=0;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into e from public.icash_signing_envelopes where id=p_envelope and account_id=p_account for update;
 if not found or e.kind<>'purchase' or e.test_mode or e.state not in ('awaiting_counterparty','customer_signature_needed','completed') then return 0;end if;
 event_kind:=case when e.state='completed' then 'fully_signed' else 'seller_signed' end;
 for r in select value from jsonb_array_elements(e.recipients) loop
  if not public.icash_signed_seller_evidence(p_account,e.id,r->>'id') then continue;end if;
  if exists(select 1 from public.icash_signature_confirmation_texts where envelope_id=e.id and signer_id=r->>'id' and kind=event_kind) then continue;end if;
  if (select count(*) from public.icash_text_threads where account_id=p_account and deal_id=e.deal_id and party='seller' and recipient=r->>'phone' and retired_at is null)<>1 then continue;end if;
  select * into t from public.icash_text_threads where account_id=p_account and deal_id=e.deal_id and party='seller' and recipient=r->>'phone' and retired_at is null;
  if event_kind='fully_signed' then
   update public.icash_text_messages m set state='cancelled',updated_at=now()
   from public.icash_signature_confirmation_texts n where n.message_id=m.id and n.account_id=p_account
   and n.envelope_id=e.id and n.signer_id=r->>'id' and n.kind='seller_signed' and m.state='ready' and m.provider_id is null;
  end if;
  mid:=public.icash_queue_text(p_account,t.id,gen_random_uuid(),public.icash_signature_confirmation_body(event_kind,e.terms->>'address'),'{}'::uuid[]);
  insert into public.icash_signature_confirmation_texts(message_id,account_id,envelope_id,signer_id,kind,terms_hash)
   values(mid,p_account,e.id,r->>'id',event_kind,e.terms_hash);
  queued:=queued+1;
 end loop;
 return queued;
end $$;

create function public.icash_signature_confirmation_current(p_account uuid,p_message uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_signature_confirmation_texts n
 join public.icash_text_messages m on m.id=n.message_id and m.account_id=n.account_id
 join public.icash_text_threads t on t.id=m.thread_id and t.account_id=n.account_id
 join public.icash_signing_envelopes e on e.id=n.envelope_id and e.account_id=n.account_id
 where n.account_id=p_account and n.message_id=p_message and n.created_at>now()-interval '7 days'
 and e.terms_hash=n.terms_hash and t.deal_id=e.deal_id and t.party='seller' and t.retired_at is null
 and exists(select 1 from jsonb_array_elements(e.recipients) r where r->>'id'=n.signer_id and r->>'phone'=t.recipient)
 and public.icash_signed_seller_evidence(p_account,e.id,n.signer_id)
 and ((n.kind='fully_signed' and e.state='completed') or (n.kind='seller_signed' and e.state<>'completed'))
 and m.body=public.icash_signature_confirmation_body(n.kind,e.terms->>'address') and m.asset_ids='{}'::uuid[]
 );
$$;

alter function public.icash_save_signing_status(uuid,text,jsonb) rename to icash_save_signing_status_before_confirmations;
create function public.icash_save_signing_status(p_id uuid,p_state text,p_evidence jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform public.icash_save_signing_status_before_confirmations(p_id,p_state,p_evidence);
 select * into e from public.icash_signing_envelopes where id=p_id;
 perform public.icash_queue_signature_confirmations(e.account_id,e.id);
end $$;

alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_signature_confirmations;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_signature_confirmation_texts where message_id=p_message)
 and not public.icash_signature_confirmation_current(p_account,p_message) then return null;end if;
 return public.icash_claim_text_before_signature_confirmations(p_account,p_message,p_sender);
end $$;

alter function public.icash_next_automation() rename to icash_next_before_signature_confirmations;
create function public.icash_next_automation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare work record;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if found then
  select m.id,m.account_id into work from public.icash_signature_confirmation_texts n
  join public.icash_text_messages m on m.id=n.message_id and m.account_id=n.account_id
  join public.icash_accounts a on a.id=n.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>0
  where m.state='ready' and m.provider_id is null and m.last_delivery_at is null
  and public.icash_signature_confirmation_current(m.account_id,m.id)
  and public.icash_sms_thread_review_current(m.account_id,m.thread_id,true)
  and not exists(select 1 from public.icash_text_suppressions s join public.icash_text_threads t on t.recipient=s.phone where t.id=m.thread_id)
  and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id)
  and not exists(select 1 from public.icash_automation_tickets x where x.opener_message_id=m.id and (x.state='consumed' or (x.state='issued' and x.expires_at>now())))
  and (select count(*) from public.icash_automation_tickets x where x.opener_message_id=m.id)<3
  order by n.created_at,n.message_id limit 1;
  if found then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(work.account_id,'seller_opener',work.id) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
 end if;
 return public.icash_next_before_signature_confirmations();
end $$;

alter function public.icash_customer_update_sources(uuid) rename to icash_customer_update_sources_before_signatures;
create function public.icash_customer_update_sources(p_account uuid)
returns table(source_key text,kind text,screening_id uuid,event_at timestamptz,priority integer)
language sql stable security invoker set search_path='' as $$
 select source_key,case when source_key like 'attention:signature:%' then 'signature_needed' else kind end,
 screening_id,event_at,case when source_key like 'attention:signature:%' then -1 else priority end
 from public.icash_customer_update_sources_before_signatures(p_account);
$$;

revoke all on function public.icash_signature_confirmation_body(text,text),public.icash_signed_seller_evidence(uuid,uuid,text),public.icash_queue_signature_confirmations(uuid,uuid),public.icash_signature_confirmation_current(uuid,uuid),public.icash_save_signing_status(uuid,text,jsonb),public.icash_save_signing_status_before_confirmations(uuid,text,jsonb),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_signature_confirmations(uuid,uuid,text),public.icash_next_automation(),public.icash_next_before_signature_confirmations(),public.icash_customer_update_sources(uuid),public.icash_customer_update_sources_before_signatures(uuid) from public,anon,authenticated;
grant execute on function public.icash_signature_confirmation_body(text,text),public.icash_signed_seller_evidence(uuid,uuid,text),public.icash_queue_signature_confirmations(uuid,uuid),public.icash_signature_confirmation_current(uuid,uuid),public.icash_save_signing_status(uuid,text,jsonb),public.icash_claim_text(uuid,uuid,text),public.icash_next_automation(),public.icash_customer_update_sources(uuid) to service_role;
commit;
