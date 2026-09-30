create or replace function public.icash_can_sign_in(p_email text,p_mode text) returns boolean
language sql stable set search_path='' as $$
 select p_mode in ('live','test') and (
 exists(select 1 from public.icash_funding_orders where lower(payer_email)=lower(trim(p_email)) and state='paid' and mode=p_mode)
 or exists(select 1 from auth.users u join public.icash_accounts a on a.owner_user_id=u.id where lower(u.email)=lower(trim(p_email)) and u.email_confirmed_at is not null)
 );
$$;
revoke all on function public.icash_can_sign_in(text,text) from public,anon,authenticated;
grant execute on function public.icash_can_sign_in(text,text) to service_role;
