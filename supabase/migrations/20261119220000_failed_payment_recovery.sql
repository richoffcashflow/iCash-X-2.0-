-- Installed disabled; activate after the matching application is serving.
create table public.icash_payment_recovery_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into public.icash_payment_recovery_settings(id) values(1);
alter table public.icash_auto_recharges add column recovery_failures integer not null default 0 check(recovery_failures between 0 and 5),add column recovery_started_at timestamptz,add column next_retry_at timestamptz;
alter table public.icash_auto_recharge_attempts add column failure_kind text,add column decline_code text;
create table public.icash_payment_recoveries(
 id uuid primary key default gen_random_uuid(),case_key text not null unique,
 kind text not null check(kind in ('membership','private_vip','recharge')),source_id uuid not null,
 account_id uuid references public.icash_accounts(id),invoice_id text unique,
 amount_cents bigint not null check(amount_cents>0),state text not null default 'open' check(state in ('open','recovered','closed')),
 started_at timestamptz not null,next_scan_at timestamptz not null default now(),lease_until timestamptz,lease_token uuid,
 closed_at timestamptz,recovered_cents bigint not null default 0,created_at timestamptz not null default now()
);
create index icash_payment_recovery_due on public.icash_payment_recoveries(next_scan_at) where state='open';
create unique index icash_payment_recovery_open_recharge on public.icash_payment_recoveries(account_id,source_id) where kind='recharge' and state='open';
create table public.icash_payment_recovery_deliveries(
 id uuid primary key default gen_random_uuid(),recovery_id uuid not null references public.icash_payment_recoveries(id),
 channel text not null check(channel in ('email','sms')),step integer not null check(step between 0 and 3),recipient text not null,
 message jsonb not null,state text not null default 'sending' check(state in ('sending','accepted','delivered','failed','suppressed')),
 provider_id text,created_at timestamptz not null default now(),last_attempt_at timestamptz not null default now(),
 unique(recovery_id,channel,step)
);
create index icash_payment_recovery_recipient on public.icash_payment_recovery_deliveries(channel,recipient,created_at);
create unique index icash_payment_recovery_email_provider on public.icash_payment_recovery_deliveries(provider_id) where channel='email' and provider_id is not null;
-- Count billing texts in the same frequency window as activity and campaign texts.
do $$declare d text;begin
 d:=pg_get_functiondef('public.icash_lifecycle_frequency_ok(text,text,uuid,uuid)'::regprocedure);
 if md5(d)<>'f7fca73a888a64b8b999d26b9b2f4905' then raise exception 'Lifecycle frequency policy changed';end if;
 execute replace(d,' ) deliveries;',' union all select created_at from public.icash_payment_recovery_deliveries where channel=p_channel and recipient=p_recipient and created_at>now()-interval ''24 hours'' ) deliveries;');
end $$;
alter table public.icash_payment_recovery_settings enable row level security;
alter table public.icash_payment_recoveries enable row level security;
alter table public.icash_payment_recovery_deliveries enable row level security;
revoke all on public.icash_payment_recovery_settings,public.icash_payment_recoveries,public.icash_payment_recovery_deliveries from public,anon,authenticated;
grant all on public.icash_payment_recovery_settings,public.icash_payment_recoveries,public.icash_payment_recovery_deliveries to service_role;

create function public.icash_recharge_retry_ready(p_account uuid,p_mode text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_auto_recharges where account_id=p_account and mode=p_mode and recovery_failures<5 and (recovery_failures=0 or (select enabled from public.icash_payment_recovery_settings where id=1)) and (next_retry_at is null or next_retry_at<=now()));
$$;
-- Preserve the original selector and all of its admission checks.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_due_auto_recharges(text)'::regprocedure);
 if md5(d)<>'f4799fd2a651a926a91b6b6296b17097' then raise exception 'Recharge selector changed';end if;
 needle:='r.mode=p_mode and r.enabled and not a.bot_paused';
 if position(needle in d)=0 then raise exception 'Recharge selector changed';end if;
 execute replace(d,needle,needle||' and public.icash_recharge_retry_ready(r.account_id,r.mode)');
 d:=pg_get_functiondef('public.icash_claim_auto_recharge(uuid,text)'::regprocedure);
 if md5(d)<>'732d7a3e22eba64eb07575057f5b0ab5' then raise exception 'Recharge claim changed';end if;
 needle:='if not r.enabled or r.approved_order is null or r.last_attempt_at>now()-interval ''24 hours''';
 if position(needle in d)=0 then raise exception 'Recharge claim changed';end if;
 execute replace(d,needle,needle||' or not public.icash_recharge_retry_ready(p_account,p_mode)');
 d:=pg_get_functiondef('public.icash_auto_recharge_allowed(uuid)'::regprocedure);
 if md5(d)<>'e60217ca556c19debc0b98d7ea209206' then raise exception 'Recharge authorization changed';end if;
 needle:='and r.enabled and r.approved_order=t.approved_order';
 execute replace(d,needle,needle||' and public.icash_recharge_retry_ready(r.account_id,r.mode)');
 -- Settlement and claim both lock the recharge before the attempt.
 d:=pg_get_functiondef('public.icash_settle_auto_recharge(uuid,text,bigint,text,text,text)'::regprocedure);
 if md5(d)<>'f20f3fe9cd8cc063f4f3a086d0fbb941' then raise exception 'Recharge settlement changed';end if;
 needle:='select * into strict t from public.icash_auto_recharge_attempts where id=p_attempt for update;';
 execute replace(d,needle,'select * into strict t from public.icash_auto_recharge_attempts where id=p_attempt; perform 1 from public.icash_auto_recharges where account_id=t.account_id and mode=t.mode for update; '||needle);
