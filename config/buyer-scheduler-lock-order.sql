begin;
set local lock_timeout='5s';
-- Signature completion also calls this scheduler while holding its deal row.
-- Scheduling must remain a read-only eligibility scan plus a queue update;
-- acquiring the spend/contact locks here would invert final dispatch's order.
-- Preparation and final send claims still perform the complete locked checks.
create or replace function public.icash_queue_fulfillment() returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_queue_fulfillment_before_automatic_buyers();
 update public.icash_fulfillment_jobs j set state='ready',updated_at=now()
 where j.state='complete' and j.updated_at<now()-interval '5 minutes'
 and public.icash_buyer_outreach_running(j.account_id,j.deal_id)
 and (exists(select 1 from public.icash_buyer_package_email_targets(j.account_id,j.deal_id))
  or (public.icash_outreach_sms_current(j.account_id) and exists(select 1 from public.icash_text_threads t
   where t.account_id=j.account_id and t.deal_id=j.deal_id and t.party='buyer'
   and t.retired_at is null and to_jsonb(t)->>'owner_buyer_test_id' is null and not t.manual_only
   and t.ai_mode='auto' and (not t.paused or t.sms_intake_pending) and t.permission_until>now()
   and exists(select 1 from public.icash_authority_review_requests r join pg_timezone_names z on z.name=t.timezone
    where r.id=t.sms_review_request_id and r.account_id=t.account_id and r.state='approved' and r.expires_at>now()
    and r.payload->>'channel'='sms' and r.payload->>'party'='buyer' and r.payload->>'phone'=t.recipient
    and extract(hour from now() at time zone z.name)>=greatest(9,(r.payload->>'localStartHour')::integer)
    and extract(hour from now() at time zone z.name)<least(20,(r.payload->>'localEndHour')::integer))
   and not exists(select 1 from public.icash_buyer_package_texts p join public.icash_text_messages m on m.id=p.message_id where p.thread_id=t.id and m.state<>'ready'))));
end $$;
revoke all on function public.icash_queue_fulfillment() from public,anon,authenticated;
grant execute on function public.icash_queue_fulfillment() to service_role;
commit;
