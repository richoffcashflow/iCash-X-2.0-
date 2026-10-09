begin;
set local lock_timeout='3s';
-- Completed usage is billed downstream; legacy reservations do not withhold credits.
create or replace function public.icash_next_automation() returns jsonb
language plpgsql security definer set search_path='' as $$
declare prior jsonb;g public.icash_seller_gaps;mid uuid;ticket public.icash_automation_tickets;f public.icash_seller_viewing_followups;
begin
 perform pg_advisory_xact_lock(726341927);
 update public.icash_seller_gaps set state='needs_review',updated_at=now() where state in ('open','queued','waiting') and expires_at<=now();
 prior:=public.icash_next_before_seller_recovery();if prior->>'token' is not null then return prior;end if;
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled) then return prior;end if;
 if exists(select 1 from public.icash_automation_tickets where kind='seller_recovery' and created_at>now()-interval '1 minute') then return prior;end if;
 for f in select followup.* from public.icash_seller_viewing_followups followup join public.icash_text_threads t on t.id=followup.buyer_thread_id and t.account_id=followup.account_id
  join public.icash_accounts a on a.id=followup.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>0
  join pg_timezone_names tz on tz.name=t.timezone
  where followup.outgoing_id is null and followup.created_at>now()-interval '7 days' and extract(hour from now() at time zone tz.name) between 9 and 19
  order by followup.created_at for update of followup skip locked limit 20 loop
  mid:=public.icash_prepare_viewing_relay(f.request_id);
  if mid is not null then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(f.account_id,'seller_recovery',mid) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
 end loop;
 for g in select gap.* from public.icash_seller_gaps gap join public.icash_text_threads t on t.id=gap.thread_id and t.account_id=gap.account_id
  join public.icash_accounts a on a.id=gap.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>0
  join pg_timezone_names tz on tz.name=t.timezone
  where gap.state='open' and gap.due_at<=now() and gap.expires_at>now() and extract(hour from now() at time zone tz.name) between 9 and 19
  order by gap.due_at for update of gap skip locked limit 20 loop
  mid:=public.icash_prepare_seller_recovery(g.account_id,g.id);
  if mid is not null then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(g.account_id,'seller_recovery',mid) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
  update public.icash_seller_gaps set due_at=now()+interval '1 hour',updated_at=now() where id=g.id and state='open';
 end loop;
 return prior;
end $$;
commit;
