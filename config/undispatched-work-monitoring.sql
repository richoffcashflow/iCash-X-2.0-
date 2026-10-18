begin;
set local lock_timeout='5s';
-- Observe the handoff before dispatch, not only failures after a provider call.
-- This function cannot approve, queue, retry or send anything.
create function public.icash_undispatched_outreach_findings()
returns table(kind text,resource_id uuid,account_id uuid,since timestamptz)
language sql stable security invoker set search_path='' as $$
 with running as materialized (
  select a.id from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
  where not a.bot_paused and w.balance_cents>0 and public.icash_membership_work_allowed(a.id)
   and not exists(select 1 from public.icash_billing_reviews b where b.account_id=a.id and b.resolved_at is null)
 )
 select 'seller_response'::text,r.screening_id,r.account_id,r.created_at
 from public.icash_seller_responses r join running a on a.id=r.account_id
 join public.icash_seller_intakes l on l.id=r.lead_id
 join public.icash_screening_jobs s on s.id=r.screening_id and s.account_id=r.account_id and s.state='complete'
 left join public.icash_deal_files d on d.screening_id=r.screening_id and d.account_id=r.account_id
 where r.state in ('pending','needs_setup','queued') and r.created_at<now()-interval '5 minutes'
  and coalesce(d.stage='draft',true) and coalesce(d.terms->>'practice','false')<>'true'
  and not exists(select 1 from public.icash_property_controls pc where pc.account_id=r.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
  and not exists(select 1 from public.icash_handoffs h where h.account_id=r.account_id and h.screening_id=r.screening_id and h.state<>'resolved')
  and not exists(select 1 from public.icash_text_suppressions x where x.phone=l.phone)
  and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex'))
  and not exists(select 1 from public.icash_text_threads t where t.account_id=r.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone and t.retired_at is null and (t.manual_only or t.ai_mode<>'auto' or (t.paused and not t.sms_intake_pending)))
  and (
   (public.icash_outreach_sms_current(r.account_id) and not exists(
    select 1 from public.icash_text_threads t join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
    where t.account_id=r.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone and t.retired_at is null
     and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null))
   or (public.icash_outreach_voice_current(r.account_id) and not exists(
    select 1 from public.icash_voice_jobs v join public.icash_contact_permissions p on p.id=v.permission_id and p.account_id=v.account_id
    where v.account_id=r.account_id and p.screening_id=r.screening_id and p.phone=l.phone and v.callback_id is null
     and ((v.state='dispatched' and v.provider_call_sid is not null) or (v.state='ready' and v.due_at>now()))))
  )
 union all
 select 'buyer_fulfillment',j.id,j.account_id,j.updated_at
 from public.icash_fulfillment_jobs j join running a on a.id=j.account_id
 where j.state in ('ready','issued') and j.updated_at<now()-interval '10 minutes'
  and public.icash_buyer_outreach_running(j.account_id,j.deal_id);
$$;
revoke all on function public.icash_undispatched_outreach_findings() from public,anon,authenticated;
grant execute on function public.icash_undispatched_outreach_findings() to service_role;

-- Version the refresh entry point so the new issue kinds start only after the
-- application that understands them deploys. Existing receipt reconciliation,
-- private snapshots and the bounded shared cache remain intact.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_reliability_snapshot()'::regprocedure);
 needle:='CREATE OR REPLACE FUNCTION public.icash_refresh_reliability_snapshot()';
 if position(needle in definition)=0 then raise exception 'Reliability entry point changed';end if;
 definition:=replace(definition,needle,'CREATE OR REPLACE FUNCTION public.icash_refresh_outreach_reliability_snapshot()');
 needle:=$old$ ), texts as ($old$;
 if position(needle in definition)=0 then raise exception 'Reliability findings prerequisite changed';end if;
 execute replace(definition,needle,$new$ union all select kind,resource_id,account_id,since from public.icash_undispatched_outreach_findings()
 ), texts as ($new$);
end $patch$;
revoke all on function public.icash_refresh_outreach_reliability_snapshot() from public,anon,authenticated;
grant execute on function public.icash_refresh_outreach_reliability_snapshot() to service_role;
commit;
