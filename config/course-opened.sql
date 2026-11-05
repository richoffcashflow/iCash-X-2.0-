-- Course discovery is an account preference, never evidence of watching or consent.
alter table public.icash_workspace_walkthroughs add column course_opened_at timestamptz;

create function public.icash_mark_course_opened(p_account uuid,p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then
  raise exception 'Account owner required';
 end if;
 insert into public.icash_workspace_walkthroughs(account_id,version,step,state,course_opened_at)
 values(p_account,1,0,'available',now())
 on conflict(account_id,version) do update
 set course_opened_at=excluded.course_opened_at
 where public.icash_workspace_walkthroughs.course_opened_at is null;
end $$;
revoke all on function public.icash_mark_course_opened(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_mark_course_opened(uuid,uuid) to service_role;
