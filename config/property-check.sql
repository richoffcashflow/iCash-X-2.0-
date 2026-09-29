-- Explicit one-property owner diagnostics; never creates an outreach permission or wallet debit.
create table public.icash_property_checks(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),property_id text not null check(property_id ~ '^prop_[0-9]{1,20}$'),
 expected_address text not null check(length(expected_address) between 10 and 300),
 authorization_ref text not null check(length(authorization_ref)>20),expires_at timestamptz not null,
 state text not null default 'authorized' check(state in ('authorized','started','complete','held')),
 result jsonb,created_at timestamptz not null default now(),started_at timestamptz,completed_at timestamptz
);
alter table public.icash_property_checks enable row level security;
revoke all on public.icash_property_checks from public,anon,authenticated;
grant all on public.icash_property_checks to service_role;
create function public.icash_claim_property_check(p_hash text) returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_property_checks;
begin
 update public.icash_property_checks set state='started',started_at=now() where token_hash=p_hash and state='authorized' and expires_at>now() returning * into j;
 if not found then return null;end if;
 return jsonb_build_object('id',j.id,'propertyId',j.property_id,'expectedAddress',j.expected_address);
end $$;
revoke all on function public.icash_claim_property_check(text) from public,anon,authenticated;
grant execute on function public.icash_claim_property_check(text) to service_role;
