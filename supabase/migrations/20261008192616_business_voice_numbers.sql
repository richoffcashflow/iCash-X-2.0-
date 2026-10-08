begin;
create table public.icash_business_voice_numbers (
 phone text primary key check(phone='+14244377030'),
 provider_account_sid text not null check(provider_account_sid ~ '^AC[0-9a-fA-F]{32}$'),
 caller_id_sid text check(caller_id_sid ~ '^PN[0-9a-fA-F]{32}$'),
 forwarding_ready boolean not null default false,
 outbound_enabled boolean not null default false,
 verified_at timestamptz not null default now(),
 check(not outbound_enabled or (caller_id_sid is not null and forwarding_ready))
);
alter table public.icash_business_voice_numbers enable row level security;
revoke all on public.icash_business_voice_numbers from public,anon,authenticated;
grant select,insert,update on public.icash_business_voice_numbers to service_role;
create function public.icash_save_business_voice_number(p_account_sid text,p_caller_id_sid text,p_forwarding boolean,p_enabled boolean) returns void language sql security invoker set search_path='' as $$
 insert into public.icash_business_voice_numbers(phone,provider_account_sid,caller_id_sid,forwarding_ready,outbound_enabled)
 values('+14244377030',p_account_sid,p_caller_id_sid,p_forwarding,p_enabled)
 on conflict(phone) do update set provider_account_sid=excluded.provider_account_sid,caller_id_sid=excluded.caller_id_sid,forwarding_ready=excluded.forwarding_ready,outbound_enabled=excluded.outbound_enabled,verified_at=now();
$$;
revoke all on function public.icash_save_business_voice_number(text,text,boolean,boolean) from public,anon,authenticated;
grant execute on function public.icash_save_business_voice_number(text,text,boolean,boolean) to service_role;
create function public.icash_property_voice_threads(p_account uuid,p_screening uuid,p_phone text) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('sender',t.sender,'sender_pool_assigned',t.sender_pool_assigned)),'[]'::jsonb)
 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.account_id=p_account and d.screening_id=p_screening and t.recipient=p_phone and t.retired_at is null and t.party='seller';
$$;
revoke all on function public.icash_property_voice_threads(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_property_voice_threads(uuid,uuid,text) to service_role;
alter table public.icash_call_recordings add column caller_id_sid text check(caller_id_sid ~ '^PN[0-9a-fA-F]{32}$');
create function icash_recording_private.bind_business_caller_id() returns trigger language plpgsql security definer set search_path='' as $$
declare n public.icash_business_voice_numbers;
begin
 if TG_OP='UPDATE' then
  if row(new.from_phone,new.provider_account_sid,new.caller_id_sid) is distinct from row(old.from_phone,old.provider_account_sid,old.caller_id_sid) then raise exception 'Calling identity is immutable';end if;
  return new;
 end if;
 if new.from_phone='+14244377030' then
  select * into n from public.icash_business_voice_numbers where phone=new.from_phone and provider_account_sid=new.provider_account_sid and outbound_enabled and forwarding_ready for share;
  if not found or n.caller_id_sid is null then raise exception 'Calling number verification required'; end if;
  new.caller_id_sid:=n.caller_id_sid;
 elsif new.caller_id_sid is not null then raise exception 'Unexpected caller ID receipt';end if;
 return new;
end $$;
revoke all on function icash_recording_private.bind_business_caller_id() from public,anon,authenticated;
create trigger bind_business_caller_id before insert on public.icash_call_recordings for each row execute function icash_recording_private.bind_business_caller_id();
create trigger preserve_business_caller_id before update of from_phone,provider_account_sid,caller_id_sid on public.icash_call_recordings for each row execute function icash_recording_private.bind_business_caller_id();
commit;
