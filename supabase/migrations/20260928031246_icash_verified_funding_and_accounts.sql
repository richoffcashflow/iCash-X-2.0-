-- Applied with Supabase apply_migration: icash_verified_funding_and_accounts.
-- All mutations are service-only. Test funds never enter the live wallet.
create table public.icash_funding_orders (
 id uuid primary key default gen_random_uuid(),
 mode text not null check(mode in ('test','live')),
 guest_hash text not null check(guest_hash ~ '^[a-f0-9]{64}$'),
 account_id uuid references public.icash_accounts(id),
 pack_code text not null references public.icash_credit_packs(code),
 price_cents bigint not null check(price_cents>0),
 credit_cents bigint not null check(credit_cents>0),
 currency text not null default 'usd' check(currency='usd'),
 state text not null default 'pending' check(state in ('pending','paid','expired')),
 stripe_session_id text unique,
 stripe_payment_id text unique,
 payer_email text,
 payer_phone text,
 paid_at timestamptz,
 credited_at timestamptz,
 created_at timestamptz not null default now(),
 check(stripe_session_id is null or (mode='test' and stripe_session_id like 'cs_test_%') or (mode='live' and stripe_session_id like 'cs_live_%'))
);
create unique index icash_funding_one_pending on public.icash_funding_orders(guest_hash,mode) where state='pending';
create index icash_funding_guest on public.icash_funding_orders(guest_hash,mode,created_at desc);
create index icash_funding_claim on public.icash_funding_orders(lower(payer_email),mode) where state='paid';
create index icash_funding_account on public.icash_funding_orders(account_id,mode);
alter table public.icash_funding_orders enable row level security;
revoke all on public.icash_funding_orders from public,anon,authenticated;
grant all on public.icash_funding_orders to service_role;

