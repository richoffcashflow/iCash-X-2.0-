create table public.icash_signing_templates (
 id uuid primary key default gen_random_uuid(),state_code text not null check(state_code ~ '^[A-Z]{2}$'),
 kind text not null check(kind in ('purchase','assignment')),signer_count integer not null check(signer_count between 1 and 8),
 provider_template_id uuid not null,placeholder_names jsonb not null,field_map jsonb not null,
 reviewed_until timestamptz not null,review_reference text not null check(length(review_reference)>3),
 test_mode boolean not null default true,enabled boolean not null default false,rate_id uuid references public.icash_operation_rates(id),
 unique(state_code,kind,signer_count,test_mode),check(jsonb_array_length(placeholder_names)=signer_count+1)
);
create table public.icash_signing_envelopes (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),kind text not null check(kind in ('purchase','assignment')),
 template_id uuid not null references public.icash_signing_templates(id),terms jsonb not null,terms_hash text not null check(terms_hash ~ '^[a-f0-9]{64}$'),
 recipients jsonb not null,test_mode boolean not null,consent_version text not null,requested_by uuid not null,
 provider_id uuid unique,state text not null default 'creating' check(state in ('creating','awaiting_counterparty','customer_signature_needed','completed','test_completed','needs_review')),
 provider_status text,provider_evidence jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 next_poll_at timestamptz not null default now()+interval '2 minutes',last_poll_at timestamptz,
 unique(deal_id,kind,test_mode)
);
create index icash_signing_account on public.icash_signing_envelopes(account_id,deal_id);
create index icash_signing_due on public.icash_signing_envelopes(next_poll_at) where state in ('awaiting_counterparty','customer_signature_needed');
alter table public.icash_signing_templates enable row level security;
alter table public.icash_signing_envelopes enable row level security;
revoke all on public.icash_signing_templates,public.icash_signing_envelopes from public,anon,authenticated;
grant all on public.icash_signing_templates,public.icash_signing_envelopes to service_role;
create function public.icash_begin_signing(p_user uuid,p_account uuid,p_deal uuid,p_kind text,p_template uuid,p_hash text,p_recipients jsonb) returns public.icash_signing_envelopes
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files; t public.icash_signing_templates; e public.icash_signing_envelopes;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 select * into strict t from public.icash_signing_templates where id=p_template and enabled and reviewed_until>now() and kind=p_kind and state_code=d.terms->>'state';
 if t.signer_count+1<>jsonb_array_length(p_recipients) then raise exception 'All signers required';end if;
 if p_kind='purchase' and d.stage<>'draft' then raise exception 'Purchase already executed';end if;
 if p_kind='assignment' and (d.seller_signed_at is null or d.stage not in ('under_contract','buyer_selected')) then raise exception 'Executed purchase required';end if;
 insert into public.icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by)
 values(p_account,p_deal,p_kind,p_template,d.terms,p_hash,p_recipients,t.test_mode,'2026-09-28-signing-1',p_user) returning * into e;
 return e;
end $$;
create function public.icash_lock_sent_terms() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.terms is distinct from old.terms and exists(select 1 from public.icash_signing_envelopes where deal_id=old.id and not test_mode) then raise exception 'Contract terms frozen; amendment required';end if;
 return new;
