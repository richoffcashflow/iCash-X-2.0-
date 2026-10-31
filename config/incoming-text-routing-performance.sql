begin;
set local lock_timeout='2s';
-- The routing function is VOLATILE because it reads current conversation state.
-- A call inside a row predicate is evaluated for every thread, making incoming
-- ingestion quadratic as the platform grows. Resolve once under the existing
-- locks, then use the primary key. Preserve the resolver and all receipt guards.
do $patch$
declare definition text;
old_declaration constant text:='stamp timestamptz;';
new_declaration constant text:='stamp timestamptz;resolved_thread uuid;';
old_lookup constant text:=$old$select * into t from public.icash_text_threads where id=public.icash_sms_resolve_property(v->>'to',v->>'from',v->>'body');$old$;
new_lookup constant text:=$new$resolved_thread:=public.icash_sms_resolve_property(v->>'to',v->>'from',v->>'body');
 select * into t from public.icash_text_threads where id=resolved_thread;$new$;
begin
 definition:=pg_get_functiondef('public.icash_ingest_text_event_before_operational(jsonb,boolean)'::regprocedure);
 if position(new_lookup in definition)>0 then return;end if;
 if (length(definition)-length(replace(definition,old_lookup,'')))/length(old_lookup)<>1
 or (length(definition)-length(replace(definition,old_declaration,'')))/length(old_declaration)<>1 then
  raise exception 'Incoming text routing prerequisite changed';
 end if;
 execute replace(replace(definition,old_declaration,new_declaration),old_lookup,new_lookup);
end $patch$;
-- Existing account/deal indexes do not begin with the incoming number pair.
create index if not exists icash_text_threads_incoming_pair
 on public.icash_text_threads(sender,recipient) where retired_at is null;
commit;
