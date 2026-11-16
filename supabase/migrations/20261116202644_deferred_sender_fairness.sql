-- Let an original, unattempted deferred message reach the existing final claim
-- before this number queues another cold introduction. This is scheduling only.
-- The normal migration runner owns the transaction, including its history row.
set local lock_timeout='3s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;

do $guard$
declare r record;actual record;
begin
 if not exists(select 1 from public.icash_operating_budget where id=1) then
  raise exception 'Deferred sender budget prerequisite changed';end if;
 for r in select * from (values
  ('public.icash_queue_seller_opener(uuid,uuid)','edce56756856ac11b712557856dd9c4d'),
  ('public.icash_seller_opener_candidate_body(uuid,uuid)','e0cacbb59a32a4a7a03558fae1a06248'),
  ('public.icash_next_sender_volume_retry()','a71cf03b31a704c892478d23b2e1bafe')
 ) v(signature,expected) loop
  select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p where p.oid=r.signature::regprocedure;
  if md5(actual.definition) is distinct from r.expected
   or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
   or actual.prosecdef or actual.proconfig is distinct from array['search_path=""']::text[]
   or not has_function_privilege('service_role',actual.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
    where acl.privilege_type='EXECUTE' and (acl.grantee not in
     (actual.proowner,(select oid from pg_roles where rolname='service_role'))
     or (acl.grantee<>actual.proowner and acl.is_grantable))) then
   raise exception 'Deferred sender predecessor changed: %',r.signature;
  end if;
 end loop;
end $guard$;

alter table icash_sender_private.waiting add column last_selected_at timestamptz;
create index sender_volume_waiting_number on icash_sender_private.waiting(sender,queued_at);

-- Do not turn a stopped retry worker or a failed final claim into a permanent
-- sender hold. An overdue worker loses priority after one minute. A selected
-- message has thirty seconds to reach its ORIGINAL claim, then yields until its
-- next ordinary check. Actual dispatch deletes the waiting row as before.
create function icash_sender_private.waiting_turn(p_sender text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from icash_sender_private.waiting w
  join public.icash_text_messages m on m.id=w.message_id and m.account_id=w.account_id and m.thread_id=w.thread_id
  join public.icash_text_threads t on t.id=w.thread_id and t.account_id=w.account_id and t.sender=w.sender
  join public.icash_accounts a on a.id=w.account_id and not a.bot_paused
  where w.sender=p_sender and w.queued_at between now()-interval '24 hours' and now()-interval '1 minute'
   and w.next_check_at between now()-interval '1 minute' and now()+interval '5 minutes'
   and (w.last_selected_at is null or w.last_selected_at>now()-interval '30 seconds' or w.next_check_at<=now())
   and m.direction='outgoing' and m.state='ready' and m.provider_id is null and m.last_delivery_at is null
   and w.binding=icash_sender_private.message_binding(m,t.recipient)
   and t.retired_at is null and (w.claim_kind='manual' or (not t.paused and t.ai_mode='auto'))
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=t.recipient)
   and not exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||m.id)
   and not exists(select 1 from icash_sender_private.uses u where u.source='property' and u.source_id=m.id)
   and not exists(select 1 from public.icash_text_messages newer where newer.thread_id=t.id and newer.account_id=t.account_id
    and newer.id<>m.id and newer.created_at>=m.created_at and newer.id is distinct from icash_sender_private.reply_source(m,t))
 )
$$;
revoke all on function icash_sender_private.waiting_turn(text) from public,anon,authenticated;
grant execute on function icash_sender_private.waiting_turn(text) to service_role;

do $patch$
declare r record;definition text;
begin
 for r in select * from (values
  ('public.icash_queue_seller_opener(uuid,uuid)',
   'if not found or (not icash_sender_private.requested_introduction(t) and not icash_text_receipt_private.sender_opener_available(t.sender))',
   'if not found or (not icash_sender_private.requested_introduction(t) and icash_sender_private.waiting_turn(t.sender)) or (not icash_sender_private.requested_introduction(t) and not icash_text_receipt_private.sender_opener_available(t.sender))'),
  ('public.icash_seller_opener_candidate_body(uuid,uuid)',
   'if not found or not icash_text_receipt_private.sender_opener_available(t.sender)',
   'if not found or icash_sender_private.waiting_turn(t.sender) or not icash_text_receipt_private.sender_opener_available(t.sender)'),
  ('public.icash_next_sender_volume_retry()',
   'set next_check_at=now()+interval ''5 minutes'' where message_id=w.message_id;',
   'set next_check_at=now()+interval ''5 minutes'',last_selected_at=null where message_id=w.message_id;'),
  ('public.icash_next_sender_volume_retry()',
   'return jsonb_build_object(''accountId'',w.account_id,''messageId'',w.message_id,''claimKind'',w.claim_kind);',
   'update icash_sender_private.waiting set last_selected_at=clock_timestamp() where message_id=w.message_id;'||chr(10)||
   '  return jsonb_build_object(''accountId'',w.account_id,''messageId'',w.message_id,''claimKind'',w.claim_kind);')
 ) v(signature,needle,replacement) loop
  definition:=pg_get_functiondef(r.signature::regprocedure);
  if (length(definition)-length(replace(definition,r.needle,'')))/length(r.needle)<>1 then
   raise exception 'Deferred sender patch boundary changed: %',r.signature;
  end if;
  execute replace(definition,r.needle,r.replacement);
 end loop;
end $patch$;
