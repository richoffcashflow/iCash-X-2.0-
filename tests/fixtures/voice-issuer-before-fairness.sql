-- Exact installed issuer captured read-only on 2026-10-19, after Meta serialization.
CREATE OR REPLACE FUNCTION public.icash_next_before_fulfillment()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;t public.icash_automation_tickets;last_voice timestamptz;
begin
 perform public.icash_queue_voice_jobs();
 select last_dispatch_at into last_voice from public.icash_voice_scheduler where id=1 for update;
 if (last_voice is null or last_voice<now()-interval '30 seconds') and exists(select 1 from public.icash_operating_budget where id=1 and enabled) then
 select v.* into j from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 where v.state='ready' and v.due_at<=now()
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 order by v.due_at for update of v skip locked limit 1;
 if found then
 update public.icash_voice_scheduler set last_dispatch_at=now() where id=1;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,voice_job_id) values(j.account_id,'voice_dispatch',j.id) returning * into t;return jsonb_build_object('token',t.token);
 end if;end if;
 return public.icash_next_before_voice_dispatch();
end $function$
