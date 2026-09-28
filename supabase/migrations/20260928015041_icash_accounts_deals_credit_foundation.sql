
create schema if not exists icash_private;
revoke all on schema icash_private from public, anon, authenticated;
grant usage on schema icash_private to service_role;

create table public.icash_accounts (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null unique references auth.users(id),
 assistant_name text not null check (length(trim(assistant_name)) between 1 and 40),
 legal_name text,
 identity_verified_at timestamptz,
 bot_paused boolean not null default true,
 daily_limit_cents bigint not null default 0 check(daily_limit_cents>=0),
 created_at timestamptz not null default now()
);
create table public.icash_wallets (
 account_id uuid primary key references public.icash_accounts(id),
 balance_cents bigint not null default 0 check(balance_cents>=0),
 reserved_cents bigint not null default 0 check(reserved_cents>=0 and reserved_cents<=balance_cents),
 currency text not null default 'USD' check(currency='USD')
);
create table public.icash_deals (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 address text not null, stage text not null default 'research'
 check(stage in ('research','seller','offer','contract','buyer','title','closing','closed','stopped')),
 source_provider text, source_record_id text, photo_url text, photo_rights_verified_at timestamptz,
 needs_user boolean not null default false, deadline_at timestamptz,
 seller_signed_at timestamptz, closed_confirmed_at timestamptz, proceeds_confirmed_at timestamptz,
 created_at timestamptz not null default now(), unique(account_id,id),
 check(stage<>'closed' or closed_confirmed_at is not null),
 check(proceeds_confirmed_at is null or closed_confirmed_at is not null)
);
create table public.icash_conversations (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, deal_id uuid not null,
 contact_name text, contact_phone text, contact_email text,
 human_takeover boolean not null default false, version bigint not null default 0 check(version>=0),
 created_at timestamptz not null default now(), unique(account_id,deal_id,id),
 foreign key(account_id,deal_id) references public.icash_deals(account_id,id)
);
create table public.icash_messages (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, deal_id uuid not null, conversation_id uuid not null,
 channel text not null check(channel in ('call','sms','email','note')),
 direction text not null check(direction in ('inbound','outbound','internal')),
 body text not null, provider text, provider_event_id text,
 occurred_at timestamptz not null, created_at timestamptz not null default now(),
 foreign key(account_id,deal_id,conversation_id) references public.icash_conversations(account_id,deal_id,id),
 unique(provider,provider_event_id)
);
create table public.icash_callbacks (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, deal_id uuid not null, conversation_id uuid not null,
 due_at timestamptz not null, seller_timezone text not null, time_confirmed boolean not null default false,
 status text not null default 'scheduled' check(status in ('scheduled','claimed','completed','canceled','needs_review')),
 idempotency_key text not null unique, created_at timestamptz not null default now(),
 foreign key(account_id,deal_id,conversation_id) references public.icash_conversations(account_id,deal_id,id)
);
create table public.icash_activity (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 deal_id uuid, event_type text not null, summary text not null, source_event_id text not null unique,
 occurred_at timestamptz not null, created_at timestamptz not null default now(),
 foreign key(account_id,deal_id) references public.icash_deals(account_id,id)
);
create table public.icash_credit_ledger (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 event_key text not null unique, kind text not null check(kind in ('purchase','grant','usage','refund')),
 delta_cents bigint not null check(delta_cents<>0), evidence_ref text not null check(length(trim(evidence_ref))>0),
 created_at timestamptz not null default now(),
 check((kind in ('purchase','grant') and delta_cents>0) or (kind in ('usage','refund') and delta_cents<0))
);
create table public.icash_credit_reservations (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 operation_key text not null unique, amount_cents bigint not null check(amount_cents>0),
 settled_cents bigint check(settled_cents>=0 and settled_cents<=amount_cents),
 status text not null default 'reserved' check(status in ('reserved','settled','released')),
 created_at timestamptz not null default now(),
 check((status='settled' and settled_cents is not null) or (status<>'settled' and settled_cents is null))
);
create table public.icash_credit_packs (
 code text primary key, price_cents bigint not null check(price_cents>0),
 credit_cents bigint not null check(credit_cents>0), enabled boolean not null default false,
 currency text not null default 'USD' check(currency='USD')
);
insert into public.icash_credit_packs(code,price_cents,credit_cents) values
 ('start',2000,2000),('work',10000,10000),('grow',25000,25000),('scale',50000,50000),('volume',100000,100000);

create table icash_private.provider_costs (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 provider text not null, provider_event_id text not null, operation_key text not null,
 cost_usd numeric(18,8) not null check(cost_usd>=0), occurred_at timestamptz not null,
 unique(provider,provider_event_id)
);
alter table icash_private.provider_costs enable row level security;
grant select,insert on icash_private.provider_costs to service_role;

create function icash_private.reject_ledger_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'Credit ledger is append-only; post a compensating entry'; end; $$;
revoke all on function icash_private.reject_ledger_change() from public, anon, authenticated;
create trigger icash_ledger_immutable before update or delete on public.icash_credit_ledger for each row execute function icash_private.reject_ledger_change();

do $$
declare t text;
begin
 foreach t in array array['icash_accounts','icash_wallets','icash_deals','icash_conversations','icash_messages','icash_callbacks','icash_activity','icash_credit_ledger','icash_credit_reservations','icash_credit_packs']
 loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('grant select, insert, update, delete on public.%I to service_role',t);
  if t='icash_accounts' then
   execute format('create policy own_account on public.%I for select to authenticated using(owner_user_id=(select auth.uid()))',t);
  elsif t='icash_credit_packs' then
   execute format('create policy enabled_packs on public.%I for select to authenticated using(enabled)',t);
  else
   execute format('create policy own_account on public.%I for select to authenticated using(account_id in (select id from public.icash_accounts where owner_user_id=(select auth.uid())))',t);
  end if;
 end loop;
end; $$;
revoke update, delete on public.icash_credit_ledger from service_role;
create index icash_deals_account_stage on public.icash_deals(account_id,stage);
create index icash_conversations_deal on public.icash_conversations(account_id,deal_id);
create index icash_messages_thread on public.icash_messages(account_id,deal_id,conversation_id,occurred_at);
create index icash_callbacks_thread on public.icash_callbacks(account_id,deal_id,conversation_id);
create index icash_callbacks_due on public.icash_callbacks(status,due_at);
create index icash_activity_account_time on public.icash_activity(account_id,occurred_at desc);
create index icash_activity_deal on public.icash_activity(account_id,deal_id);
create index icash_ledger_account on public.icash_credit_ledger(account_id,created_at);
create index icash_reservations_account on public.icash_credit_reservations(account_id,created_at);
create index icash_cost_account on icash_private.provider_costs(account_id,occurred_at);
