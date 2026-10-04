-- Session snapshots, internal traffic allocation, and consented Meta measurement.
alter table public.icash_webinar_sessions drop constraint icash_webinar_sessions_visitor_id_webinar_id_revision_key;
alter table public.icash_webinar_sessions add column superseded_at timestamptz;
create unique index icash_webinar_active_session on public.icash_webinar_sessions(visitor_id,webinar_id,revision,is_preview) where completed_at is null and superseded_at is null;
alter table public.icash_webinar_visitors add column marketing_consent_at timestamptz,add column measurement jsonb not null default '{}';
create index icash_webinar_guest on public.icash_webinar_visitors(funding_guest_hash) where funding_guest_hash is not null;
create index icash_webinar_account on public.icash_webinar_visitors(account_id) where account_id is not null;
update public.icash_webinar_settings set config=config||'{"optimizer":{"enabled":true,"explorationPercent":20,"minVisitors":100},"meta":{"enabled":false,"pixelId":""}}'::jsonb where id=1;

create function public.icash_webinar_begin(p_visitor uuid,p_id uuid,p_config jsonb,p_preview boolean)
returns public.icash_webinar_sessions language plpgsql security invoker set search_path=public as $$
declare s public.icash_webinar_sessions; zone text;
begin
 -- Serialize simultaneous tabs, including tabs which chose different variants.
 perform pg_advisory_xact_lock(hashtextextended(p_visitor::text||':'||p_preview::text,729));
 select timezone into zone from icash_webinar_visitors where id=p_visitor;
 select h.* into s from icash_webinar_sessions h join icash_webinars w on w.id=h.webinar_id
 where h.visitor_id=p_visitor and h.completed_at is null and h.superseded_at is null and h.is_preview=p_preview
 and timezone(zone,h.updated_at)::date=timezone(zone,now())::date
 and (case when p_preview then h.webinar_id=(p_config->>'id')::uuid and h.revision=(p_config->>'revision')::integer else w.config->>'status'='published' end)
 order by h.updated_at desc limit 1;
 if found then return s;end if;
 if not exists(select 1 from icash_webinars w where w.id=(p_config->>'id')::uuid and (p_preview or w.config->>'status'='published')) then raise exception 'session unavailable';end if;
 update icash_webinar_sessions set superseded_at=now() where visitor_id=p_visitor and completed_at is null and superseded_at is null and is_preview=p_preview
 and (not p_preview or webinar_id=(p_config->>'id')::uuid);
 insert into icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview)
 values(p_id,p_visitor,(p_config->>'id')::uuid,(p_config->>'revision')::integer,p_config,p_preview) returning * into s;
 return s;
end $$;

-- One payment is attributed once, to the last started session within seven days.
-- Only server-set guest/account bindings count; self-entered email is not proof.
create function public.icash_webinar_attributed_purchases()
returns table(payment_id text,value_cents bigint,occurred_at timestamptz,session_id uuid,visitor_id uuid,webinar_id uuid,revision integer)
language sql stable security invoker set search_path=public as $$
 with payments as (
 select f.stripe_payment_id as payment_id,f.price_cents+coalesce(f.tax_cents,0) as value_cents,f.paid_at as occurred_at,f.guest_hash,f.account_id
 from icash_funding_orders f where f.mode='live' and f.state='paid' and f.stripe_payment_id is not null and f.paid_at>=now()-interval '37 days'
 union all
 select i.stripe_payment_id,i.amount_cents,i.recorded_at,m.guest_hash,m.account_id
 from icash_membership_invoices i join icash_memberships m on m.id=i.membership_id
 where m.mode='live' and i.recorded_at>=now()-interval '37 days'
 ), verified as (
 select distinct on(p.payment_id) p.* from payments p
 where not exists(select 1 from icash_billing_reviews r where r.payment_id=p.payment_id)
 order by p.payment_id,p.occurred_at
 )
 select p.payment_id,p.value_cents,p.occurred_at,s.id,s.visitor_id,s.webinar_id,s.revision
 from verified p cross join lateral (
 select h.* from icash_webinar_sessions h join icash_webinar_visitors v on v.id=h.visitor_id
 where not h.is_preview and h.created_at<=p.occurred_at and h.created_at>=p.occurred_at-interval '7 days'
 and (v.funding_guest_hash=p.guest_hash or (p.account_id is not null and v.account_id=p.account_id))
 and exists(select 1 from icash_webinar_events e where e.session_id=h.id and e.kind='started' and e.created_at<=p.occurred_at)
 order by h.created_at desc,h.id limit 1
 ) s
$$;

