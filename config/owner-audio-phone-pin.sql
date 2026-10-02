begin;
-- Durable original routing review, written before the single temporary pin.
-- Contains only signed fingerprints and routing identifiers, no API credentials.
create table public.icash_owner_audio_phone_pin (
 id integer primary key check (id=1),
 review_token text not null check (length(review_token) between 40 and 16000),
 created_at timestamptz not null default now(),
 restore_started_at timestamptz
);
alter table public.icash_owner_audio_phone_pin enable row level security;
revoke all on public.icash_owner_audio_phone_pin from public,anon,authenticated,service_role;
grant select,insert on public.icash_owner_audio_phone_pin to service_role;
-- No UPDATE or DELETE grant: browser retries cannot replace the original.
-- Arm INSERT and restore-start lock the same row. This closes the race where
-- an arm review sees the private phone just before restoration starts.
create function public.icash_owner_audio_pin_arm_guard()
returns trigger language plpgsql security definer set search_path='' as $$
declare pin public.icash_owner_audio_phone_pin;
begin
 select * into pin from public.icash_owner_audio_phone_pin where id=1 for update;
 if not found or pin.restore_started_at is not null then
  raise exception 'Owner phone isolation is unavailable';
 end if;
 return new;
end $$;
revoke all on function public.icash_owner_audio_pin_arm_guard() from public,anon,authenticated,service_role;
create trigger icash_owner_audio_pin_arm_guard before insert on public.icash_owner_audio_once
for each row execute function public.icash_owner_audio_pin_arm_guard();

create function public.icash_start_owner_audio_phone_restore(p_review_token text)
returns boolean language plpgsql security definer set search_path='' as $$
declare pin public.icash_owner_audio_phone_pin; run public.icash_owner_audio_once;
begin
 select * into pin from public.icash_owner_audio_phone_pin where id=1 for update;
 if not found or pin.review_token is distinct from p_review_token then return false; end if;
 if pin.restore_started_at is not null then return true; end if;
 select * into run from public.icash_owner_audio_once where id=1 for update;
 if found and run.state not in ('passed','failed')
  and clock_timestamp()<run.expires_at+interval '90 seconds' then return false; end if;
 update public.icash_owner_audio_phone_pin set restore_started_at=clock_timestamp() where id=1;
 return true;
end $$;
revoke all on function public.icash_start_owner_audio_phone_restore(text) from public,anon,authenticated,service_role;
grant execute on function public.icash_start_owner_audio_phone_restore(text) to service_role;
commit;
