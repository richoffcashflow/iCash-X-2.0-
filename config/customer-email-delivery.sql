-- Provider delivery events never change the billing/acceptance state.
alter table public.icash_deal_emails add column delivery_state text check(delivery_state in ('delivered','bounced','complained','delivery_delayed','failed'));
alter table public.icash_deal_emails add column delivery_at timestamptz;
create table public.icash_email_delivery_events(event_id text primary key,provider_id text not null,kind text not null check(kind in ('delivered','bounced','complained','delivery_delayed','failed')),occurred_at timestamptz not null);
create index icash_email_delivery_provider on public.icash_email_delivery_events(provider_id,occurred_at);
create table public.icash_email_suppressions(account_id uuid not null references public.icash_accounts(id),email text not null,reason text not null,created_at timestamptz not null default now(),primary key(account_id,email));
alter table public.icash_email_delivery_events enable row level security;
alter table public.icash_email_suppressions enable row level security;
revoke all on public.icash_email_delivery_events,public.icash_email_suppressions from public,anon,authenticated;
grant all on public.icash_email_delivery_events,public.icash_email_suppressions to service_role;
create function public.icash_apply_email_delivery(p_provider text) returns void language plpgsql set search_path='' as $$
declare m public.icash_deal_emails;e public.icash_email_delivery_events;
begin
 select * into m from public.icash_deal_emails where provider_id=p_provider and direction='outgoing' for update;if not found then return;end if;
 select * into e from public.icash_email_delivery_events where provider_id=p_provider order by case kind when 'complained' then 3 when 'bounced' then 2 else 1 end desc,occurred_at desc,event_id desc limit 1;if not found then return;end if;
 update public.icash_deal_emails set delivery_state=e.kind,delivery_at=e.occurred_at where id=m.id;
 if e.kind in ('bounced','complained') then insert into public.icash_email_suppressions(account_id,email,reason) values(m.account_id,lower(m.recipient),e.kind) on conflict(account_id,email) do nothing;end if;
end $$;
create function public.icash_record_email_delivery(p_event text,p_provider text,p_kind text,p_at timestamptz) returns void language plpgsql set search_path='' as $$
begin
 if p_event is null or length(p_event) not between 1 and 200 or p_provider is null or p_provider !~* '^[0-9a-f-]{36}$' or p_kind not in ('email.delivered','email.bounced','email.complained','email.delivery_delayed','email.failed') or p_at is null or p_at>now()+interval '5 minutes' then raise exception 'Invalid delivery event';end if;
 insert into public.icash_email_delivery_events(event_id,provider_id,kind,occurred_at) values(p_event,p_provider,substr(p_kind,7),p_at) on conflict(event_id) do nothing;
 perform public.icash_apply_email_delivery(p_provider);
end $$;
create function public.icash_reconcile_email_delivery() returns trigger language plpgsql set search_path='' as $$ begin if new.direction='outgoing' and new.provider_id is not null then perform public.icash_apply_email_delivery(new.provider_id);end if;return new;end $$;
create trigger icash_reconcile_email_delivery after insert or update of provider_id on public.icash_deal_emails for each row execute function public.icash_reconcile_email_delivery();
alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_email_before_delivery;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.icash_deal_emails m join public.icash_email_suppressions s on s.account_id=m.account_id and s.email=lower(m.recipient) where m.id=p_id and m.account_id=p_account) then return null;end if;
 return public.icash_claim_email_before_delivery(p_account,p_id);
end $$;
revoke all on function public.icash_apply_email_delivery(text),public.icash_record_email_delivery(text,text,text,timestamptz),public.icash_reconcile_email_delivery(),public.icash_claim_deal_email(uuid,uuid),public.icash_claim_email_before_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_apply_email_delivery(text),public.icash_record_email_delivery(text,text,text,timestamptz),public.icash_reconcile_email_delivery(),public.icash_claim_deal_email(uuid,uuid) to service_role;
