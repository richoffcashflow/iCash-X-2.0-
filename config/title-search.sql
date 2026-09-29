create table public.icash_title_search_results (
 operation_key text primary key references public.icash_operation_spend(operation_key),account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 place_ids text[] not null check(cardinality(place_ids)<=5),created_at timestamptz not null default now()
);
alter table public.icash_title_search_results enable row level security;
revoke all on public.icash_title_search_results from public,anon,authenticated;
grant all on public.icash_title_search_results to service_role;
