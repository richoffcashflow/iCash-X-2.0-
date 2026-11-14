begin;

-- Install inactive. Enable only after the signed webhook handler is deployed and
-- provider open tracking/subscriptions are verified. No historical queue replay.
create table public.icash_purchase_access_reminder_policy (
 id integer primary key check(id=1),
 enabled boolean not null default false,
 activated_at timestamptz,
 check(not enabled or activated_at is not null)
);
insert into public.icash_purchase_access_reminder_policy(id) values(1);
alter table public.icash_purchase_access_reminder_policy enable row level security;
revoke all on public.icash_purchase_access_reminder_policy from public,anon,authenticated;
grant select,update on public.icash_purchase_access_reminder_policy to service_role;

-- Engagement is distinct from delivery and never establishes sign-in or consent.
create table public.icash_purchase_email_engagement (
 event_id text primary key check(length(event_id) between 1 and 200),
 purchase_email_id uuid not null references public.icash_purchase_access_emails(id),
 provider_id text not null check(provider_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 recipient text not null check(length(recipient) between 3 and 254),
 kind text not null check(kind in ('opened','clicked')),
 occurred_at timestamptz not null,
 received_at timestamptz not null default now()
);
create index icash_purchase_email_engagement_binding on public.icash_purchase_email_engagement(purchase_email_id,provider_id,recipient);
alter table public.icash_purchase_email_engagement enable row level security;
revoke all on public.icash_purchase_email_engagement from public,anon,authenticated;
grant select,insert on public.icash_purchase_email_engagement to service_role;

create function public.icash_record_purchase_email_engagement(p_event text,p_id uuid,p_provider text,p_recipient text,p_kind text,p_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.icash_purchase_access_emails;
begin
 if p_event is null or length(p_event) not between 1 and 200 or p_kind is null or p_kind not in ('opened','clicked')
 or p_provider is null or p_provider !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 or p_recipient is null or length(p_recipient)>254 or p_at is null or not isfinite(p_at) or p_at>now()+interval '5 minutes' then return;end if;
 -- Before the send receipt is saved, only the exact original email tag and
 -- recipient can retain a signed event. It takes effect only after provider match.
 select * into e from public.icash_purchase_access_emails
 where recipient=lower(trim(p_recipient)) and first_attempt_at is not null
 and (p_id is null or id=p_id)
 and (provider_id=p_provider or (id=p_id and provider_id is null and message is not null));
 if not found or p_at<e.first_attempt_at-interval '5 minutes' then return;end if;
 insert into public.icash_purchase_email_engagement(event_id,purchase_email_id,provider_id,recipient,kind,occurred_at)
 values(p_event,e.id,p_provider,e.recipient,p_kind,p_at) on conflict(event_id) do nothing;
end $$;

create function public.icash_purchase_email_reminder_needed(p_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_purchase_access_emails e
 join public.icash_memberships m on m.id=e.membership_id
 join public.icash_membership_invoices i on i.stripe_invoice_id=e.invoice_id and i.membership_id=m.id
 left join public.icash_purchase_access_reminder_policy p on p.id=1
 where e.id=p_id and case when p.enabled and e.created_at>=p.activated_at then
  -- Absence of an event is not proof that an email was unread. Product entry
  -- independently suppresses the reminder when tracking was blocked or delayed.
  e.delivery is distinct from 'failed'
  and not exists(select 1 from public.icash_purchase_email_engagement g
   where g.purchase_email_id=e.id and g.provider_id=e.provider_id and g.recipient=e.recipient)
  and not exists(select 1 from public.icash_software_access_receipts a
   where a.account_id=m.account_id and a.recorded_at>=i.recorded_at)
  and not exists(select 1 from public.icash_workspace_walkthroughs w
   where w.account_id=m.account_id and w.course_opened_at>=i.recorded_at)
  and not exists(select 1 from public.icash_course_progress c
   where c.account_id=m.account_id and c.updated_at>=i.recorded_at)
 else m.account_id is null end);
$$;

-- Preserve all existing payment, recipient, suppression and SMS conditions.
-- Both the existing claim and final authorization call this same predicate.
do $patch$
declare definition text;
begin
 select pg_get_functiondef('public.icash_purchase_access_followup_allowed(uuid)'::regprocedure) into definition;
 if md5(definition)<>'0f962a7b11cc4f0307e9e9bcfe881e1e' then raise exception 'Purchase follow-up predecessor changed';end if;
 if position('m.account_id is null and f.recipient=e.recipient' in definition)=0 then raise exception 'Purchase follow-up predicate missing';end if;
 execute replace(definition,'m.account_id is null and f.recipient=e.recipient','public.icash_purchase_email_reminder_needed(e.id) and f.recipient=e.recipient');
end $patch$;

revoke all on function public.icash_record_purchase_email_engagement(text,uuid,text,text,text,timestamptz),public.icash_purchase_email_reminder_needed(uuid) from public,anon,authenticated;
grant execute on function public.icash_record_purchase_email_engagement(text,uuid,text,text,text,timestamptz),public.icash_purchase_email_reminder_needed(uuid) to service_role;
commit;
