-- These POST RPCs call the owner demo permission check, which retains its
-- SELECT FOR SHARE protection. PostgREST runs STABLE functions read-only even
-- for POST, so each entry point must accurately declare VOLATILE behavior.
-- Only function metadata changes: preserve bodies, privileges and every gate.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $guard$
declare signature text;definition text;
begin
 foreach signature in array array[
  'public.icash_voice_outreach_context(uuid,uuid)',
  'public.icash_voice_outreach_hours_current(uuid,uuid)',
  'public.icash_seller_phone_call_current(uuid,uuid)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('public.icash_owner_demo_call_current(' in definition)=0 then
   raise exception 'Owner demo RPC prerequisite changed: %',signature;
  end if;
  execute 'alter function '||signature||' volatile';
 end loop;
end $guard$;
notify pgrst,'reload schema';
commit;
