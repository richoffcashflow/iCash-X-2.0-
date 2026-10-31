-- Production receiver definition inspected 2026-10-31; no customer data.
CREATE OR REPLACE FUNCTION public.icash_ingest_text_event_before_operational(p_event jsonb, p_optout boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;typ text:=p_event->>'type';v jsonb:=p_event->'data';n integer;stamp timestamptz;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if v->>'message_id' is not null then perform pg_advisory_xact_lock(hashtextextended(v->>'message_id',75));end if;
 insert into public.icash_text_events(id,type,payload) values(p_event->>'id',typ,p_event) on conflict(id) do nothing;
 get diagnostics n=row_count;if n=0 then return;end if;
 if typ in ('text.incoming.sms','text.incoming.mms') then
 -- STOP applies even when the sender has never been mapped to a tenant.
 if p_optout then
 perform pg_advisory_xact_lock(hashtextextended(v->>'from',74));
 insert into public.icash_text_suppressions(phone,reason) values(v->>'from','Incoming opt-out') on conflict(phone) do nothing;
 update public.icash_text_messages m set state='cancelled',updated_at=now() from public.icash_text_threads th where m.thread_id=th.id and th.recipient=v->>'from' and m.direction='outgoing' and m.state='ready';
 end if;
 select * into t from public.icash_text_threads where id=public.icash_sms_resolve_property(v->>'to',v->>'from',v->>'body');
 insert into public.icash_text_messages(thread_id,account_id,direction,body,attachments,state,event_id,provider_id) values(t.id,t.account_id,'incoming',coalesce(v->>'body',''),coalesce(v->'attachments','[]'),'received',p_event->>'id',nullif(v->>'message_id','')) on conflict do nothing;
 elsif typ='numbers.substitution' then
 update public.icash_text_senders set enabled=false where phone=v->>'from';
 elsif typ in ('text.delivery.confirmed','text.delivery.failed','text.cancelled') then
 stamp:=to_timestamp((p_event->>'timestamp')::double precision);
 update public.icash_text_messages m set state=case when typ='text.delivery.confirmed' then 'delivered' when typ='text.cancelled' then 'cancelled' else 'needs_review' end,last_delivery_at=stamp,updated_at=now()
 from public.icash_text_threads th where m.thread_id=th.id and m.provider_id=v->>'message_id' and th.sender=v->>'from' and th.recipient=v->>'to' and m.direction='outgoing'
 and (m.last_delivery_at is null or m.last_delivery_at<=stamp) and (m.state<>'delivered' or typ='text.delivery.confirmed');
 end if;
end $function$
