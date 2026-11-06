-- A review is saved in the same transaction as its customer-visible reply.
-- Old app versions send ordinary statuses. An older DB rejects the new status
-- before saving a reply, so the app cannot announce an unrecorded handoff.
do $review$
declare patch record; definition text;
begin
 perform set_config('lock_timeout','3s',true);
 for patch in select * from (values
  ('icash_support_finish_conversation(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)',
   $$p_status not in ('open','waiting_on_customer','escalated','resolved','closed')$$,
   $$p_status not in ('open','waiting_on_customer','escalated','resolved','closed','management_review')$$),
  ('icash_support_finish_conversation(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)',
   $$role in ('operator','user') and (created_at,id)>(m.created_at,m.id)$$,
   $$(role in ('operator','user') or (role='system' and actor_user_id is not null)) and (created_at,id)>(m.created_at,m.id)$$),
  ('icash_support_finish_conversation(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)',
   $$case when p_status='escalated' then 'open' else p_status end$$,
   $$case when p_status='management_review' or t.status='escalated' then 'escalated' when p_status='escalated' then 'open' else p_status end$$),
  ('icash_access_help_finish_reply(uuid,uuid,uuid,text,text,boolean)',
   $$p_status not in ('open','waiting_on_customer','resolved','closed') or p_handoff is null$$,
   $$p_status not in ('open','waiting_on_customer','resolved','closed','management_review') or p_handoff is null or (p_status='management_review' and not p_handoff)$$),
  ('icash_access_help_finish_reply(uuid,uuid,uuid,text,text,boolean)',
   $$if exists(select 1 from public.icash_access_help_messages where request_id=p_id and role in ('user','operator')$$,
   $$if exists(select 1 from public.icash_access_help_updates where request_id=p_id and created_at>=m.created_at)
      or exists(select 1 from public.icash_access_help_messages where request_id=p_id and role in ('user','operator')$$),
  ('icash_access_help_finish_reply(uuid,uuid,uuid,text,text,boolean)',
   $$set status=p_status,needs_operator=false,updated_at=now()$$,
   $$set status=case when p_status='management_review' or r.needs_operator then 'open' else p_status end,
       needs_operator=(p_status='management_review' or r.needs_operator),updated_at=now()$$),
  ('icash_access_help_read_browser(text)',
   $$'status',r.status,$$,
   $$'status',r.status,'managementReview',r.needs_operator,$$),
  ('icash_access_help_operator_update(uuid,uuid,uuid,text,text)',
   $$set status=p_status,updated_at=now()$$,
   $$set status=p_status,needs_operator=false,updated_at=now()$$)
 ) as edits(signature,needle,replacement)
 loop
  definition:=pg_get_functiondef(('public.'||patch.signature)::regprocedure);
  if (length(definition)-length(replace(definition,patch.needle,'')))/length(patch.needle)<>1 then
   raise exception 'Support management review predecessor changed: %',patch.signature;
  end if;
  execute replace(definition,patch.needle,patch.replacement);
 end loop;
end $review$;
