begin;
-- A phone-recovered buyer can subsequently prove their receipt email with an
-- ordinary Auth code. Eligibility to request that code never confirms the email.
create or replace function public.icash_can_sign_in(p_email text,p_mode text) returns boolean
language sql stable security invoker set search_path='' as $$
 select p_mode in ('live','test') and (
 exists(select 1 from public.icash_funding_orders where lower(payer_email)=lower(trim(p_email)) and state='paid' and mode=p_mode)
 or exists(select 1 from public.icash_memberships where lower(payer_email)=lower(trim(p_email)) and mode=p_mode and state='active' and paid_through>now() and account_id is null)
 or exists(select 1 from auth.users u join public.icash_accounts a on a.owner_user_id=u.id where lower(u.email)=lower(trim(p_email)) and u.email_confirmed_at is not null)
 or exists(select 1 from public.icash_purchase_phone_identities identity
  join auth.users u on u.id=identity.user_id and lower(u.email)=identity.email
  join public.icash_accounts a on a.owner_user_id=u.id
  join public.icash_memberships m on m.id=identity.membership_id and m.account_id=a.id and m.mode=p_mode
  where identity.email=lower(trim(p_email)) and identity.revoked_at is null
  and identity.phone=public.icash_access_phone(m.payer_phone) and lower(trim(m.payer_email))=identity.email
  and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now()))
 );
$$;
revoke all on function public.icash_can_sign_in(text,text) from public,anon,authenticated;
grant execute on function public.icash_can_sign_in(text,text) to service_role;
commit;
