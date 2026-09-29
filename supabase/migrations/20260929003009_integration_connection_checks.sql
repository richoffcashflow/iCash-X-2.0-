create table public.icash_integration_checks (
 provider text primary key,checked_at timestamptz not null default now(),result jsonb not null
);
alter table public.icash_integration_checks enable row level security;
revoke all on public.icash_integration_checks from public,anon,authenticated;
grant all on public.icash_integration_checks to service_role;
