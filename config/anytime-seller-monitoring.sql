begin;
set local lock_timeout='5s';
-- Inbound seller contact no longer waits for clock hours. Keep the old
-- predicate callable during rolling releases, but never hide a missing SMS
-- behind the retired schedule. Explicit future call appointments are separate.
create or replace function public.icash_seller_sms_waiting_window(p_account uuid,p_screening uuid,p_phone text)
returns boolean language sql stable security invoker set search_path='' as $$select false$$;
revoke all on function public.icash_seller_sms_waiting_window(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_sms_waiting_window(uuid,uuid,text) to service_role;
commit;
