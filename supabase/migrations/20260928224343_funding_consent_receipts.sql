create table public.icash_funding_consents (
 order_id uuid not null references public.icash_funding_orders(id),version text not null,
 terms_text text not null,price_cents bigint not null,credit_cents bigint not null,
 guest_hash text not null,account_id uuid references public.icash_accounts(id),
 user_agent_hash text not null,accepted_at timestamptz not null default now(),primary key(order_id,version)
);
alter table public.icash_funding_consents enable row level security;
revoke all on public.icash_funding_consents from public,anon,authenticated;
grant select,insert on public.icash_funding_consents to service_role;
create function public.icash_record_funding_consent(p_order uuid,p_version text,p_terms text,p_guest text,p_agent_hash text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.icash_funding_orders;
begin
 select * into o from public.icash_funding_orders where id=p_order for share;
 if not found or o.guest_hash<>p_guest or o.state<>'pending' then raise exception 'Checkout consent mismatch';end if;
 if length(p_version)>50 or length(p_terms)>5000 or length(p_agent_hash)<>64 then raise exception 'Invalid consent';end if;
 insert into public.icash_funding_consents(order_id,version,terms_text,price_cents,credit_cents,guest_hash,account_id,user_agent_hash)
 values(o.id,p_version,p_terms,o.price_cents,o.credit_cents,p_guest,o.account_id,p_agent_hash) on conflict(order_id,version) do nothing;
end $$;
revoke all on function public.icash_record_funding_consent(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_record_funding_consent(uuid,text,text,text,text) to service_role;
