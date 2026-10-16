-- Private course assets are accessed through membership-authorized server routes.
create table public.icash_course_assets (
 kind text primary key check (kind in ('video','pdf')),
 path text unique,
 name text,
 size bigint,
 mime_type text,
 revision integer not null default 0 check (revision >= 0),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 constraint complete_course_asset check (
  (path is null and name is null and size is null and mime_type is null) or
  (path is not null and name is not null and size is not null and mime_type is not null and size > 0 and
   ((kind='video' and mime_type in ('video/mp4','video/webm') and size<=2147483648) or
    (kind='pdf' and mime_type='application/pdf' and size<=52428800)))
 )
);
alter table public.icash_course_assets enable row level security;
create policy icash_course_service_only on public.icash_course_assets for all to service_role using (true) with check (true);
revoke all on public.icash_course_assets from public,anon,authenticated;
grant select,insert,update on public.icash_course_assets to service_role;
insert into public.icash_course_assets(kind) values ('video'),('pdf');
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('icash-course','icash-course',false,2147483648,array['video/mp4','video/webm','application/pdf']);
-- No browser storage policies: only owner-scoped signed uploads and expiring member downloads.