create function public.icash_webinar_performance()
returns table(webinar_id uuid,revision integer,visitors bigint,mature_visitors bigint,purchases bigint,value_cents bigint,mature_value_cents bigint)
language sql stable security invoker set search_path=public as $$
 with cohort as (
 select s.webinar_id,s.revision,s.visitor_id,min(s.created_at) as first_seen
 from icash_webinar_sessions s where not s.is_preview and s.created_at>=now()-interval '30 days'
 group by s.webinar_id,s.revision,s.visitor_id
 ), paid as materialized (select * from icash_webinar_attributed_purchases())
 select c.webinar_id,c.revision,count(*),count(*) filter(where c.first_seen<=now()-interval '24 hours'),
 coalesce(sum(p.n),0)::bigint,coalesce(sum(p.cents),0)::bigint,
 coalesce(sum(p.cents) filter(where c.first_seen<=now()-interval '24 hours'),0)::bigint
 from cohort c left join lateral (
 select count(*) as n,sum(a.value_cents) as cents from paid a where a.visitor_id=c.visitor_id and a.webinar_id=c.webinar_id and a.revision=c.revision and a.occurred_at>=c.first_seen
 ) p on true group by c.webinar_id,c.revision
$$;

create table public.icash_webinar_meta_events (
 event_id text primary key,payment_id text not null unique,visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 session_id uuid not null references public.icash_webinar_sessions(id) on delete cascade,
 value_cents bigint not null check(value_cents>0),occurred_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','failed','canceled')),
 attempts integer not null default 0,claimed_at timestamptz,due_at timestamptz not null default now(),sent_at timestamptz,payload jsonb,last_status integer
);
create index icash_webinar_meta_due on public.icash_webinar_meta_events(state,due_at);
alter table public.icash_webinar_meta_events enable row level security;
revoke all on public.icash_webinar_meta_events from public,anon,authenticated;
grant all on public.icash_webinar_meta_events to service_role;

create function public.icash_webinar_sync_purchases(p_visitor uuid default null) returns void
language plpgsql security invoker set search_path=public as $$
begin
 if not coalesce((select (config->'meta'->>'enabled')::boolean from icash_webinar_settings where id=1),false) then return;end if;
 insert into icash_webinar_meta_events(event_id,payment_id,visitor_id,session_id,value_cents,occurred_at)
 select 'webinar:purchase:'||p.payment_id,p.payment_id,p.visitor_id,p.session_id,p.value_cents,p.occurred_at
 from icash_webinar_attributed_purchases() p join icash_webinar_visitors v on v.id=p.visitor_id
 where (p_visitor is null or p.visitor_id=p_visitor) and v.marketing_consent_at<=p.occurred_at and p.occurred_at>=now()-interval '6 days'
 on conflict do nothing;
 update icash_webinar_meta_events e set state='canceled',payload=null where e.state in ('pending','sending') and (p_visitor is null or e.visitor_id=p_visitor)
 and (e.occurred_at<now()-interval '6 days' or not exists(select 1 from icash_webinar_visitors v where v.id=e.visitor_id and v.marketing_consent_at<=e.occurred_at) or exists(select 1 from icash_billing_reviews r where r.payment_id=e.payment_id));
end $$;

create function public.icash_webinar_claim_meta() returns setof public.icash_webinar_meta_events
language plpgsql security invoker set search_path=public as $$
begin
 update icash_webinar_meta_events set state='failed' where state='sending' and claimed_at<now()-interval '5 minutes' and attempts>=5;
 return query with candidates as (
 select e.event_id from icash_webinar_meta_events e join icash_webinar_visitors v on v.id=e.visitor_id
 where (e.state='pending' or (e.state='sending' and e.claimed_at<now()-interval '5 minutes')) and e.due_at<=now() and e.attempts<5
 and e.occurred_at>=now()-interval '6 days' and v.marketing_consent_at<=e.occurred_at
 order by e.due_at for update of e skip locked limit 10
 ) update icash_webinar_meta_events e set state='sending',attempts=attempts+1,claimed_at=now() from candidates c where e.event_id=c.event_id returning e.*;
end $$;

revoke all on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean),public.icash_webinar_attributed_purchases(),public.icash_webinar_performance(),public.icash_webinar_sync_purchases(uuid),public.icash_webinar_claim_meta() from public,anon,authenticated;
grant execute on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean),public.icash_webinar_attributed_purchases(),public.icash_webinar_performance(),public.icash_webinar_sync_purchases(uuid),public.icash_webinar_claim_meta() to service_role;

create function public.icash_webinar_meta_health() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object('sent',count(*) filter(where state='sent'),'pending',count(*) filter(where state in ('pending','sending')),'failed',count(*) filter(where state='failed')) from icash_webinar_meta_events
$$;
revoke all on function public.icash_webinar_meta_health() from public,anon,authenticated;
grant execute on function public.icash_webinar_meta_health() to service_role;
