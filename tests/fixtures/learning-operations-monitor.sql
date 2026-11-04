-- Isolated prerequisites for the real forward migration; no provider routes.
create schema icash_reliability_private;
create table icash_reliability_private.snapshots(id integer primary key,checked_at timestamptz,report jsonb);
create table public.icash_support_threads(id uuid primary key,status text,created_at timestamptz default now(),updated_at timestamptz);
create table public.icash_access_help_requests(id uuid primary key,status text,created_at timestamptz default now(),updated_at timestamptz);
create table public.icash_support_messages(id uuid,thread_id uuid,created_at timestamptz);
create table public.icash_access_help_messages(id uuid,request_id uuid,created_at timestamptz);
create function public.icash_refresh_account_work_snapshot() returns jsonb language plpgsql as $$
declare r jsonb;begin select report into r from icash_reliability_private.snapshots where id=1;return r;end $$;
create function public.icash_platform_learning_report(uuid) returns jsonb language plpgsql as $$
begin if $1<>'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7' then raise exception 'Owner required';end if;return '{}'::jsonb;end $$;
insert into icash_reliability_private.snapshots values(1,now(),'{"issueCount":2,"issues":[{"kind":"text_receipt"}]}');
