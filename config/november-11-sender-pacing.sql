-- Extend the existing 200/day, 20/hour, three-minute and daytime policy.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $pacing$
declare signature text;definition text;
 needle text:=$old$'+15127791343')$old$;
 replacement text:=$new$'+15127791343','+16027722055','+14357242174')$new$;
begin
 foreach signature in array array[
  'icash_sender_private.november_room(text,boolean,timestamptz)',
  'icash_sender_private.room(text,boolean,uuid,text)']
 loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'November 11 sender pacing boundary changed: %',signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $pacing$;
commit;
