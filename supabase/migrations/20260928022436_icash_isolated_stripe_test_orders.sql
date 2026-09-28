
create table public.icash_test_orders (
 id uuid primary key default gen_random_uuid(),
 guest_hash text not null, pack_code text not null references public.icash_credit_packs(code),
 price_cents bigint not null check(price_cents>0), credit_cents bigint not null check(credit_cents>0),
 stripe_session_id text unique, payment_intent_id text unique,
 state text not null default 'pending' check(state in('pending','paid')),
 created_at timestamptz not null default now(), paid_at timestamptz,
 check((state='pending' and paid_at is null) or (state='paid' and paid_at is not null))
);
create index icash_test_guest on public.icash_test_orders(guest_hash,created_at);
create index icash_test_pack on public.icash_test_orders(pack_code);
alter table public.icash_test_orders enable row level security;
revoke all on public.icash_test_orders from public,anon,authenticated;
grant select,insert,update on public.icash_test_orders to service_role;
create function public.icash_settle_test_order(p_order uuid,p_session text,p_payment text,p_amount bigint)
returns text language plpgsql security invoker set search_path='' as $$
declare o public.icash_test_orders;
begin
 if p_session is null or p_session not like 'cs_test_%' or p_payment is null or trim(p_payment)='' then raise exception 'Invalid test payment'; end if;
 select * into o from public.icash_test_orders where id=p_order for update;
 if not found then raise exception 'Order missing'; end if;
 if p_amount is distinct from o.price_cents then raise exception 'Amount mismatch'; end if;
 if o.stripe_session_id is not null and o.stripe_session_id<>p_session then raise exception 'Session mismatch'; end if;
 if o.state='paid' then
 if o.payment_intent_id<>p_payment then raise exception 'Payment mismatch'; end if; return 'paid'; end if;
 update public.icash_test_orders set state='paid',stripe_session_id=p_session,payment_intent_id=p_payment,paid_at=now() where id=p_order;
 return 'paid';
end; $$;
revoke all on function public.icash_settle_test_order(uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_settle_test_order(uuid,text,text,bigint) to service_role;
