-- Meta intake must use the same verified parallel capacity policy as other calls.
-- Receipt reconciliation on an ended call must not freeze unrelated recipients.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;needle text:=$old$ if exists(select 1 from public.icash_voice_jobs v
  left join public.icash_voice_contact_targets t on t.id=coalesce(v.permission_id,v.operational_contact_id)
  where v.id<>j.id and (v.state in ('issued','dispatching')
   or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))
   and (v.account_id=m.account_id or t.contact_key=p.contact_key))
  or exists(select 1 from public.icash_live_conversations
   where state in ('waiting','review') and (account_id=m.account_id or contact_key=p.contact_key)) then return null;end if;$old$;
begin
 definition:=pg_get_functiondef('public.icash_meta_prepare_voice(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Meta voice capacity prerequisite changed';end if;
 execute replace(definition,needle,' if not public.icash_voice_queue_slot_open(m.account_id,j.id) then return null;end if;');
end $patch$;
commit;
