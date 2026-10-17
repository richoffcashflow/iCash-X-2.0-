begin;
-- Playback telemetry only: never grants access, accepts terms, or enables work.
-- Ranges are unioned across devices; seeking and replaying do not add skipped time.
create table public.icash_course_progress (
 account_id uuid not null references public.icash_accounts(id) on delete cascade,
 video_revision integer not null check(video_revision>=0),
 duration_ms integer not null check(duration_ms between 1 and 28800000),
 played int4multirange not null default '{}',
 first_played_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 primary key(account_id,video_revision)
);
alter table public.icash_course_progress enable row level security;
create policy icash_course_progress_service_only on public.icash_course_progress for all to service_role using(true) with check(true);
revoke all on public.icash_course_progress from public,anon,authenticated;
grant select,insert,update on public.icash_course_progress to service_role;

create function public.icash_read_course_progress(p_account uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare asset public.icash_course_assets; progress public.icash_course_progress; watched bigint; percent integer;
begin
 select * into asset from public.icash_course_assets where kind='video';
 if not found or asset.path is null then return jsonb_build_object('revision',null,'state','unavailable','percent',null);end if;
 select * into progress from public.icash_course_progress where account_id=p_account and video_revision=asset.revision;
 if not found then return jsonb_build_object('revision',asset.revision,'state','unrecorded','percent',null);end if;
 select coalesce(sum(upper(r)-lower(r)),0) into watched from unnest(progress.played) r;
 percent:=least(100,floor(watched::numeric*100/progress.duration_ms)::integer);
 return jsonb_build_object('revision',asset.revision,'state',case when percent>=95 then 'completed' else 'in_progress' end,'percent',percent);
end $$;

create function public.icash_record_course_progress(p_account uuid,p_user uuid,p_revision integer,p_duration integer,p_ranges jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare asset public.icash_course_assets; span jsonb; start_ms integer; end_ms integer; watched int4multirange:='{}';
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account unavailable';end if;
 if p_revision is null or p_revision<0 or p_duration is null or p_duration not between 1 and 28800000 or p_ranges is null or jsonb_typeof(p_ranges)<>'array' then raise exception 'Invalid progress';end if;
 if jsonb_array_length(p_ranges) not between 1 and 128 or length(p_ranges::text)>8000 then raise exception 'Invalid progress';end if;
 select * into asset from public.icash_course_assets where kind='video' for share;
 if not found or asset.path is null or asset.revision<>p_revision then return null;end if;
 for span in select value from jsonb_array_elements(p_ranges) loop
  if jsonb_typeof(span)<>'array' or jsonb_array_length(span)<>2 then raise exception 'Invalid range';end if;
  if jsonb_typeof(span->0)<>'number' or jsonb_typeof(span->1)<>'number' or span->>0 !~ '^[0-9]{1,8}$' or span->>1 !~ '^[0-9]{1,8}$' then raise exception 'Invalid range';end if;
  start_ms:=(span->>0)::integer;end_ms:=(span->>1)::integer;
  if start_ms<0 or end_ms<=start_ms or end_ms>p_duration then raise exception 'Invalid range';end if;
  watched:=watched+int4multirange(int4range(start_ms,end_ms,'[)'));
 end loop;
 insert into public.icash_course_progress as existing(account_id,video_revision,duration_ms,played)
 values(p_account,p_revision,p_duration,watched)
 on conflict(account_id,video_revision) do update set duration_ms=greatest(existing.duration_ms,excluded.duration_ms),played=existing.played+excluded.played,updated_at=now();
 return public.icash_read_course_progress(p_account);
end $$;

revoke all on function public.icash_read_course_progress(uuid),public.icash_record_course_progress(uuid,uuid,integer,integer,jsonb) from public,anon,authenticated;
grant execute on function public.icash_read_course_progress(uuid),public.icash_record_course_progress(uuid,uuid,integer,integer,jsonb) to service_role;
commit;
