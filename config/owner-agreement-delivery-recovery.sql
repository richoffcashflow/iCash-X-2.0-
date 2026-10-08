begin;
-- Explicit owner requests for unsigned agreements only. This queue never
-- asserts seller confirmations, fabricates an active call, or signs a document.
create table icash_seller_agreement_private.delivery_recovery(
 id uuid primary key default gen_random_uuid(),request_key text unique not null,
 account_id uuid not null,requested_by uuid not null,deal_id uuid not null,
 phone text not null,seller_name text not null,expected_terms jsonb not null,
 authorization_reference text not null check(length(authorization_reference) between 20 and 1000),
 state text not null default 'queued' check(state in ('queued','claimed','sent','needs_review')),
 expires_at timestamptz not null,created_at timestamptz not null default now(),
 claimed_at timestamptz,envelope_id uuid,result jsonb
);
alter table icash_seller_agreement_private.delivery_recovery enable row level security;
revoke all on icash_seller_agreement_private.delivery_recovery from public,anon,authenticated,service_role;
create function public.icash_claim_agreement_delivery_recovery() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r icash_seller_agreement_private.delivery_recovery;email text;
begin
 select j.* into r from icash_seller_agreement_private.delivery_recovery j
 join public.icash_accounts a on a.id=j.account_id and a.owner_user_id=j.requested_by and not a.bot_paused
 join public.icash_deal_files d on d.id=j.deal_id and d.account_id=j.account_id and d.stage='draft' and d.terms=j.expected_terms and d.terms->>'seller'=j.seller_name
 join auth.users u on u.id=j.requested_by and u.email is not null and u.email_confirmed_at is not null
 where j.state='queued' and j.expires_at>now() and public.icash_membership_work_allowed(j.account_id)
 and exists(select 1 from public.icash_text_threads t where t.account_id=j.account_id and t.deal_id=j.deal_id and t.recipient=j.phone and t.party='seller' and public.icash_sms_thread_review_current(j.account_id,t.id,true))
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=j.phone)
 order by j.created_at for update of j skip locked limit 1;
 if not found then return null;end if;
 select u.email into email from auth.users u where u.id=r.requested_by;
 update icash_seller_agreement_private.delivery_recovery set state='claimed',claimed_at=now() where id=r.id;
 return jsonb_build_object('id',r.id,'accountId',r.account_id,'userId',r.requested_by,'customerEmail',email,'dealId',r.deal_id,'phone',r.phone,'sellerName',r.seller_name,'expectedTerms',r.expected_terms);
end $$;
create function public.icash_finish_agreement_delivery_recovery(p_id uuid,p_envelope uuid,p_result jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 update icash_seller_agreement_private.delivery_recovery set envelope_id=p_envelope,result=p_result,state=case when p_result->'sent'='true'::jsonb then 'sent' else 'needs_review' end where id=p_id and state='claimed';
 return found;
end $$;
revoke all on function public.icash_claim_agreement_delivery_recovery(),public.icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_agreement_delivery_recovery(),public.icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb) to service_role;
commit;
