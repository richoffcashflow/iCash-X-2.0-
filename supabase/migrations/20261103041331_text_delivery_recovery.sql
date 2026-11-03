-- Reconcile only already accepted, settled messages. No sends or financial writes.
begin;
set local lock_timeout='2s';
create schema icash_text_receipt_private;
revoke all on schema icash_text_receipt_private from public,anon,authenticated;
grant usage on schema icash_text_receipt_private to service_role;
create table icash_text_receipt_private.schedule(
 message_id uuid primary key references public.icash_text_messages(id),
 next_check_at timestamptz not null,attempts integer not null check(attempts between 1 and 8)
);
create table icash_text_receipt_private.control(id integer primary key check(id=1),next_run_at timestamptz not null);
insert into icash_text_receipt_private.control values(1,now());
create table icash_text_receipt_private.attempts(
 id uuid primary key default gen_random_uuid(),message_id uuid not null references public.icash_text_messages(id),
 account_id uuid not null,request jsonb not null,created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '2 minutes',finished_at timestamptz,
 outcome text,receipt jsonb,
 check((finished_at is null and outcome is null and receipt is null) or
       (finished_at is not null and outcome in ('delivered','needs_review','held','changed') and receipt is not null))
);
create index icash_text_receipt_attempt_message on icash_text_receipt_private.attempts(message_id,created_at desc);
create index icash_text_accepted_receipt on public.icash_text_messages(created_at,id)
 where direction='outgoing' and state='accepted' and provider_id is not null and last_delivery_at is null;
alter table icash_text_receipt_private.schedule enable row level security;
alter table icash_text_receipt_private.control enable row level security;
alter table icash_text_receipt_private.attempts enable row level security;
revoke all on all tables in schema icash_text_receipt_private from public,anon,authenticated;
grant select,insert,update on all tables in schema icash_text_receipt_private to service_role;
create function icash_text_receipt_private.immutable_attempt() returns trigger
language plpgsql security invoker set search_path='' as $$begin
 if tg_op='DELETE' or old.finished_at is not null or
  (to_jsonb(new)-array['finished_at','outcome','receipt']) is distinct from
  (to_jsonb(old)-array['finished_at','outcome','receipt']) then
  raise exception 'Original text receipt evidence is immutable';
 end if;return new;
end$$;
create trigger text_receipt_immutable before update or delete on icash_text_receipt_private.attempts
 for each row execute function icash_text_receipt_private.immutable_attempt();
revoke all on function icash_text_receipt_private.immutable_attempt() from public,anon,authenticated,service_role;

-- Permanent evidence fence for this exact original recovered message. A later
-- duplicate delivery callback must not create an old reminder in a new transaction.
-- New messages and incoming replies cannot match this original outgoing source.
create function icash_text_receipt_private.canonical_update(p_old public.icash_text_messages,p_new public.icash_text_messages) returns boolean
language sql stable security invoker set search_path='' as $$
 select p_old.direction='outgoing' and p_old.provider_id is not null
  and p_new.state in ('delivered','needs_review','cancelled') and p_new.last_delivery_at is not null
  and (to_jsonb(p_old)-array['state','last_delivery_at','updated_at'])=(to_jsonb(p_new)-array['state','last_delivery_at','updated_at'])
  and exists(select 1 from icash_text_receipt_private.attempts a
   where a.message_id=p_new.id and a.account_id=p_new.account_id
    and a.finished_at between a.created_at and a.expires_at and a.outcome in ('delivered','needs_review')
    and a.request->>'provider_id'=p_new.provider_id and a.request->>'body'=p_new.body
    and a.request->'attachments'=p_new.attachments and a.request->>'thread_id'=p_new.thread_id::text
    and a.request->'created_at'=to_jsonb(p_new.created_at)
    and a.receipt->>'source'='contiguity_canonical_get'
    and a.receipt->'message'->'raw'->'data'->>'id'=p_new.provider_id);
$$;
revoke all on function icash_text_receipt_private.canonical_update(public.icash_text_messages,public.icash_text_messages) from public,anon,authenticated;
grant execute on function icash_text_receipt_private.canonical_update(public.icash_text_messages,public.icash_text_messages) to service_role;

