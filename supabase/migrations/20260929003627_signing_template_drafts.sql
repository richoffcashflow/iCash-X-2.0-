create table public.icash_template_drafts (
 key text primary key,state text not null default 'claimed' check(state in ('claimed','created','needs_review')),
 result jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.icash_template_drafts enable row level security;
revoke all on public.icash_template_drafts from public,anon,authenticated;
grant all on public.icash_template_drafts to service_role;
create function public.icash_claim_template_draft(p_key text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_key not in ('icash-x-test-purchase-v1','icash-x-test-assignment-v1') then raise exception 'Unknown draft';end if;
 insert into public.icash_template_drafts(key) values(p_key) on conflict do nothing;
 return found;
end $$;
revoke all on function public.icash_claim_template_draft(text) from public,anon,authenticated;
grant execute on function public.icash_claim_template_draft(text) to service_role;
alter table public.icash_signing_templates add column customer_consent_field text;
alter table public.icash_signing_templates add column max_legal_description_chars integer not null default 2000 check(max_legal_description_chars between 100 and 12000);
