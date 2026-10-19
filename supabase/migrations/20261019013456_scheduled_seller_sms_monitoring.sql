begin;
set local lock_timeout='5s';

-- A ready first text can be waiting for its real contact window. This is a
-- read-only monitoring predicate: it never changes permission, hours or work.
create function public.icash_seller_sms_waiting_window(p_account uuid,p_screening uuid,p_phone text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_deal_files d
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.account_id=p_account and d.screening_id=p_screening and d.stage='draft'
   and coalesce(d.terms->>'practice','false')<>'true' and s.state='complete'
   and s.result->'financialCheck'->>'status'='eligible'
   and s.completed_at between now()-interval '24 hours' and now()
   and (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '24 hours' and now()
   and t.party='seller' and t.recipient=p_phone and t.retired_at is null
   and not t.paused and not t.manual_only and t.ai_mode='auto'
   and m.direction='outgoing' and m.state='ready' and m.provider_id is null
   and not exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||m.id)
   and public.icash_seller_sms_permission_current(p_account,t.id,false)
   and public.icash_sms_message_route_current(p_account,m.id)
   and not public.icash_seller_sms_inquiry_window(p_account,t.id)
   and extract(hour from now() at time zone t.timezone) not between 9 and 19
 );
$$;
revoke all on function public.icash_seller_sms_waiting_window(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_sms_waiting_window(uuid,uuid,text) to service_role;

-- Keep missing queues, stale research, uncertain attempts and overdue calls
-- visible. Exclude only the SMS side of the missing-start finding while the
-- existing, otherwise eligible text is waiting outside its contact hours.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_undispatched_outreach_findings()'::regprocedure);
 needle:=$old$     and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null))$old$;
 if position(needle in definition)=0 then raise exception 'Seller SMS monitoring prerequisite changed';end if;
 execute replace(definition,needle,$new$     and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null)
    and not public.icash_seller_sms_waiting_window(r.account_id,r.screening_id,l.phone))$new$);
end $patch$;
commit;