create table public.icash_billing_reviews (
 event_id text primary key,
 payment_id text not null,
 reason text not null,
 account_id uuid references public.icash_accounts(id),
 resolved_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.icash_billing_reviews enable row level security;
revoke all on public.icash_billing_reviews from public,anon,authenticated;
grant all on public.icash_billing_reviews to service_role;

create table public.icash_request_limits (
 bucket text primary key,
 window_start timestamptz not null,
 attempts integer not null
);
alter table public.icash_request_limits enable row level security;
revoke all on public.icash_request_limits from public,anon,authenticated;
grant all on public.icash_request_limits to service_role;
create function public.icash_take_request(p_bucket text,p_limit integer,p_seconds integer) returns boolean
language plpgsql set search_path='' as $$
declare count_now integer;
begin
 if p_limit<1 or p_seconds<1 or length(p_bucket)>160 then raise exception 'Invalid limit'; end if;
 insert into public.icash_request_limits values(p_bucket,now(),1)
 on conflict(bucket) do update set
 attempts=case when public.icash_request_limits.window_start < now()-make_interval(secs=>p_seconds) then 1 else public.icash_request_limits.attempts+1 end,
 window_start=case when public.icash_request_limits.window_start < now()-make_interval(secs=>p_seconds) then now() else public.icash_request_limits.window_start end
 returning attempts into count_now;
 return count_now<=p_limit;
end $$;

create function public.icash_settle_funding(p_order uuid,p_mode text,p_session text,p_payment text,p_amount bigint,p_email text,p_phone text) returns void
language plpgsql set search_path='' as $$
declare o public.icash_funding_orders;
begin
 select * into o from public.icash_funding_orders where id=p_order for update;
 if not found or p_mode is null or p_mode not in ('test','live') or p_amount is null or p_session is null or o.mode<>p_mode or o.price_cents<>p_amount or p_payment is null or p_payment not like 'pi_%'
 or p_email is null or length(p_email)>320 or position('@' in p_email)<2
 or (p_mode='test' and p_session not like 'cs_test_%') or (p_mode='live' and p_session not like 'cs_live_%')
 or (o.stripe_session_id is not null and o.stripe_session_id<>p_session)
 or (o.stripe_payment_id is not null and o.stripe_payment_id<>p_payment) then raise exception 'Payment mismatch'; end if;
 update public.icash_funding_orders set state='paid',stripe_session_id=p_session,stripe_payment_id=p_payment,
 payer_email=lower(trim(p_email)),payer_phone=left(p_phone,40),paid_at=coalesce(paid_at,now()) where id=o.id;
 if o.account_id is not null and o.credited_at is null then
  if p_mode='live' then perform public.icash_post_credit(o.account_id,'stripe-funding:'||o.id,'purchase',o.credit_cents,p_payment); end if;
  update public.icash_funding_orders set credited_at=now() where id=o.id;
 end if;
 update public.icash_billing_reviews set account_id=o.account_id where payment_id=p_payment and account_id is null;
 if o.account_id is not null and exists(select 1 from public.icash_billing_reviews where payment_id=p_payment and resolved_at is null) then update public.icash_accounts set bot_paused=true where id=o.account_id; end if;
end $$;

create function public.icash_claim_funding(p_user uuid,p_mode text) returns uuid
language plpgsql set search_path='' as $$
declare email_address text; a uuid; o public.icash_funding_orders;
begin
 if p_mode is null or p_mode not in ('test','live') then raise exception 'Invalid mode'; end if;
 select lower(email) into email_address from auth.users where id=p_user and email_confirmed_at is not null;
 if email_address is null then raise exception 'Verified email required'; end if;
 -- Serialize claims across devices; email is read from Auth, never supplied by the client.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select id into a from public.icash_accounts where owner_user_id=p_user;
 if a is null and not exists(select 1 from public.icash_funding_orders where lower(payer_email)=email_address and mode=p_mode and state='paid') then
  raise exception 'Fund account first';
 end if;
 if a is null then a:=public.icash_create_account(p_user); end if;
 for o in select * from public.icash_funding_orders where lower(payer_email)=email_address and mode=p_mode and state='paid' and credited_at is null order by id for update loop
  if o.account_id is not null and o.account_id<>a then raise exception 'Account mismatch'; end if;
  if p_mode='live' then perform public.icash_post_credit(a,'stripe-funding:'||o.id,'purchase',o.credit_cents,o.stripe_payment_id); end if;
  update public.icash_funding_orders set account_id=a,credited_at=now() where id=o.id;
 end loop;
 -- A refund/dispute arriving before account claim must still stop subsequent work.
 update public.icash_billing_reviews r set account_id=a from public.icash_funding_orders f
 where r.payment_id=f.stripe_payment_id and f.account_id=a and r.account_id is null;
 if exists(select 1 from public.icash_billing_reviews where account_id=a and resolved_at is null) then
  update public.icash_accounts set bot_paused=true where id=a;
 end if;
 return a;
end $$;

create function public.icash_flag_billing_issue(p_event text,p_payment text,p_reason text) returns void
language plpgsql set search_path='' as $$
declare a uuid;
begin
 select account_id into a from public.icash_funding_orders where stripe_payment_id=p_payment;
 insert into public.icash_billing_reviews(event_id,payment_id,reason,account_id) values(p_event,p_payment,p_reason,a) on conflict do nothing;
 if a is not null then update public.icash_accounts set bot_paused=true where id=a; end if;
end $$;
revoke all on function public.icash_take_request(text,integer,integer),public.icash_settle_funding(uuid,text,text,text,bigint,text,text),public.icash_claim_funding(uuid,text),public.icash_flag_billing_issue(text,text,text) from public,anon,authenticated;
grant execute on function public.icash_take_request(text,integer,integer),public.icash_settle_funding(uuid,text,text,text,bigint,text,text),public.icash_claim_funding(uuid,text),public.icash_flag_billing_issue(text,text,text) to service_role;

-- Refunded or disputed accounts cannot be resumed by another server path.
create function public.icash_guard_billing_hold() returns trigger language plpgsql set search_path='' as $$
begin
 if not new.bot_paused and exists(select 1 from public.icash_billing_reviews where account_id=new.id and resolved_at is null) then raise exception 'Payment review required'; end if;
 return new;
end $$;
revoke all on function public.icash_guard_billing_hold() from public,anon,authenticated;
grant execute on function public.icash_guard_billing_hold() to service_role;
create trigger icash_billing_hold_before_resume before update of bot_paused on public.icash_accounts for each row execute function public.icash_guard_billing_hold();

create function public.icash_funding_account_totals(p_account uuid,p_mode text) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('creditCents',coalesce(sum(credit_cents),0),'phone',
 (select payer_phone from public.icash_funding_orders where account_id=p_account and mode=p_mode and state='paid' and payer_phone is not null order by created_at desc limit 1))
 from public.icash_funding_orders where account_id=p_account and mode=p_mode and state='paid';
$$;
revoke all on function public.icash_funding_account_totals(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_funding_account_totals(uuid,text) to service_role;
