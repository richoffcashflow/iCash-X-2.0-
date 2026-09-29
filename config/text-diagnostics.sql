-- Explicit owner-authorized diagnostics; separate from customer acquisition spending.
-- Only service-role operators can create a single-use capability. Unknown cost is NULL, never zero.
create table public.icash_text_diagnostics (
 id uuid primary key default gen_random_uuid(),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 sender text not null references public.icash_text_senders(phone),
 recipient text not null check(recipient ~ '^\+[1-9][0-9]{7,14}$'),
 body text not null check(length(body) between 1 and 160),
 authorization_ref text not null check(length(authorization_ref)>20),
 expires_at timestamptz not null,
 state text not null default 'ready' check(state in ('ready','dispatching','accepted','needs_review')),
 provider_id text unique,
 cost_micros bigint check(cost_micros>=0),
 cost_status text not null default 'unknown' check(cost_status in ('unknown','verified')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((cost_status='unknown' and cost_micros is null) or (cost_status='verified' and cost_micros is not null))
);
alter table public.icash_text_diagnostics enable row level security;
revoke all on public.icash_text_diagnostics from public,anon,authenticated;
grant all on public.icash_text_diagnostics to service_role;
create function public.icash_claim_text_diagnostic(p_hash text,p_sender text) returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_text_diagnostics;
begin
 update public.icash_text_diagnostics d set state='dispatching',updated_at=now()
 where token_hash=p_hash and state='ready' and expires_at>now() and sender=p_sender
 and exists(select 1 from public.icash_text_senders s where s.phone=d.sender and s.enabled)
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=d.recipient)
 returning * into j;
 if not found then return null;end if;
 return jsonb_build_object('id',j.id,'from',j.sender,'to',j.recipient,'message',j.body);
end $$;
revoke all on function public.icash_claim_text_diagnostic(text,text) from public,anon,authenticated;
grant execute on function public.icash_claim_text_diagnostic(text,text) to service_role;
