-- Exact-ID GET tracking is opt-in; keep the actual delivery timeline requirement.
-- Change only the verified URL, never saved evidence, schedules or attempt limits.
begin;
set local lock_timeout='2s';
do $patch$
declare
 definition text:=pg_get_functiondef('public.icash_finish_text_delivery_recheck(uuid,jsonb)'::regprocedure);
 needle text:=$needle$r->>'url'='https://api.contiguity.com/conversations/history/message/'||(job.request->>'provider_id')$needle$;
begin
 if md5(definition)<>'fa2a69813e8b693f3c89123da784e318' then
  raise exception 'Original canonical text receipt finalizer changed';
 end if;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Original canonical text URL prerequisite changed';
 end if;
 execute replace(definition,needle,needle||$query$||'?tracking=true'$query$);
end $patch$;
commit;
