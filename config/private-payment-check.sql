create table if not exists public.icash_payment_test_access (
 user_id uuid primary key references auth.users(id) on delete cascade,
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
alter table public.icash_payment_test_access enable row level security;
revoke all on public.icash_payment_test_access from public,anon,authenticated;
grant select,insert,update,delete on public.icash_payment_test_access to service_role;
