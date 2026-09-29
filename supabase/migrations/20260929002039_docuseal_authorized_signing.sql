alter table public.icash_signing_templates alter column provider_template_id type text using provider_template_id::text;
alter table public.icash_signing_templates add column provider text not null default 'signwell' check(provider in ('signwell','docuseal'));
alter table public.icash_signing_templates add column customer_signature_field text;
alter table public.icash_signing_templates add column automated_signing_reviewed boolean not null default false;
alter table public.icash_signing_envelopes alter column provider_id type text using provider_id::text;
create table public.icash_signature_authorizations (
 envelope_id uuid primary key references public.icash_signing_envelopes(id),account_id uuid not null references public.icash_accounts(id),
 actor_user_id uuid not null,terms_hash text not null,signature_text text not null check(length(signature_text) between 2 and 200),
 consent_version text not null default '2026-09-28-auto-sign-1',authorized_at timestamptz not null default now(),expires_at timestamptz not null,
 state text not null default 'authorized' check(state in ('authorized','claimed','revoked')),claimed_at timestamptz
);
alter table public.icash_signature_authorizations enable row level security;
revoke all on public.icash_signature_authorizations from public,anon,authenticated;
grant all on public.icash_signature_authorizations to service_role;
create function public.icash_claim_auto_signature(p_account uuid,p_envelope uuid,p_hash text) returns text
language plpgsql security invoker set search_path='' as $$
declare a public.icash_signature_authorizations;
begin
 update public.icash_signature_authorizations set state='claimed',claimed_at=now()
 where envelope_id=p_envelope and account_id=p_account and terms_hash=p_hash and state='authorized' and expires_at>now()
 and exists(select 1 from public.icash_signing_envelopes e join public.icash_signing_templates t on t.id=e.template_id where e.id=p_envelope and e.account_id=p_account and e.terms_hash=p_hash and e.state='customer_signature_needed' and exists(select 1 from public.icash_accounts a where a.id=e.account_id and not a.bot_paused) and exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs j on j.id=d.screening_id where d.id=e.deal_id and d.terms=e.terms and not exists(select 1 from public.icash_property_controls pc where pc.account_id=e.account_id and pc.property_id=j.snapshot->>'propertyId' and pc.manual)) and t.provider='docuseal' and t.enabled and t.automated_signing_reviewed and t.reviewed_until>now())
 returning * into a;
 return a.signature_text;
end $$;
revoke all on function public.icash_claim_auto_signature(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_auto_signature(uuid,uuid,text) to service_role;