end $$;

create function public.icash_record_recharge_failure(p_attempt uuid,p_payment text,p_kind text,p_code text) returns void language plpgsql set search_path='' as $$
declare t public.icash_auto_recharge_attempts;r public.icash_auto_recharges;n integer;retry boolean;started timestamptz;
begin
 if p_kind is null or p_kind not in ('temporary','authentication','payment_method') or p_payment is null or p_payment !~ '^pi_[A-Za-z0-9]+$' or length(coalesce(p_code,''))>100 then raise exception 'Invalid payment failure';end if;
 select * into strict t from public.icash_auto_recharge_attempts where id=p_attempt;
 select * into strict r from public.icash_auto_recharges where account_id=t.account_id and mode=t.mode for update;
 select * into strict t from public.icash_auto_recharge_attempts where id=p_attempt for update;
 if t.state<>'pending' then return;end if;
 if t.stripe_payment_id is distinct from p_payment then raise exception 'Payment mismatch';end if;
 update public.icash_auto_recharge_attempts set state='failed',lease_until=null,failure_kind=p_kind,decline_code=p_code where id=t.id;
 update public.icash_funding_orders set state='expired' where id=t.order_id and state='pending';
 if not r.enabled or r.approved_order is distinct from t.approved_order then return;end if;
 n:=least(5,r.recovery_failures+1);started:=coalesce(r.recovery_started_at,now());
 retry:=p_kind='temporary' and n<5 and started>now()-interval '14 days' and coalesce((select enabled from public.icash_payment_recovery_settings where id=1),false);
 update public.icash_auto_recharges set enabled=retry,pending_order=null,recovery_failures=n,recovery_started_at=started,
 next_retry_at=case when retry then greatest(now(),t.created_at)+make_interval(days=>case when n<=2 then 1 when n=3 then 2 else 3 end) end,
 issue=case when retry then 'Auto recharge did not go through. We will retry automatically within your saved limits.' else 'Auto recharge needs a payment update. Add money to continue.' end,updated_at=now()
 where account_id=t.account_id and mode=t.mode and approved_order=t.approved_order;
 if t.mode='live' then
  insert into public.icash_payment_recoveries(case_key,kind,source_id,account_id,amount_cents,started_at)
  values('recharge:'||t.id,'recharge',t.approved_order,t.account_id,t.amount_cents,started)
  on conflict(account_id,source_id) where kind='recharge' and state='open' do nothing;
 end if;
end $$;

create function public.icash_recharge_recovery_settled() returns trigger language plpgsql set search_path='' as $$
begin
 if new.state='paid' and old.state is distinct from 'paid' then
  update public.icash_auto_recharges set recovery_failures=0,recovery_started_at=null,next_retry_at=null,issue=null
  where account_id=new.account_id and mode=new.mode and approved_order=new.approved_order;
  update public.icash_payment_recoveries set state='recovered',closed_at=now(),recovered_cents=new.amount_cents
  where kind='recharge' and account_id=new.account_id and source_id=new.approved_order and state='open';
 end if;return new;
end $$;
create trigger icash_recharge_recovery_settled after update of state on public.icash_auto_recharge_attempts for each row execute function public.icash_recharge_recovery_settled();
create function public.icash_recharge_recovery_reset() returns trigger language plpgsql set search_path='' as $$
begin
 if new.approved_order is distinct from old.approved_order then
  new.recovery_failures:=0;new.recovery_started_at:=null;new.next_retry_at:=null;
  update public.icash_payment_recoveries set state='closed',closed_at=now() where kind='recharge' and account_id=new.account_id and source_id=old.approved_order and state='open';
 end if;return new;
