-- Requested seller introductions are warm contact, not new cold outreach.
-- This classification never replaces the existing consent/route/money claim.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function icash_sender_private.requested_introduction(t public.icash_text_threads)
returns boolean language sql stable set search_path='' as $$
 select coalesce((t.party='seller' and t.seller_intake_id is not null and t.operational_contact_id is null
 and t.retired_at is null and not t.paused and not t.manual_only and t.ai_mode='auto'
 and t.permission_until>now() and nullif(t.permission_evidence,'') is not null
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
 and exists(select 1 from public.icash_seller_intakes i
  join public.icash_seller_matches sm on sm.lead_id=i.id and sm.account_id=t.account_id
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=sm.account_id and d.screening_id=sm.screening_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  where i.id=t.seller_intake_id and i.phone=t.recipient and i.ai_consented and i.state='assigned'
   and s.snapshot->'sellerRequest'->>'id'=i.id::text
   and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true')),false)
$$;
revoke all on function icash_sender_private.requested_introduction(public.icash_text_threads) from public,anon,authenticated;
grant execute on function icash_sender_private.requested_introduction(public.icash_text_threads) to service_role;
do $patch$
declare d text;signature text;needle text;replacement text;
begin
 for signature,needle,replacement in values
 ('public.icash_queue_seller_opener(uuid,uuid)',
  'not icash_text_receipt_private.sender_opener_available(t.sender) or not icash_sender_private.room(t.sender,true,t.account_id,icash_sender_private.cohort(t.account_id,t.id))',
  '(not icash_sender_private.requested_introduction(t) and not icash_text_receipt_private.sender_opener_available(t.sender)) or not icash_sender_private.room(t.sender,not coalesce(icash_sender_private.requested_introduction(t),false),t.account_id,icash_sender_private.cohort(t.account_id,t.id))'),
 ('icash_sender_private.transactional(public.icash_text_messages,public.icash_text_threads)',
  ' or exists(select 1 from public.icash_cancellation_notices',
  E' or (icash_sender_private.requested_introduction(t) and m.account_id=t.account_id and m.thread_id=t.id and m.direction=''outgoing'' and m.request_key=t.id\n   and exists(select 1 from public.icash_seller_opener_assignments a where a.account_id=t.account_id and a.thread_id=t.id and a.message_id=m.id and a.body=m.body)\n   and exists(select 1 from public.icash_sms_seller_openings o where o.account_id=t.account_id and o.thread_id=t.id and o.owner_question_id=m.id))\n or exists(select 1 from public.icash_cancellation_notices')
 loop
  d:=pg_get_functiondef(signature::regprocedure);
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Requested seller prerequisite changed: %',signature;end if;
  execute replace(d,needle,replacement);
 end loop;
end $patch$;
-- Preserve all counters, total capacity, customer controls and original receipts.
-- No historical messages are queued or replayed by this migration.
commit;
