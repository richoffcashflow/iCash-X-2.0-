
create function public.icash_create_account(p_user uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; names text[]:=array['Alex','Jordan','Morgan','Taylor','Casey','Riley','Avery','Jamie'];
begin
 if p_user is null or not exists(select 1 from auth.users where id=p_user) then raise exception 'Verified auth user required'; end if;
 insert into public.icash_accounts(owner_user_id,assistant_name)
 values(p_user,names[1+floor(random()*array_length(names,1))::integer])
 on conflict(owner_user_id) do nothing;
 select id into result from public.icash_accounts where owner_user_id=p_user;
 insert into public.icash_wallets(account_id) values(result) on conflict do nothing;
 insert into public.icash_notification_preferences(account_id) values(result) on conflict do nothing;
 return result;
end; $$;
revoke all on function public.icash_create_account(uuid) from public,anon,authenticated;
grant execute on function public.icash_create_account(uuid) to service_role;
