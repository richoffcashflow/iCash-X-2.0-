begin;
-- New drafts only. Issued/signed terms and payment evidence are never rewritten.
create function public.icash_buyer_deposit_cents(p_fee bigint) returns bigint
language sql immutable security invoker set search_path='' as $$
 select case when p_fee between 0 and 100000000000 then least(round(p_fee::numeric/5)::bigint,500000) end
$$;
create function public.icash_check_buyer_assignment_deposit() returns trigger
language plpgsql security invoker set search_path='' as $$
declare required bigint;
begin
 if new.kind<>'assignment' or new.test_mode then return new;end if;
 required:=public.icash_buyer_deposit_cents((new.terms->>'assignmentFeeCents')::bigint);
 if required is null or required<=0 or (new.terms->>'assignmentDepositCents')::bigint is distinct from required then raise exception 'Save the calculated buyer deposit before preparing an assignment';end if;
 return new;
end $$;
create trigger icash_buyer_deposit_on_assignment before insert on public.icash_signing_envelopes for each row execute function public.icash_check_buyer_assignment_deposit();

-- Fulfillment reads the saved assignment-only deposit for draft buyer/title
-- documents. The executed purchase envelope and any issued assignment are intact.
alter function public.icash_prepare_buyer_disposition(uuid,uuid) rename to icash_prepare_disposition_before_deposit;
create function public.icash_prepare_buyer_disposition(p_account uuid,p_deal uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare prepared boolean;
begin
 prepared:=public.icash_prepare_disposition_before_deposit(p_account,p_deal);
 if prepared then
  update public.icash_deal_files d set terms=jsonb_set(d.terms,'{assignmentDepositCents}',to_jsonb(public.icash_buyer_deposit_cents((d.terms->>'assignmentFeeCents')::bigint)))
  where d.account_id=p_account and d.id=p_deal and d.stage in ('under_contract','title_open','closing')
  and public.icash_buyer_deposit_cents((d.terms->>'assignmentFeeCents')::bigint) is not null
  and not exists(select 1 from public.icash_signing_envelopes e where e.account_id=p_account and e.deal_id=d.id and e.kind='assignment' and not e.test_mode);
 end if;
 return prepared;
end $$;
revoke all on function public.icash_prepare_buyer_disposition(uuid,uuid),public.icash_prepare_disposition_before_deposit(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_prepare_buyer_disposition(uuid,uuid) to service_role;

create table public.icash_buyer_deposit_receipts(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null unique references public.icash_deal_files(id),envelope_id uuid not null references public.icash_signing_envelopes(id),
 terms_hash text not null,amount_cents bigint not null check(amount_cents between 1 and 500000),
 method text not null check(method in ('check','wire','cash_app','zelle','verified_closer')),
 reference text not null check(length(btrim(reference)) between 3 and 120),
 confirmed_by uuid not null references auth.users(id),request_key uuid not null,created_at timestamptz not null default now(),
 unique(account_id,request_key)
);
alter table public.icash_buyer_deposit_receipts enable row level security;
revoke all on public.icash_buyer_deposit_receipts from public,anon,authenticated,service_role;
grant select on public.icash_buyer_deposit_receipts to service_role;
create function public.icash_buyer_is_reserved(p_account uuid,p_deal uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_buyer_deposit_receipts where account_id=p_account and deal_id=p_deal)
$$;

create function public.icash_confirm_buyer_deposit(p_account uuid,p_actor uuid,p_deal uuid,p_envelope uuid,p_key uuid,p_amount bigint,p_method text,p_reference text,p_cleared boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.icash_deal_files;e public.icash_signing_envelopes;old public.icash_buyer_deposit_receipts;receipt uuid;required bigint;
begin
 -- Serialize with final send claims: no new package dispatch after reservation.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Account owner required';end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found then raise exception 'Owned deal required';end if;
 select * into old from public.icash_buyer_deposit_receipts where account_id=p_account and request_key=p_key;
 if found then
  if row(old.deal_id,old.envelope_id,old.amount_cents,old.method,old.reference,old.confirmed_by) is distinct from row(p_deal,p_envelope,p_amount,p_method,btrim(p_reference),p_actor) or p_cleared is distinct from true then raise exception 'Receipt key conflict';end if;
  return old.id;
 end if;
 if public.icash_buyer_is_reserved(p_account,p_deal) then raise exception 'This property is already reserved';end if;
 if d.stage not in ('under_contract','buyer_selected','title_open','closing') or coalesce(d.terms->>'practice','false')='true'
 or not exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode) then raise exception 'Signed purchase required';end if;
 select * into e from public.icash_signing_envelopes where id=p_envelope and account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed' and not test_mode and provider_id is not null and terms=d.terms;
 if not found or coalesce(e.terms_hash,'')='' or coalesce(e.terms->>'assignee','')='' then raise exception 'Current signed buyer assignment required';end if;
 if (select count(*) from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed' and not test_mode)<>1 then raise exception 'Assignment identity needs review';end if;
 required:=(e.terms->>'assignmentDepositCents')::bigint;
 if required is null or required not between 1 and 500000 or p_amount is distinct from required then raise exception 'Confirm the exact signed deposit, up to $5,000';end if;
 if p_cleared is distinct from true or p_key is null or p_method is null or p_method not in ('check','wire','cash_app','zelle') or p_reference is null or length(btrim(p_reference)) not between 3 and 120 then raise exception 'Cleared funds, payment method and receipt reference required';end if;
 insert into public.icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,terms_hash,amount_cents,method,reference,confirmed_by,request_key)
 values(p_account,p_deal,e.id,e.terms_hash,p_amount,p_method,btrim(p_reference),p_actor,p_key) returning id into receipt;
 return receipt;
end $$;

-- Existing verified closer confirmations also reserve the exact signed deal.
-- No title milestones are manufactured for a direct-to-assignor receipt.
create function public.icash_reserve_from_closing_deposit() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.icash_signing_envelopes;
begin
 if new.kind<>'deposit_received' or new.amount_cents not between 1 and 500000 then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_deal_files where id=new.deal_id and account_id=new.account_id for update;
 select a.* into e from public.icash_signing_envelopes a join public.icash_deal_files d on d.id=a.deal_id and d.account_id=a.account_id and d.terms=a.terms
 where a.deal_id=new.deal_id and a.account_id=new.account_id and a.kind='assignment' and a.state='completed' and not a.test_mode and a.provider_id is not null
 and (a.terms->>'assignmentDepositCents')::bigint=new.amount_cents;
 if not found or (select count(*) from public.icash_signing_envelopes where account_id=new.account_id and deal_id=new.deal_id and kind='assignment' and state='completed' and not test_mode)<>1 then return new;end if;
 insert into public.icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,terms_hash,amount_cents,method,reference,confirmed_by,request_key)
 values(new.account_id,new.deal_id,e.id,e.terms_hash,new.amount_cents,'verified_closer','Closing confirmation '||new.id,new.confirmed_by,new.id) on conflict do nothing;
 return new;
end $$;
create trigger buyer_reserve_closing_deposit after insert on public.icash_closing_updates for each row execute function public.icash_reserve_from_closing_deposit();

alter function public.icash_buyer_package_data(uuid,uuid) rename to icash_buyer_package_before_purchase_terms;
create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare package jsonb;deposit bigint;issued jsonb;
begin
 package:=public.icash_buyer_package_before_purchase_terms(p_account,p_deal);if package is null then return null;end if;
 select terms into issued from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='assignment' and not test_mode and state not in ('failed','declined','cancelled') order by created_at desc,id desc limit 1;
 if issued is not null then deposit:=(issued->>'assignmentDepositCents')::bigint;
 else deposit:=public.icash_buyer_deposit_cents((package->>'assignmentFeeCents')::bigint);end if;
 return package||jsonb_build_object('depositCents',case when deposit between 1 and 500000 then deposit end,'depositPolicy',case when issued is null then 'capped_assignment_v1' else 'issued_agreement' end,'viewingOptional',true,'reserved',public.icash_buyer_is_reserved(p_account,p_deal));
end $$;

-- Hold marketing, including queued package sends; keep signed-buyer/title
-- transaction communication available under its existing permission checks.
alter function public.icash_buyer_package_text_targets(uuid,uuid) rename to icash_buyer_text_targets_before_reservation;
create function public.icash_buyer_package_text_targets(p_account uuid,p_deal uuid) returns table(id uuid)
language sql stable security invoker set search_path='' as $$select t.id from public.icash_buyer_text_targets_before_reservation(p_account,p_deal) t where not public.icash_buyer_is_reserved(p_account,p_deal)$$;
alter function public.icash_queue_buyer_package_text(uuid,uuid,text) rename to icash_queue_buyer_text_before_reservation;
create function public.icash_queue_buyer_package_text(p_account uuid,p_thread uuid,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_text_threads where id=p_thread and account_id=p_account and public.icash_buyer_is_reserved(p_account,deal_id)) then return null;end if;
 return public.icash_queue_buyer_text_before_reservation(p_account,p_thread,p_body);
end $$;
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_reservation;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_buyer_package_texts b join public.icash_text_messages m on m.id=b.message_id join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id where m.id=p_message and m.account_id=p_account and public.icash_buyer_is_reserved(p_account,t.deal_id)) then return null;end if;
 return public.icash_claim_text_before_reservation(p_account,p_message,p_sender);
