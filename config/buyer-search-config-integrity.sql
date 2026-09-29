create function public.icash_buyer_search_config_revision() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'enabled'-'revision') is distinct from (to_jsonb(old)-'enabled'-'revision') and new.revision=old.revision then raise exception 'New buyer search revision required';end if;
 return new;
end $$;
revoke all on function public.icash_buyer_search_config_revision() from public,anon,authenticated;
create trigger icash_buyer_search_config_revision before update on public.icash_buyer_search_configs for each row execute function public.icash_buyer_search_config_revision();
