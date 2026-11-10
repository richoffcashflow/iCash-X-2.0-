-- Apply the existing 200/day, 20/hour, three-minute and daytime policy to the new leases.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $pacing$
declare signature text;definition text;
 needle text:=$old$'+16462959838','+18623812530','+17866727869','+16462494809')$old$;
 replacement text:=$new$'+16462959838','+18623812530','+17866727869','+16462494809','+15056019451','+15055072937','+15127791343')$new$;
begin
 foreach signature in array array[
  'icash_sender_private.november_room(text,boolean,timestamptz)',
  'icash_sender_private.room(text,boolean,uuid,text)']
 loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'Additional sender pacing boundary changed: %',signature;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $pacing$;
commit;