end $$;
create trigger icash_freeze_sent_terms before update on public.icash_deal_files for each row execute function public.icash_lock_sent_terms();
create function public.icash_save_signing_status(p_id uuid,p_state text,p_evidence jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes;
begin
 select * into strict e from public.icash_signing_envelopes where id=p_id for update;
 if p_state not in ('awaiting_counterparty','customer_signature_needed','completed','test_completed','needs_review') or p_evidence->>'id' is distinct from e.provider_id::text or (p_evidence->>'test_mode')::boolean is distinct from e.test_mode then raise exception 'Invalid signature receipt';end if;
 if e.state in ('completed','test_completed') then return;end if;
 if p_state='completed' and (e.test_mode or lower(p_evidence->>'status') is distinct from 'completed') then raise exception 'Real signatures required';end if;
 update public.icash_signing_envelopes set state=p_state,provider_evidence=p_evidence,provider_status=p_evidence->>'status',updated_at=now() where id=e.id;
 if p_state='completed' then
  if e.kind='purchase' then
   update public.icash_deal_files set stage='under_contract',seller_signed_at=now(),updated_at=now() where id=e.deal_id and account_id=e.account_id and stage='draft' and terms=e.terms;
  else
   update public.icash_deal_files set stage='buyer_selected',assignment_signed_at=now(),updated_at=now() where id=e.deal_id and account_id=e.account_id and stage='under_contract' and terms=e.terms;
  end if;
 end if;
end $$;
revoke all on function public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb),public.icash_lock_sent_terms(),public.icash_save_signing_status(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb),public.icash_lock_sent_terms(),public.icash_save_signing_status(uuid,text,jsonb) to service_role;
create function public.icash_claim_signing_poll(p_account uuid,p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_signing_envelopes set last_poll_at=now(),next_poll_at=now()+interval '10 minutes' where id=p_id and account_id=p_account and provider_id is not null and (last_poll_at is null or last_poll_at<now()-interval '1 minute');
 return found;
end $$;
revoke all on function public.icash_claim_signing_poll(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_signing_poll(uuid,uuid) to service_role;
-- Purchase terms cannot change after dispatch. Assignment details remain editable only after purchase completion.
create or replace function public.icash_lock_sent_terms() returns trigger
language plpgsql security invoker set search_path='' as $$
declare mutable text[]:=array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle'];
begin
 if new.terms is distinct from old.terms and exists(select 1 from public.icash_signing_envelopes where deal_id=old.id and not test_mode) then
  if old.stage<>'under_contract' or new.terms-mutable is distinct from old.terms-mutable or exists(select 1 from public.icash_signing_envelopes where deal_id=old.id and kind='assignment' and not test_mode) then raise exception 'Contract terms frozen; amendment required';end if;
 end if;
 return new;
end $$;
create or replace function public.icash_prepare_deal(p_account uuid,p_screening uuid,p_terms jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 if not exists(select 1 from public.icash_screening_jobs where id=p_screening and account_id=p_account and state='complete') then raise exception 'Account property missing';end if;
 insert into public.icash_deal_files(account_id,screening_id,terms) values(p_account,p_screening,p_terms)
 on conflict(account_id,screening_id) do update set terms=excluded.terms,updated_at=now()
 where icash_deal_files.stage='draft' or (icash_deal_files.stage='under_contract' and icash_deal_files.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle']=excluded.terms-array['assignee','assignmentFeeCents','assignmentDepositCents','payoutMethod','payoutHandle'])
 returning id into result;
 if result is null then raise exception 'Executed purchase terms require amendment';end if;return result;
end $$;
-- Reuse the private worker ticket path; no public webhook can assert a signature.
alter function public.icash_next_automation() rename to icash_next_before_signing;
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result','signing_result'));
alter table public.icash_automation_tickets add column signing_id uuid references public.icash_signing_envelopes(id);
create function public.icash_next_automation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes; t public.icash_automation_tickets;
begin
 select * into e from public.icash_signing_envelopes where state in ('awaiting_counterparty','customer_signature_needed') and provider_id is not null and next_poll_at<=now() and created_at>now()-interval '45 days' order by next_poll_at for update skip locked limit 1;
 if found then
  update public.icash_signing_envelopes set next_poll_at=now()+interval '10 minutes' where id=e.id;
  insert into public.icash_automation_tickets(account_id,kind,signing_id) values(e.account_id,'signing_result',e.id) returning * into t;
  return jsonb_build_object('token',t.token);
 end if;
 return public.icash_next_before_signing();
end $$;
create or replace function public.icash_consume_automation(p_token text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id,'liveCallId',t.live_call_id,'signingId',t.signing_id);
end $$;
revoke all on function public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_next_automation() to service_role;
