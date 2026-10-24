-- Exclude existing and inadmissible conversations before costly SMS checks.
-- Repeat the original cheap predicates at the locked read so concurrent changes
-- retain their original recheck behavior. Admission, cadence and receipts stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;
 original text:=$original$ select t.* into thread from public.icash_text_threads t
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
 order by t.id for update of t skip locked limit 1$original$;
 replacement text:=$replacement$ with candidates as materialized (
 select t.id,t.account_id from public.icash_text_threads t
 join public.icash_accounts a on a.id=t.account_id and not a.bot_paused
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=t.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
 join public.icash_timezone_names zone on zone.name=t.timezone
 where t.party='seller' and not t.paused and t.ai_mode='auto'
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 )
 select t.* into thread from candidates candidate join public.icash_text_threads t on t.id=candidate.id and t.account_id=candidate.account_id
 join public.icash_accounts a on a.id=t.account_id and not a.bot_paused
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=t.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
 join public.icash_timezone_names zone on zone.name=t.timezone
 where t.party='seller' and not t.paused and t.ai_mode='auto' and public.icash_sms_thread_dispatch_until(candidate.account_id,candidate.id)>now()
 and public.icash_sms_outreach_window_current(candidate.account_id,candidate.id)
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 order by t.id for update of t skip locked limit 1$replacement$;
begin
 definition:=pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure);
 if (length(definition)-length(replace(definition,original,'')))<>length(original) then
  raise exception 'Legacy SMS candidate prerequisite changed';
 end if;
 execute replace(definition,original,replacement);
end $migration$;
commit;

