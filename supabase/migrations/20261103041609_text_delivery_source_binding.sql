-- Require the same explicit canonical source that fences historical follow-up triggers.
-- Missing/altered source stays held with its original evidence and no state mutation.
begin;
set local lock_timeout='2s';
create or replace function public.icash_finish_text_delivery_recheck(p_id uuid,p_receipt jsonb) returns text
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
   if p_receipt->>'source'='contiguity_canonical_get'
    and r->>'url'='https://api.contiguity.com/conversations/history/message/'||(job.request->>'provider_id')
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
commit;
