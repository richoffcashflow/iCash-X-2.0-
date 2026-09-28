create table public.icash_paid_lookup_diagnostics(
 id text primary key,zip text not null check(zip ~ '^[0-9]{5}$'),max_credits integer not null check(max_credits=1),
 state text not null default 'authorized' check(state in ('authorized','started','complete','held')),
 result jsonb,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz
);
alter table public.icash_paid_lookup_diagnostics enable row level security;
revoke all on public.icash_paid_lookup_diagnostics from public,anon,authenticated;
grant select,insert,update on public.icash_paid_lookup_diagnostics to service_role;
