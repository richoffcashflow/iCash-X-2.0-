create function public.icash_provision_after_funding() returns trigger language plpgsql set search_path='' as $$
begin
 if new.account_id is not null and new.mode='live' and new.state='paid' and new.credited_at is not null then
 begin
 perform public.icash_provision_funded_account(new.account_id);
 exception when others then
 -- Keep a confirmed payment credited; the authenticated account load retries provisioning.
 raise warning 'Funded account provisioning deferred';
 end;
 end if;
 return new;
end $$;
revoke all on function public.icash_provision_after_funding() from public,anon,authenticated;
create trigger icash_provision_after_funding after insert or update of account_id,state,credited_at on public.icash_funding_orders for each row execute function public.icash_provision_after_funding();