end $$;
create trigger icash_recharge_recovery_reset before update of approved_order on public.icash_auto_recharges for each row execute function public.icash_recharge_recovery_reset();

create function public.icash_register_invoice_recovery(p_kind text,p_source uuid,p_account uuid,p_invoice text,p_amount bigint,p_started timestamptz) returns void language plpgsql set search_path='' as $$
begin
 if p_kind is null or p_invoice is null or p_amount is null or p_started is null or p_kind not in ('membership','private_vip') or p_invoice !~ '^in_[A-Za-z0-9]+$' or p_amount<=0 or p_started>now() or p_started<now()-interval '14 days' then return;end if;
 if p_kind='membership' and not exists(select 1 from public.icash_memberships where id=p_source and account_id is not distinct from p_account and mode='live' and state in ('active','payment_failed') and not cancel_at_period_end) then return;end if;
 if p_kind='private_vip' and not exists(select 1 from public.icash_private_vip_subscriptions where id=p_source and account_id=p_account and mode='live' and state in ('active','past_due') and not cancel_at_period_end) then return;end if;
 insert into public.icash_payment_recoveries(case_key,kind,source_id,account_id,invoice_id,amount_cents,started_at)
 values('invoice:'||p_invoice,p_kind,p_source,p_account,p_invoice,p_amount,p_started) on conflict(case_key) do nothing;
end $$;

create function public.icash_claim_payment_recoveries() returns setof public.icash_payment_recoveries language plpgsql set search_path='' as $$
begin
 if not coalesce((select enabled from public.icash_payment_recovery_settings where id=1),false) then return;end if;
 return query with due as(select id from public.icash_payment_recoveries where state='open' and next_scan_at<=now() and (lease_until is null or lease_until<=now()) order by next_scan_at,id for update skip locked limit 4)
 update public.icash_payment_recoveries r set lease_until=now()+interval '2 minutes',lease_token=gen_random_uuid(),next_scan_at=now()+interval '15 minutes' from due where r.id=due.id returning r.*;
end $$;
create function public.icash_payment_recovery_active(p_case uuid) returns boolean language plpgsql stable set search_path='' as $$
declare c public.icash_payment_recoveries;
begin
 select * into c from public.icash_payment_recoveries where id=p_case and state='open';if not found then return false;end if;
 if c.account_id is not null and exists(select 1 from public.icash_billing_reviews where account_id=c.account_id and resolved_at is null) then return false;end if;
 if c.kind='membership' then return exists(select 1 from public.icash_memberships where id=c.source_id and account_id is not distinct from c.account_id and mode='live' and state in ('active','payment_failed') and not cancel_at_period_end);
 elsif c.kind='private_vip' then return exists(select 1 from public.icash_private_vip_subscriptions where id=c.source_id and account_id=c.account_id and mode='live' and state in ('active','past_due') and not cancel_at_period_end);
 else return exists(select 1 from public.icash_auto_recharges r join public.icash_accounts a on a.id=r.account_id where r.account_id=c.account_id and r.mode='live' and r.approved_order=c.source_id and r.issue is not null and not a.bot_paused and public.icash_membership_work_allowed(a.id));end if;
end $$;

