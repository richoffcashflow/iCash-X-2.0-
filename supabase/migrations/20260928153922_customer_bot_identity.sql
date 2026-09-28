create table public.icash_customer_identities (
 account_id uuid primary key references public.icash_accounts(id),
 first_name text not null check(length(btrim(first_name)) between 1 and 80),
 last_name text not null check(length(btrim(last_name)) between 1 and 80),
 company_name text not null default '' check(length(company_name)<=160),
 principal text generated always as (case when company_name<>'' then company_name else first_name||' '||last_name end) stored,
 voice_id text not null check(voice_id ~ '^[a-zA-Z0-9_-]+$'),
 voice_name text not null,
 updated_at timestamptz not null default now()
);
alter table public.icash_customer_identities enable row level security;
revoke all on public.icash_customer_identities from public,anon,authenticated;
grant select,insert,update on public.icash_customer_identities to service_role;
-- Only the authenticated server route may invoke this. p_user comes from validated Auth, never client JSON.
create function public.icash_save_customer_identity(p_user uuid,p_first text,p_last text,p_company text,p_voice text,p_voice_name text)
returns jsonb language plpgsql security invoker set search_path=public,pg_temp as $$
declare a uuid; result jsonb;
begin
 select id into a from public.icash_accounts where owner_user_id=p_user for update;
 if a is null then raise exception 'ACCOUNT_REQUIRED'; end if;
 if p_first is null or p_last is null or p_company is null or p_first ~ '[[:cntrl:]<>{}]' or p_last ~ '[[:cntrl:]<>{}]' or p_company ~ '[[:cntrl:]<>{}]' then raise exception 'INVALID_NAME'; end if;
 insert into public.icash_customer_identities(account_id,first_name,last_name,company_name,voice_id,voice_name)
 values(a,btrim(p_first),btrim(p_last),btrim(p_company),p_voice,p_voice_name)
 on conflict(account_id) do update set first_name=excluded.first_name,last_name=excluded.last_name,company_name=excluded.company_name,updated_at=now();
 -- Existing voice is intentionally preserved, including concurrent initial-save races.
 select jsonb_build_object('first_name',first_name,'last_name',last_name,'company_name',company_name,'principal',principal,'voice_id',voice_id,'voice_name',voice_name) into result from public.icash_customer_identities where account_id=a;
 return result;
end;
$$;
revoke all on function public.icash_save_customer_identity(uuid,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_save_customer_identity(uuid,text,text,text,text,text) to service_role;
