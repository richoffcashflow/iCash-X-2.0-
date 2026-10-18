begin;
set local lock_timeout='5s';
set local statement_timeout='15s';

-- Vault is already installed. Both helpers keep the caller's existing privileges;
-- service_role already has Vault access, while browser roles have neither.
create function public.icash_seller_meta_access() returns text
language sql stable security invoker set search_path='' as $$
 select decrypted_secret from vault.decrypted_secrets where name='icash_seller_meta_ads_read_v1';
$$;

create function public.icash_save_seller_meta_access(p_actor uuid,p_token text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare secret_id uuid;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required';end if;
 if p_token is null or length(p_token) not between 20 and 4096 or p_token !~ '^[A-Za-z0-9._|\-]+$' then raise exception 'Valid Meta token required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('icash_seller_meta_ads_read_v1',0));
 select id into secret_id from vault.secrets where name='icash_seller_meta_ads_read_v1';
 if secret_id is null then
  perform vault.create_secret(p_token,'icash_seller_meta_ads_read_v1','Owner-saved read access for lead acquisition costs');
 else
  perform vault.update_secret(secret_id,p_token);
 end if;
 return true;
end;
$$;

revoke all on function public.icash_seller_meta_access(),public.icash_save_seller_meta_access(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_meta_access(),public.icash_save_seller_meta_access(uuid,text) to service_role;
commit;
