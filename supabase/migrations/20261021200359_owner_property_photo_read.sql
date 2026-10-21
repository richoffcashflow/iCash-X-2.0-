begin;
-- Read already-fetched, property-bound CDN metadata. Expiry limits refreshes;
-- it does not invalidate these public image URLs. No leases or paid lookups.
create function public.icash_read_photo_cache(p_account uuid,p_screening uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select c.photo from icash_efficiency_private.photo_cache c
 join public.icash_screening_jobs s on s.id=c.screening_id and s.account_id=c.account_id
 where c.account_id=p_account and c.screening_id=p_screening and s.state='complete';
$$;
revoke all on function public.icash_read_photo_cache(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_read_photo_cache(uuid,uuid) to service_role;
commit;
