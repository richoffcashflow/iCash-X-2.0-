begin;
-- LOCAL REVIEW ONLY. No backfill, policy insertion, activation, dispatch or money
-- changes. Apply after live conversations and voice-usage settlement schemas.
create schema icash_outbound_billing_private;
revoke all on schema icash_outbound_billing_private from public,anon,authenticated,service_role;
create unique index outbound_call_queue_binding on public.icash_live_conversations(id,account_id,operation_key);
create table icash_outbound_billing_private.queue (
 call_id uuid primary key,account_id uuid not null,operation_key text not null unique,
 state text not null default 'pending' check(state in ('pending','leased','completed','review')),
 next_attempt_at timestamptz not null default clock_timestamp() check(isfinite(next_attempt_at)),
 created_at timestamptz not null default clock_timestamp() check(isfinite(created_at)),
 updated_at timestamptz not null default clock_timestamp() check(isfinite(updated_at)),
 attempts integer not null default 0 check(attempts between 0 and 12),
 lease_token uuid,lease_expires_at timestamptz check(isfinite(lease_expires_at)),
 reason text check(length(reason) between 1 and 300),
 foreign key(call_id,account_id,operation_key) references public.icash_live_conversations(id,account_id,operation_key),
 check((state='leased' and lease_token is not null and lease_expires_at is not null)
  or (state<>'leased' and lease_token is null and lease_expires_at is null))
);
create index outbound_billing_due on icash_outbound_billing_private.queue(next_attempt_at,created_at,call_id) where state in ('pending','leased');
alter table icash_outbound_billing_private.queue enable row level security;
revoke all on icash_outbound_billing_private.queue from public,anon,authenticated,service_role;

create function public.icash_get_outbound_usage_settlement(p_account uuid,p_call uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('settled',true,'chargedCents',o.charged_cents,'costBasis',o.cost_basis,'operationKey',o.operation_key)
 from public.icash_live_conversations c
 join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
 join public.icash_operation_rates r on r.id=o.rate_id and r.operation=case c.party when 'seller' then 'seller_call' when 'buyer' then 'buyer_call' end
 join public.icash_cost_manifests m on m.operation_key=o.operation_key
 join public.icash_credit_reservations cr on cr.id=o.credit_reservation_id and cr.account_id=o.account_id and cr.operation_key=o.operation_key
 where c.id=p_call and c.account_id=p_account and c.state='complete' and c.completed_at is not null
 and o.state='settled' and o.cost_basis in ('verified','estimated') and o.charged_cents between 0 and o.charge_cap_cents
 and m.charge_cents=o.charged_cents and m.actual_micros=o.actual_micros and m.evidence_ref=o.settlement_evidence
 and cr.amount_cents=o.charge_cap_cents
 and jsonb_typeof(m.components)='object' and (select count(*) from jsonb_each(m.components))=16
 and not exists(select 1 from jsonb_each(m.components) x where jsonb_typeof(x.value->'amountMicros') is distinct from 'number')
 and (select sum(case when jsonb_typeof(x.value->'amountMicros')='number' then (x.value->>'amountMicros')::numeric end) from jsonb_each(m.components) x)=o.actual_micros
 and ((o.charged_cents=0 and cr.status='released' and cr.settled_cents is null
       and not exists(select 1 from public.icash_credit_ledger l where l.event_key='usage:'||o.operation_key))
  or (o.charged_cents>0 and cr.status='settled' and cr.settled_cents=o.charged_cents
      and exists(select 1 from public.icash_credit_ledger l where l.account_id=o.account_id and l.event_key='usage:'||o.operation_key
       and l.kind='usage' and l.delta_cents=-o.charged_cents and l.evidence_ref=o.settlement_evidence)));
$$;

create function icash_outbound_billing_private.enqueue_call()
returns trigger language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp();
begin
 -- Only exact seller/buyer ledger bindings; never reception/practice/inbound.
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key=new.operation_key and o.account_id=new.account_id and o.state in ('dispatched','settled')
   and r.operation=case new.party when 'seller' then 'seller_call' when 'buyer' then 'buyer_call' end) then return new;end if;
 insert into icash_outbound_billing_private.queue(call_id,account_id,operation_key,next_attempt_at)
 values(new.id,new.account_id,new.operation_key,case when new.state='complete' then t else t+interval '30 seconds' end)
 on conflict(call_id) do update set next_attempt_at=least(icash_outbound_billing_private.queue.next_attempt_at,t),updated_at=t
 where new.state='complete' and icash_outbound_billing_private.queue.state='pending';
 return new;
end $$;
create trigger outbound_billing_enqueue after insert or update of state on public.icash_live_conversations
 for each row execute function icash_outbound_billing_private.enqueue_call();

