CREATE OR REPLACE FUNCTION public.icash_next_before_sms_inbound_campaign()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior jsonb;thread public.icash_text_threads;message uuid;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 prior:=public.icash_next_before_seller_openers();
 if prior->>'token' is not null then return prior;end if;
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled) then return prior;end if;
 if exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '5 seconds') then return prior;end if;
 select t.* into thread from public.icash_text_threads t
 join public.icash_accounts a on a.id=t.account_id and not a.bot_paused
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=t.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
 join public.icash_timezone_names zone on zone.name=t.timezone
 where t.party='seller' and not t.paused and t.ai_mode='auto' and public.icash_sms_thread_dispatch_until(t.account_id,t.id)>now()
 and public.icash_sms_outreach_window_current(t.account_id,t.id)
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 order by t.id for update of t skip locked limit 1;
 if not found then return prior;end if;
 message:=public.icash_queue_seller_opener(thread.account_id,thread.id);
 if message is null then return prior;end if;
 insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(thread.account_id,'seller_opener',message) returning * into ticket;
 return jsonb_build_object('token',ticket.token);
end $function$

;
