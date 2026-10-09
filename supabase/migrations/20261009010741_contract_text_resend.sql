-- A separate, explicitly authorized delivery retry. Never a new agreement or signature.
create table public.icash_contract_text_resends (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 envelope_id uuid not null references public.icash_signing_envelopes(id),
 signer_id text not null,
 original_message_id uuid not null references public.icash_text_messages(id),
 recipient text not null check(recipient ~ '^\+[1-9][0-9]{7,14}$'),
 expected_provider_id text not null check(expected_provider_id ~ '^[0-9]+$'),
 expected_submitter_id bigint not null check(expected_submitter_id>0),
 terms_hash text not null check(terms_hash ~ '^[a-f0-9]{64}$'),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 authorization_ref text not null check(length(authorization_ref)>20),
 expires_at timestamptz not null,
 state text not null default 'ready' check(state in ('ready','dispatching','accepted','needs_review')),
 error_code text,
 cost_micros bigint check(cost_micros>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(envelope_id,signer_id)
);
alter table public.icash_contract_text_resends enable row level security;
revoke all on public.icash_contract_text_resends from public,anon,authenticated;
grant all on public.icash_contract_text_resends to service_role;

create function public.icash_claim_contract_text_resend(p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.icash_contract_text_resends;
begin
 update public.icash_contract_text_resends r set state='dispatching',updated_at=now()
 where r.token_hash=p_hash and r.state='ready' and r.expires_at>now()
 and exists(
  select 1 from public.icash_signing_envelopes e
  join public.icash_contract_text_deliveries c on c.envelope_id=e.id and c.account_id=e.account_id
  join public.icash_text_messages m on m.id=c.message_id and m.account_id=e.account_id
  join public.icash_text_threads t on t.id=c.thread_id and t.account_id=e.account_id and t.deal_id=e.deal_id
  join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  where e.id=r.envelope_id and e.account_id=r.account_id and not e.test_mode
   and e.state='awaiting_counterparty' and e.provider_id=r.expected_provider_id and e.terms_hash=r.terms_hash
   and d.terms=e.terms and d.stage not in ('closed','cancelled','stopped')
   and c.signer_id=r.signer_id and c.message_id=r.original_message_id
   and m.provider_id is not null and m.state in ('accepted','delivered') and m.thread_id=t.id
   and t.recipient=r.recipient and t.party=case when e.kind='purchase' then 'seller' else 'buyer' end
   and public.icash_sms_thread_review_current(r.account_id,t.id,true)
   and exists(select 1 from jsonb_array_elements(e.recipients) s where s->>'id'=r.signer_id and s->>'phone'=r.recipient)
   and e.recipients->-1->>'id'<>r.signer_id
 )
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=r.recipient)
 returning * into j;
 if not found then return null;end if;
 return jsonb_build_object('id',j.id,'accountId',j.account_id,'envelopeId',j.envelope_id,'signerId',j.signer_id,
  'phone',j.recipient,'providerId',j.expected_provider_id,'submitterId',j.expected_submitter_id,'termsHash',j.terms_hash);
end $$;
revoke all on function public.icash_claim_contract_text_resend(text) from public,anon,authenticated;
grant execute on function public.icash_claim_contract_text_resend(text) to service_role;
