-- Private, append-only attribution. Provider adapters must verify evidence before recording.
create table public.icash_learning_cohorts (
 account_id uuid not null,
 deal_id uuid not null,
 mode text not null check(mode in ('test','live')),
 strategy_key text not null check(length(strategy_key) between 1 and 120),
 market text not null check(length(market) between 1 and 80),
 channel text not null check(channel in ('voice','sms','email')),
 assigned_at timestamptz not null default now(),
 primary key(account_id,deal_id),
 foreign key(account_id,deal_id) references public.icash_deals(account_id,id)
);
create index icash_learning_cohort_window on public.icash_learning_cohorts(account_id,mode,assigned_at);
create table public.icash_learning_events (
 account_id uuid not null,
 deal_id uuid not null,
 event_key text not null check(length(event_key) between 1 and 200),
 operation_id text not null check(length(operation_id) between 1 and 200),
 kind text not null check(kind in ('attempt','connected','response','qualified','offer','contract','closed','opt_out','cost')),
 source text not null check(source in ('provider_receipt','verified_conversation','signed_document','title_confirmation','billing_receipt')),
 evidence_ref text not null check(length(evidence_ref) between 1 and 200),
 occurred_at timestamptz not null,
 received_at timestamptz not null default now(),
 provider_cost_micros bigint not null default 0 check(provider_cost_micros>=0 and provider_cost_micros<=9007199254740991),
 primary key(account_id,event_key),
 unique(account_id,operation_id,kind),
 foreign key(account_id,deal_id) references public.icash_learning_cohorts(account_id,deal_id),
 check(occurred_at<=received_at+interval '5 minutes'),
 check((kind='cost' and source='billing_receipt') or (kind<>'cost' and provider_cost_micros=0)),
 check(kind<>'contract' or source='signed_document'),
 check(kind<>'closed' or source='title_confirmation'),
 check(kind not in ('attempt','connected') or source='provider_receipt')
);
create index icash_learning_event_deal on public.icash_learning_events(account_id,deal_id,occurred_at);
alter table public.icash_learning_cohorts enable row level security;
alter table public.icash_learning_events enable row level security;
revoke all on public.icash_learning_cohorts,public.icash_learning_events from public,anon,authenticated,service_role;
grant select,insert on public.icash_learning_cohorts,public.icash_learning_events to service_role;
create function public.icash_record_learning_event(p_event jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare e public.icash_learning_events; old public.icash_learning_events; inserted text;
begin
 e:=jsonb_populate_record(null::public.icash_learning_events,p_event);
 e.provider_cost_micros:=coalesce(e.provider_cost_micros,0);
 insert into public.icash_learning_events(account_id,deal_id,event_key,operation_id,kind,source,evidence_ref,occurred_at,provider_cost_micros)
 values(e.account_id,e.deal_id,e.event_key,e.operation_id,e.kind,e.source,e.evidence_ref,e.occurred_at,e.provider_cost_micros)
 on conflict(account_id,operation_id,kind) do nothing returning event_key into inserted;
 if inserted is not null then return true; end if;
 select * into strict old from public.icash_learning_events where account_id=e.account_id and operation_id=e.operation_id and kind=e.kind;
 if row(old.deal_id,old.source,old.evidence_ref,old.occurred_at,old.provider_cost_micros) is distinct from row(e.deal_id,e.source,e.evidence_ref,e.occurred_at,e.provider_cost_micros) then raise exception 'Conflicting learning receipt'; end if;
 return false;
end $$;
revoke all on function public.icash_record_learning_event(jsonb) from public,anon,authenticated;
grant execute on function public.icash_record_learning_event(jsonb) to service_role;