create function public.icash_claim_outbound_billing(p_limit integer default 1,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t timestamptz:=clock_timestamp(); result jsonb;
begin
 if p_limit is distinct from 1 or p_lease_seconds is distinct from 120 then raise exception 'Bounded claim requires limit 1 and lease 120';end if;
 -- A crash on attempt 12 also reaches review; never silently cancels funds.
 with exhausted as (select q.call_id from icash_outbound_billing_private.queue q
  where q.attempts>=12 and ((q.state='leased' and q.lease_expires_at<=t) or q.state='pending')
  order by q.next_attempt_at,q.created_at,q.call_id for update skip locked limit 100)
 update icash_outbound_billing_private.queue q set state='review',lease_token=null,lease_expires_at=null,
  reason='max_attempts: lease_expired_or_exhausted',updated_at=t from exhausted x where q.call_id=x.call_id;
 with candidate as (select q.call_id from icash_outbound_billing_private.queue q
  where q.attempts<12 and ((q.state='pending' and q.next_attempt_at<=t) or (q.state='leased' and q.lease_expires_at<=t))
  order by case when q.state='leased' then q.lease_expires_at else q.next_attempt_at end,q.created_at,q.call_id
  for update skip locked limit 1), claimed as (
  update icash_outbound_billing_private.queue q set state='leased',lease_token=gen_random_uuid(),lease_expires_at=t+interval '120 seconds',
  attempts=q.attempts+1,updated_at=t from candidate c where q.call_id=c.call_id returning q.*)
 select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from claimed c;
 return result;
end $$;

create function public.icash_finish_outbound_billing(p_call_id uuid,p_account_id uuid,p_lease_token uuid,p_outcome text,p_reason text,p_retry_seconds integer default 60)
returns boolean language plpgsql security definer set search_path='' as $$
declare q icash_outbound_billing_private.queue; t timestamptz:=clock_timestamp(); n integer; outcome text;
begin
 if p_outcome is null or p_outcome not in ('completed','retry','review') or p_reason is null or length(btrim(p_reason)) not between 1 and 200
  or p_retry_seconds is null or p_retry_seconds not between 60 and 900 then raise exception 'Invalid queue result';end if;
 select * into q from icash_outbound_billing_private.queue b where b.call_id=p_call_id and b.account_id=p_account_id
  and b.state='leased' and b.lease_token=p_lease_token and b.lease_expires_at>t for update;
 if not found or q.lease_expires_at<=clock_timestamp() then return false;end if;
 if p_outcome='completed' and not coalesce((public.icash_get_outbound_usage_settlement(p_account_id,p_call_id)->>'settled')::boolean,false) then return false;end if;
 outcome:=case when p_outcome='retry' then case when q.attempts>=12 then 'review' else 'pending' end else p_outcome end;
 update icash_outbound_billing_private.queue set state=outcome,
  next_attempt_at=case when outcome='pending' then clock_timestamp()+make_interval(secs=>p_retry_seconds) else next_attempt_at end,
  lease_token=null,lease_expires_at=null,updated_at=clock_timestamp(),
  reason=case when q.attempts>=12 and p_outcome='retry' then 'max_attempts: '||btrim(p_reason) else btrim(p_reason) end
 where call_id=q.call_id and state='leased' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
 get diagnostics n=row_count;return n=1;
end $$;

create function public.icash_recover_outbound_billing(p_call_id uuid,p_account_id uuid,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.icash_live_conversations; n integer;t timestamptz:=clock_timestamp();
begin
 if p_reason is null or length(btrim(p_reason)) not between 1 and 200 then raise exception 'Explicit recovery reason required';end if;
 select * into c from public.icash_live_conversations where id=p_call_id and account_id=p_account_id;
 if not found or not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
 where o.operation_key=c.operation_key and o.account_id=c.account_id and o.state in ('dispatched','settled')
  and r.operation=case c.party when 'seller' then 'seller_call' when 'buyer' then 'buyer_call' end) then return false;end if;
 insert into icash_outbound_billing_private.queue(call_id,account_id,operation_key,next_attempt_at,reason)
 values(c.id,c.account_id,c.operation_key,t,btrim(p_reason))
 on conflict(call_id) do update set state='pending',attempts=0,next_attempt_at=t,updated_at=t,reason=btrim(p_reason)
 where icash_outbound_billing_private.queue.state='review';
 get diagnostics n=row_count;return n=1;
end $$;
revoke all on function icash_outbound_billing_private.enqueue_call() from public,anon,authenticated,service_role;
revoke all on function public.icash_get_outbound_usage_settlement(uuid,uuid),public.icash_claim_outbound_billing(integer,integer),
 public.icash_finish_outbound_billing(uuid,uuid,uuid,text,text,integer),public.icash_recover_outbound_billing(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_outbound_usage_settlement(uuid,uuid),public.icash_claim_outbound_billing(integer,integer),
 public.icash_finish_outbound_billing(uuid,uuid,uuid,text,text,integer),public.icash_recover_outbound_billing(uuid,uuid,text) to service_role;
commit;