-- Keep historical evidence from creating a new seller reminder or re-timing a
-- Meta follow-up window. Existing delivery and learning observations still run.
do $patch$
declare definition text;needle text:=E'begin\n';guard text;signature text;
begin
 foreach signature in array array['public.icash_observe_seller_recovery_text()','public.icash_meta_observe_text()'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if md5(definition)<>(case signature when 'public.icash_observe_seller_recovery_text()' then 'f7f87c31e3f914779790fb73c166dcf4' else 'fba8ba0c134721fa4f84a7f3fb0ff739' end) then raise exception 'Original text observer changed: %',signature;end if;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Text observation prerequisite changed: %',signature;end if;
  guard:=E'begin\n if TG_OP=''UPDATE'' and icash_text_receipt_private.canonical_update(old,new) then\n';
  if signature='public.icash_observe_seller_recovery_text()' then
   guard:=guard||E'  if new.state=''delivered'' then\n   update public.icash_seller_recovery_attempts set delivered_at=coalesce(delivered_at,new.last_delivery_at) where account_id=new.account_id and message_id=new.id;\n  end if;\n';
  end if;
  guard:=guard||E'  return new;\n end if;\n';
  execute replace(definition,needle,guard);
 end loop;
end $patch$;

create function public.icash_claim_text_delivery_rechecks() returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare candidate record;job icash_text_receipt_private.attempts;result jsonb:='[]';attempt_number integer;
begin
 -- At most three canonical reads per minute across all maintenance invocations.
 if not pg_try_advisory_xact_lock(916026) then return result;end if;
 update icash_text_receipt_private.control set next_run_at=now()+interval '1 minute'
 where id=1 and next_run_at<=now();if not found then return result;end if;
 for candidate in
  select m.id,m.account_id,m.thread_id,m.provider_id,m.body,m.attachments,m.created_at,t.sender,t.recipient,
   to_jsonb(o) operation,coalesce(s.attempts,0) attempts
  from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  join public.icash_operation_rates r on r.id=o.rate_id and r.operation in ('sms_send','mms_send')
  left join icash_text_receipt_private.schedule s on s.message_id=m.id
  where m.direction='outgoing' and m.state='accepted' and m.provider_id is not null and m.last_delivery_at is null
   and m.created_at<=now()-interval '10 minutes' and o.state='settled' and o.settled_at is not null
   and o.dispatched_at is not null and coalesce(s.attempts,0)<8 and (s.next_check_at is null or s.next_check_at<=now())
  order by s.next_check_at nulls first,m.created_at,m.id limit 3 for update of m skip locked
 loop
  attempt_number:=candidate.attempts+1;
  insert into icash_text_receipt_private.schedule(message_id,next_check_at,attempts)
   values(candidate.id,now()+least(interval '24 hours',interval '15 minutes'*power(2,attempt_number-1)),attempt_number)
   on conflict(message_id) do update set next_check_at=excluded.next_check_at,attempts=excluded.attempts;
  insert into icash_text_receipt_private.attempts(message_id,account_id,request)
   values(candidate.id,candidate.account_id,to_jsonb(candidate)-'attempts') returning * into job;
  result:=result||jsonb_build_array(jsonb_build_object('id',job.id,'request',job.request));
 end loop;
 return result;
end$$;

create function public.icash_finish_text_delivery_recheck(p_id uuid,p_receipt jsonb) returns text
language plpgsql security invoker set search_path='' set statement_timeout='5s' as $$
declare job icash_text_receipt_private.attempts;m public.icash_text_messages;t public.icash_text_threads;
 o public.icash_operation_spend;d jsonb;r jsonb;lease jsonb;parsed jsonb;source jsonb;stamp timestamptz;
 provider_stamp timestamptz;tracking jsonb;expected_event text;result_state text:='held';verified boolean:=false;
begin
 select * into job from icash_text_receipt_private.attempts where id=p_id;
 if not found then return 'changed';end if;
 -- Same budget/provider/message lock order as webhook delivery.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return 'held';end if;
 perform pg_advisory_xact_lock(hashtextextended(job.request->>'provider_id',75));
 select * into m from public.icash_text_messages where id=job.message_id for update;
 select * into job from icash_text_receipt_private.attempts where id=p_id for update;
 if job.finished_at is not null then return job.outcome;end if;
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or octet_length(p_receipt::text)>600000 then
  raise exception 'Invalid text receipt';
 end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=m.account_id;
 select * into o from public.icash_operation_spend where operation_key='text:'||m.id and account_id=m.account_id;
 source:=jsonb_build_object('id',m.id,'account_id',m.account_id,'thread_id',m.thread_id,'provider_id',m.provider_id,
  'body',m.body,'attachments',m.attachments,'created_at',m.created_at,'sender',t.sender,'recipient',t.recipient,'operation',to_jsonb(o));
 if m.state<>'accepted' or m.last_delivery_at is not null or m.direction<>'outgoing'
  or source is distinct from job.request then result_state:='changed';
 elsif job.expires_at>now() then
  -- Invalid/partial/contradictory responses are retained, never interpreted as zero cost or failed delivery.
  begin
   r:=p_receipt->'message';lease:=p_receipt->'lease';
   if r->>'url'='https://api.contiguity.com/conversations/history/message/'||(job.request->>'provider_id')
    and r->>'status'='200' and r->>'rawText' is not null and (r->>'rawText')::jsonb=r->'raw'
    and lease->>'url'='https://api.contiguity.com/numbers/leased' and lease->>'status'='200'
    and lease->>'rawText' is not null and (lease->>'rawText')::jsonb=lease->'raw'
    and (r->>'checkedAt')::timestamptz between job.created_at and now()+interval '5 seconds'
    and (lease->>'checkedAt')::timestamptz between job.created_at-interval '30 seconds' and now()+interval '5 seconds'
    and r->'raw'->>'object'='response' and lease->'raw'->>'object'='response' then
    parsed:=r->'raw';d:=parsed->'data';
    if exists(select 1 from jsonb_array_elements(lease->'raw'->'data'->'numbers') x where x->'number'->>'e164'=t.sender)
     and d->>'id'=m.provider_id and d->>'from'=t.sender and d->>'to'=t.recipient
     and d->>'message'=m.body and d->'attachments'=m.attachments
     and jsonb_typeof(d->'timestamp')='number' and jsonb_typeof(d->'tracking')='array'
     and jsonb_array_length(d->'tracking') between 1 and 100 then
     provider_stamp:=to_timestamp((d->>'timestamp')::numeric/case when (d->>'timestamp')::numeric>=1000000000000 then 1000 else 1 end);
     expected_event:=case d->>'status' when 'delivered' then 'text.delivery.confirmed' when 'failed' then 'text.delivery.failed' when 'cancelled' then 'text.cancelled' end;
     if expected_event is not null and provider_stamp between o.dispatched_at-interval '5 minutes' and job.created_at+interval '5 seconds'
      and not exists(select 1 from jsonb_array_elements(d->'tracking') x
       where x->>'event' in ('text.delivery.confirmed','text.delivery.failed','text.cancelled') and x->>'event'<>expected_event) then
      select x into tracking from jsonb_array_elements(d->'tracking') x
       where x->>'event'=expected_event order by (x->>'timestamp')::timestamptz desc limit 1;
      stamp:=(tracking->>'timestamp')::timestamptz;
      verified:=stamp between provider_stamp-interval '5 seconds' and job.created_at+interval '5 seconds';
     end if;
    end if;
   end if;
  exception when others then verified:=false;
  end;
  if verified is true then
   -- No incoming event, follow-up, operation settlement, wallet or permission write.
   result_state:=case when expected_event='text.delivery.confirmed' then 'delivered' else 'needs_review' end;
   update icash_text_receipt_private.attempts set finished_at=now(),outcome=result_state,receipt=p_receipt where id=job.id;
   update public.icash_text_messages set state=result_state,last_delivery_at=stamp,updated_at=now() where id=m.id;
   return result_state;
  end if;
 end if;
 update icash_text_receipt_private.attempts set finished_at=now(),outcome=result_state,receipt=p_receipt where id=job.id;
 return result_state;
end$$;
revoke all on function public.icash_claim_text_delivery_rechecks(),public.icash_finish_text_delivery_recheck(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_text_delivery_rechecks(),public.icash_finish_text_delivery_recheck(uuid,jsonb) to service_role;
commit;
