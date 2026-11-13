-- Extend the existing 200/day, 20/hour, three-minute and daytime policy.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $pacing$
declare signature text;definition text;
 needle text:=$old$'+14357242174')$old$;
 replacement text:=$new$'+14357242174','+17262035755','+17262060050')$new$;
begin
 foreach signature in array array[
  'icash_sender_private.november_room(text,boolean,timestamptz)',
  'icash_sender_private.room(text,boolean,uuid,text)']
 loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'November 13 sender pacing boundary changed: %',signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $pacing$;
commit;
