-- Clarification authority limits the subject of the call, not its duration.
-- Preserve existing operation bounds, prices, financial holds and admission.
begin;
set local lock_timeout='2s';
do $patch$
declare definition text;
 old_loop text:='for seconds in reverse (case when public.icash_seller_limited_contact(p_account,p.screening_id) then 120 else 600 end)..120 by 60 loop';
 new_loop text:='for seconds in reverse 600..120 by 60 loop';
begin
 definition:=pg_get_functiondef('public.icash_reserve_flexible_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 if position(old_loop in definition)>0 then
  if (length(definition)-length(replace(definition,old_loop,'')))/length(old_loop)<>1 then raise exception 'Ambiguous clarification duration prerequisite';end if;
  execute replace(definition,old_loop,new_loop);
 elsif position(new_loop in definition)=0 then
  raise exception 'Clarification duration prerequisite changed';
 end if;
end $patch$;
commit;