end $$;
alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_email_before_reservation;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_deal_emails where id=p_id and account_id=p_account and contact_key like 'buyer-request:%' and public.icash_buyer_is_reserved(p_account,deal_id)) then return null;end if;
 return public.icash_claim_email_before_reservation(p_account,p_id);
end $$;

alter function public.icash_deal_email_contacts(uuid,uuid) rename to icash_email_contacts_before_reservation;
create function public.icash_deal_email_contacts(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz)
language sql stable security invoker set search_path='' as $$
 select c.* from public.icash_email_contacts_before_reservation(p_account,p_deal) c
 where c.contact_key not like 'buyer-request:%' or not public.icash_buyer_is_reserved(p_account,p_deal)
$$;
alter function public.icash_claim_buyer_search(uuid,uuid,uuid,text) rename to icash_claim_buyer_search_before_reservation;
create function public.icash_claim_buyer_search(p_account uuid,p_deal uuid,p_revision uuid,p_operation text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if public.icash_buyer_is_reserved(p_account,p_deal) then return false;end if;
 return public.icash_claim_buyer_search_before_reservation(p_account,p_deal,p_revision,p_operation);
end $$;
revoke all on function public.icash_deal_email_contacts(uuid,uuid),public.icash_email_contacts_before_reservation(uuid,uuid),public.icash_claim_buyer_search(uuid,uuid,uuid,text),public.icash_claim_buyer_search_before_reservation(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_deal_email_contacts(uuid,uuid),public.icash_claim_buyer_search(uuid,uuid,uuid,text) to service_role;

revoke all on function public.icash_check_buyer_assignment_deposit(),public.icash_reserve_from_closing_deposit() from public,anon,authenticated,service_role;
revoke all on function public.icash_buyer_deposit_cents(bigint),public.icash_buyer_is_reserved(uuid,uuid),public.icash_confirm_buyer_deposit(uuid,uuid,uuid,uuid,uuid,bigint,text,text,boolean),public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_purchase_terms(uuid,uuid),public.icash_buyer_package_text_targets(uuid,uuid),public.icash_buyer_text_targets_before_reservation(uuid,uuid),public.icash_queue_buyer_package_text(uuid,uuid,text),public.icash_queue_buyer_text_before_reservation(uuid,uuid,text),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_reservation(uuid,uuid,text),public.icash_claim_deal_email(uuid,uuid),public.icash_claim_email_before_reservation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_deposit_cents(bigint),public.icash_buyer_is_reserved(uuid,uuid),public.icash_confirm_buyer_deposit(uuid,uuid,uuid,uuid,uuid,bigint,text,text,boolean),public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_text_targets(uuid,uuid),public.icash_queue_buyer_package_text(uuid,uuid,text),public.icash_claim_text(uuid,uuid,text),public.icash_claim_deal_email(uuid,uuid) to service_role;
commit;
