begin;
create table public.icash_purchase_acceptances(
 kind text not null check(kind in ('membership','credits','vip','daily')),reference_id uuid not null,
 mode text not null check(mode in ('live','test')),account_id uuid references public.icash_accounts(id),guest_hash text,
 version text not null check(length(version) between 1 and 120),terms_text text not null check(length(terms_text) between 20 and 8000),
 amount_cents bigint not null check(amount_cents between 1 and 1000000),policy_version text not null,policy_text text not null,
 request_context jsonb not null check(jsonb_typeof(request_context)='object' and pg_column_size(request_context)<3000),
 accepted_at timestamptz not null default now(),primary key(kind,reference_id,version)
);
create index icash_purchase_acceptances_account on public.icash_purchase_acceptances(account_id,accepted_at);
alter table public.icash_purchase_acceptances enable row level security;
revoke all on public.icash_purchase_acceptances from public,anon,authenticated,service_role;
grant select,insert on public.icash_purchase_acceptances to service_role;
create function public.icash_record_purchase_acceptance(p_kind text,p_reference uuid,p_mode text,p_account uuid,p_guest text,p_version text,p_terms text,p_amount bigint,p_policy_version text,p_policy text,p_context jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare matched boolean:=false;prior public.icash_purchase_acceptances;
begin
 if p_kind='credits' then
  select true into matched from public.icash_funding_orders where id=p_reference and mode=p_mode and state='pending' and account_id is not distinct from p_account and guest_hash=p_guest and price_cents=p_amount for share;
 elsif p_kind='membership' then
  select true into matched from public.icash_memberships where id=p_reference and mode=p_mode and state='pending' and account_id is not distinct from p_account and guest_hash=p_guest and price_cents=p_amount and consent_version=p_version and consent_text=p_terms for share;
 elsif p_kind='vip' then
  select true into matched from public.icash_plan_changes c join public.icash_memberships m on m.id=c.membership_id where c.id=p_reference and c.action='upgrade' and c.state='pending' and m.mode=p_mode and c.account_id=p_account and m.guest_hash=p_guest and p_amount=5000 for share of c;
 elsif p_kind='daily' then
  select true into matched from public.icash_daily_quotes q join public.icash_daily_plans p on p.id=q.plan_id where q.id=p_reference and p.mode=p_mode and p.state in ('pending','active') and p.account_id is not distinct from p_account and p.guest_hash=p_guest and q.budget_cents+q.fee_cents=p_amount and q.consent_text=p_terms for share of p;
 end if;
 if matched is distinct from true then raise exception 'Purchase acceptance binding mismatch';end if;
 insert into public.icash_purchase_acceptances(kind,reference_id,mode,account_id,guest_hash,version,terms_text,amount_cents,policy_version,policy_text,request_context)
 values(p_kind,p_reference,p_mode,p_account,p_guest,p_version,p_terms,p_amount,p_policy_version,p_policy,p_context) on conflict do nothing;
 select * into strict prior from public.icash_purchase_acceptances where kind=p_kind and reference_id=p_reference and version=p_version;
 if prior.terms_text<>p_terms or prior.amount_cents<>p_amount or prior.policy_version<>p_policy_version or prior.policy_text<>p_policy or prior.mode<>p_mode or prior.account_id is distinct from p_account or prior.guest_hash is distinct from p_guest then raise exception 'Acceptance is immutable';end if;
end $$;
-- Keep the previous RPC compatible with deployed code. Only the new checkout supplies a new version.
create function public.icash_begin_membership_v2(p_guest text,p_account uuid,p_mode text,p_price bigint,p_revision integer,p_terms text,p_version text) returns public.icash_memberships
language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;
begin
 if p_version is null or length(p_version) not between 1 and 120 then raise exception 'Terms version required';end if;
 select * into m from public.icash_begin_membership(p_guest,p_account,p_mode,p_price,p_revision,p_terms);
 if m.state<>'pending' or m.stripe_session_id is not null or m.consent_text<>p_terms then raise exception 'Review current terms in a new checkout';end if;
 update public.icash_memberships set consent_version=p_version where id=m.id returning * into m;return m;
end $$;
create table public.icash_software_access_receipts(
 account_id uuid not null references public.icash_accounts(id),user_id uuid not null,
 hour_bucket timestamptz not null default date_trunc('hour',now()),recorded_at timestamptz not null default now(),
 request_context jsonb not null check(jsonb_typeof(request_context)='object' and pg_column_size(request_context)<3000),
 primary key(account_id,hour_bucket)
);
alter table public.icash_software_access_receipts enable row level security;
revoke all on public.icash_software_access_receipts from public,anon,authenticated,service_role;
grant select,insert on public.icash_software_access_receipts to service_role;
create function public.icash_record_software_access(p_account uuid,p_user uuid,p_context jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account binding mismatch';end if;
 insert into public.icash_software_access_receipts(account_id,user_id,request_context) values(p_account,p_user,p_context) on conflict do nothing;
end $$;
create table public.icash_dispute_events(
 event_id text primary key check(event_id ~ '^evt_[A-Za-z0-9]+$'),dispute_id text not null check(dispute_id ~ '^dp_[A-Za-z0-9]+$'),
 mode text not null check(mode in ('live','test')),payment_id text,charge_id text not null,event_type text not null,
 status text not null,reason text not null,amount_cents bigint not null,currency text not null,due_at timestamptz,
 event_created_at timestamptz not null,received_at timestamptz not null default now()
);
create index icash_dispute_events_dispute on public.icash_dispute_events(dispute_id,event_created_at);
alter table public.icash_dispute_events enable row level security;
revoke all on public.icash_dispute_events from public,anon,authenticated,service_role;
grant select,insert on public.icash_dispute_events to service_role;
create function public.icash_record_dispute_event(p_event jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 insert into public.icash_dispute_events(event_id,dispute_id,mode,payment_id,charge_id,event_type,status,reason,amount_cents,currency,due_at,event_created_at)
 values(p_event->>'eventId',p_event->>'disputeId',p_event->>'mode',p_event->>'paymentId',p_event->>'chargeId',p_event->>'eventType',p_event->>'status',p_event->>'reason',(p_event->>'amountCents')::bigint,p_event->>'currency',(p_event->>'dueAt')::timestamptz,(p_event->>'createdAt')::timestamptz) on conflict do nothing;
end $$;
revoke all on function public.icash_record_purchase_acceptance(text,uuid,text,uuid,text,text,text,bigint,text,text,jsonb),public.icash_begin_membership_v2(text,uuid,text,bigint,integer,text,text),public.icash_record_software_access(uuid,uuid,jsonb),public.icash_record_dispute_event(jsonb) from public,anon,authenticated;
grant execute on function public.icash_record_purchase_acceptance(text,uuid,text,uuid,text,text,text,bigint,text,text,jsonb),public.icash_begin_membership_v2(text,uuid,text,bigint,integer,text,text),public.icash_record_software_access(uuid,uuid,jsonb),public.icash_record_dispute_event(jsonb) to service_role;
-- Extend only the accepted versions; preserve every funding, review and account guard.
do $$
declare definition text;needle text;
begin
 select pg_get_functiondef('public.icash_apply_prepaid_purchase(uuid)'::regprocedure) into definition;
 needle:=$n$c.version in ('work-credits-2026-10-03.1','work-credits-2026-10-05.1','work-credits-2026-10-06.1','work-credits-2026-10-06.1:recharge-2026-10-06.1')$n$;
 if position(needle in definition)=0 then raise exception 'Unexpected prepaid consent gate';end if;
 execute replace(definition,needle,$n$c.version in ('work-credits-2026-10-03.1','work-credits-2026-10-05.1','work-credits-2026-10-06.1','work-credits-2026-10-06.1:recharge-2026-10-06.1','work-credits-2026-10-07.1','work-credits-2026-10-07.1:recharge-2026-10-06.1','work-credits-2026-10-10.1','work-credits-2026-10-10.1:recharge-2026-10-10.1')$n$);
 select pg_get_functiondef('public.icash_activate_auto_recharge(uuid,text,text)'::regprocedure) into definition;
 needle:=$n$version='work-credits-2026-10-06.1:recharge-2026-10-06.1'$n$;
 if position(needle in definition)=0 then raise exception 'Unexpected recharge consent gate';end if;
 execute replace(definition,needle,$n$version in ('work-credits-2026-10-06.1:recharge-2026-10-06.1','work-credits-2026-10-07.1:recharge-2026-10-06.1','work-credits-2026-10-10.1:recharge-2026-10-10.1')$n$);
 select pg_get_functiondef('public.icash_daily_claim(uuid)'::regprocedure) into definition;
 needle:=$n$p.consent_version not like 'daily-2026-10-04.1%'$n$;
 if position(needle in definition)=0 then raise exception 'Unexpected daily consent gate';end if;
 execute replace(definition,needle,$n$(p.consent_version not like 'daily-2026-10-04.1%' and p.consent_version not like 'daily-2026-10-10.1%')$n$);
 select pg_get_functiondef('public.icash_credit_acquisition_allowed(uuid)'::regprocedure) into definition;
 needle:=$n$p.consent_version like 'daily-2026-10-04.1%'$n$;
 if position(needle in definition)=0 then raise exception 'Unexpected acquisition consent gate';end if;
 execute replace(definition,needle,$n$(p.consent_version like 'daily-2026-10-04.1%' or p.consent_version like 'daily-2026-10-10.1%')$n$);
end $$;
commit;