create function public.icash_claim_payment_recovery_message(p_case uuid,p_token uuid,p_channel text,p_step integer,p_email text,p_message jsonb) returns jsonb language plpgsql set search_path='' as $$
declare c public.icash_payment_recoveries;d public.icash_payment_recovery_deliveries;p public.icash_customer_update_preferences;v_recipient text;sender text;expected integer;age interval;delivery_id uuid:=gen_random_uuid();
begin
 select * into c from public.icash_payment_recoveries where id=p_case for update;
 if not found or p_token is null or c.lease_token is distinct from p_token or c.lease_until is null or c.lease_until<=now() or not public.icash_payment_recovery_active(c.id) or not coalesce((select enabled from public.icash_payment_recovery_settings where id=1),false) then return null;end if;
 age:=now()-c.started_at;if age<interval '0' or age>=interval '14 days' then return null;end if;
 if p_channel='email' then
  expected:=case when age>=interval '13 days' then 3 when age>=interval '7 days' then 2 when age>=interval '3 days' then 1 else 0 end;
  v_recipient:=lower(p_email);
  if v_recipient is null or length(v_recipient)>254 or v_recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or exists(select 1 from public.icash_email_suppressions where lower(email)=v_recipient) or exists(select 1 from public.icash_payment_recovery_deliveries where channel='email' and recipient=v_recipient and state='suppressed') then return null;end if;
 elsif p_channel='sms' then
  if age<interval '1 day' then return null;end if;expected:=0;
  select p0.* into p from public.icash_customer_update_preferences p0 join public.icash_accounts a on a.id=p0.account_id and a.owner_user_id=p0.owner_user_id where p0.account_id=c.account_id and p0.sms_enabled and p0.consented_at is not null and public.icash_customer_update_consent_valid(p0.consent_version) for update of p0;
  if not found or p.phone is null or extract(hour from now() at time zone p.timezone) not between 9 and 19 then return null;end if;
  v_recipient:=p.phone;sender:=public.icash_webinar_campaign_sender(v_recipient);
  if sender is null or exists(select 1 from public.icash_text_suppressions where phone=v_recipient) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=v_recipient) then return null;end if;
 else return null;end if;
 if p_step is distinct from expected then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('billing-recovery-delivery',901));
 perform pg_advisory_xact_lock(hashtextextended((case when p_channel='sms' then 'phone:' else 'email:' end)||v_recipient,815));
 select * into d from public.icash_payment_recovery_deliveries where recovery_id=c.id and channel=p_channel and step=p_step for update;
 if found then
  if p_channel<>'email' or d.state<>'sending' or d.recipient<>v_recipient or d.created_at<now()-interval '23 hours' or d.last_attempt_at>now()-interval '15 minutes' then return null;end if;
  update public.icash_payment_recovery_deliveries set last_attempt_at=now() where id=d.id;
  return jsonb_build_object('id',d.id,'recipient',d.recipient,'message',d.message,'sender',sender);
 end if;
 if p_channel='sms' and not public.icash_lifecycle_frequency_ok('sms',v_recipient) then return null;end if;
 if (select count(*) from public.icash_payment_recovery_deliveries where created_at>now()-interval '1 day')>=250 or exists(select 1 from public.icash_payment_recovery_deliveries where channel=p_channel and recipient=v_recipient and created_at>now()-interval '1 day') then return null;end if;
 if p_channel='sms' and not icash_sender_private.take('payment-recovery',delivery_id,sender,false,c.account_id) then return null;end if;
 insert into public.icash_payment_recovery_deliveries(id,recovery_id,channel,step,recipient,message) values(delivery_id,c.id,p_channel,p_step,v_recipient,p_message) returning * into d;
 return jsonb_build_object('id',d.id,'recipient',d.recipient,'message',d.message,'sender',sender);
end $$;

-- Financial recovery counts only a matched, verified paid invoice/recharge.
create function public.icash_finish_payment_recovery(p_case uuid,p_token uuid,p_state text,p_recovered bigint default 0) returns void language sql set search_path='' as $$
 update public.icash_payment_recoveries set state=p_state,recovered_cents=case when p_state='recovered' then greatest(0,p_recovered) else 0 end,closed_at=case when p_state='open' then null else now() end,lease_until=null
 where id=p_case and lease_token=p_token and state='open' and p_state in ('open','closed','recovered');
$$;
create function public.icash_payment_recovery_delivery_event(p_id uuid,p_provider text,p_recipient text,p_event text) returns void language plpgsql set search_path='' as $$
declare d public.icash_payment_recovery_deliveries;
begin
 if p_provider is null or p_recipient is null or p_event is null or p_event not in ('email.delivered','email.bounced','email.complained','email.failed','email.suppressed') then return;end if;
 select * into d from public.icash_payment_recovery_deliveries where channel='email' and recipient=lower(p_recipient) and (id=p_id and (provider_id is null or provider_id=p_provider) or provider_id=p_provider) for update;
 if not found then return;end if;
 update public.icash_payment_recovery_deliveries set provider_id=p_provider,state=case when state='suppressed' or p_event in ('email.bounced','email.complained','email.suppressed') then 'suppressed' when p_event='email.delivered' then 'delivered' when state='delivered' then state else 'failed' end where id=d.id;
end $$;
do $$declare fn record;begin
 for fn in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('icash_recharge_retry_ready','icash_record_recharge_failure','icash_recharge_recovery_settled','icash_recharge_recovery_reset','icash_register_invoice_recovery','icash_claim_payment_recoveries','icash_payment_recovery_active','icash_claim_payment_recovery_message','icash_finish_payment_recovery','icash_payment_recovery_delivery_event') loop
  execute format('revoke all on function %s from public,anon,authenticated',fn.signature);
  execute format('grant execute on function %s to service_role',fn.signature);
 end loop;
end $$;
