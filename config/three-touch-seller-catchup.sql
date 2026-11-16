-- Recover omitted unanswered reminders from actual delivered messages, in
-- bounded cursor pages. Never resend old messages or renew expired evidence.
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
alter table icash_seller_recovery_private.unanswered_policy
 add column text_scan_at timestamptz,add column text_scan_id uuid,
 add constraint three_touch_text_cursor check((text_scan_at is null)=(text_scan_id is null));
grant update(text_scan_at,text_scan_id) on icash_seller_recovery_private.unanswered_policy to service_role;
create index icash_seller_delivered_catchup_cursor on public.icash_text_messages(created_at,id)
 where direction='outgoing' and state='delivered' and provider_id is not null;

create function public.icash_prepare_unanswered_seller_texts() returns integer
language plpgsql security invoker set search_path='' as $fn$
declare candidate record;t public.icash_text_threads;created integer:=0;visited boolean:=false;gap uuid;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return 0;end if;
 if not exists(select 1 from icash_seller_recovery_private.unanswered_policy where id=1 and enabled and three_touch_enabled) then return 0;end if;
 for candidate in select m.id,m.account_id,m.thread_id,m.created_at,m.last_delivery_at,m.body
  from public.icash_text_messages m cross join icash_seller_recovery_private.unanswered_policy p
  where p.id=1 and m.direction='outgoing' and m.state='delivered' and m.provider_id is not null
   and m.created_at between now()-interval '7 days' and now()-interval '4 hours'
   and (p.text_scan_at is null or (m.created_at,m.id)>(p.text_scan_at,p.text_scan_id))
  order by m.created_at,m.id limit 40
 loop
  visited:=true;
  update icash_seller_recovery_private.unanswered_policy set text_scan_at=candidate.created_at,text_scan_id=candidate.id where id=1;
  select * into t from public.icash_text_threads where id=candidate.thread_id and account_id=candidate.account_id
   and party='seller' and operational_contact_id is not null and retired_at is null and not paused and not manual_only and ai_mode='auto';
  if not found or not exists(select 1 from public.icash_accounts where id=t.account_id and not bot_paused)
   or not exists(select 1 from public.icash_wallets where account_id=t.account_id and balance_cents>reserved_cents)
   or not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=t.account_id and stage='draft' and coalesce(terms->>'practice','false')<>'true')
   or exists(select 1 from public.icash_seller_gaps where source='text' and source_id=candidate.id and reason='no_response')
   or exists(select 1 from public.icash_text_messages m where m.thread_id=t.id and m.account_id=t.account_id
    and (m.created_at,m.id)>(candidate.created_at,candidate.id) and (m.direction='incoming' or m.state in ('ready','dispatching','accepted','delivered','needs_review')))
   or public.icash_seller_text_cadence_current(t.account_id,t.id,null,true) is not true then continue;end if;
  if coalesce(candidate.body,'') not like '%?%' and not exists(select 1 from public.icash_seller_recovery_attempts a
   where a.message_id=candidate.id and a.account_id=t.account_id and a.thread_id=t.id and a.reason='no_response') then continue;end if;
  gap:=public.icash_open_seller_gap(t.account_id,t.id,'text',candidate.id,'no_response','No reply to delivered question',coalesce(candidate.last_delivery_at,candidate.created_at));
  if gap is not null then created:=created+1;end if;
 end loop;
 if not visited then update icash_seller_recovery_private.unanswered_policy set text_scan_at=null,text_scan_id=null where id=1;end if;
 return created;
end $fn$;
revoke all on function public.icash_prepare_unanswered_seller_texts() from public,anon,authenticated;
grant execute on function public.icash_prepare_unanswered_seller_texts() to service_role;
do $patch$
declare d text;old text:=' for candidate in';
begin
 d:=pg_get_functiondef('public.icash_queue_unanswered_seller_calls()'::regprocedure);
 if (length(d)-length(replace(d,old,'')))<>length(old) or position('policy.three_touch_enabled' in d)=0 then raise exception 'Three-touch catch-up queue prerequisite changed';end if;
 execute replace(d,old,' perform public.icash_prepare_unanswered_seller_texts();'||E'\n'||old);
end $patch$;
