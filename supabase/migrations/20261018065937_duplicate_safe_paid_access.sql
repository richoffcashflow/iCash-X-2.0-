begin;
-- Reserve one checkout per email across browser cookies. Email is not authentication:
-- this routine returns only a boolean, never another buyer's checkout or account.
alter table public.icash_memberships add column checkout_email text;
alter table public.icash_memberships add column checkout_email_reserved_until timestamptz;
create index icash_membership_checkout_email on public.icash_memberships(lower(checkout_email),mode) where state<>'cancelled';
create function public.icash_reserve_membership_email(p_membership uuid,p_email text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships; email_address text:=lower(trim(p_email));
begin
 if email_address is null or length(email_address)>254 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then raise exception 'Payment email required';end if;
 select * into m from public.icash_memberships where id=p_membership;
 if not found or m.state<>'pending' then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended('membership-email:'||m.mode||':'||email_address,0));
 select * into m from public.icash_memberships where id=p_membership for update;
 if m.state<>'pending' or (m.checkout_email is not null and m.checkout_email is distinct from email_address) then return false;end if;
 if exists(select 1 from public.icash_memberships other where other.id<>m.id and other.mode=m.mode and other.state<>'cancelled'
  and (lower(other.payer_email)=email_address or other.checkout_email=email_address)
  and ((other.paid_through>now() and other.state in ('active','cancel_requested','needs_review'))
   or (other.state='pending' and other.checkout_email_reserved_until>now()))) then return false;end if;
 update public.icash_memberships set checkout_email=email_address,
 checkout_email_reserved_until=case when checkout_email=email_address and checkout_email_reserved_until>now() then checkout_email_reserved_until else now()+interval '25 hours' end where id=m.id;
 return true;
end $$;
revoke all on function public.icash_reserve_membership_email(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_reserve_membership_email(uuid,text) to service_role;

-- Duplicate purchases must never roll back an otherwise verified sign-in.
-- Retain the account's current membership, or bind one paid entitlement; preserve
-- additional purchase records for reconciliation without cancelling or refunding them.
do $$
declare definition text; previous text:='update public.icash_memberships set account_id=a where lower(payer_email)=email_address and mode=p_mode and account_id is null and paid_through is not null;';
begin
 select pg_get_functiondef('public.icash_claim_funding(uuid,text)'::regprocedure) into definition;
 if position(previous in definition)=0 then raise exception 'Membership claim definition changed';end if;
 definition:=replace(definition,previous,$replacement$
 update public.icash_memberships set account_id=a
 where lower(payer_email)=email_address and mode=p_mode and account_id is null and paid_through is not null
 and (state='cancelled' or id=(
  select candidate.id from public.icash_memberships candidate
  where lower(candidate.payer_email)=email_address and candidate.mode=p_mode and candidate.account_id is null
   and candidate.paid_through is not null and candidate.state<>'cancelled'
   and not exists(select 1 from public.icash_memberships linked where linked.account_id=a and linked.mode=p_mode and linked.state<>'cancelled')
  order by (candidate.state='active' and candidate.paid_through>now()) desc,candidate.created_at,candidate.id limit 1
 ));
 $replacement$);
 execute definition;
end $$;
commit;
