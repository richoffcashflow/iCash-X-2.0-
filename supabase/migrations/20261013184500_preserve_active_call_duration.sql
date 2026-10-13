-- Preserve reviewed normal-call limits on positive credits. Actual usage is
-- still billed once; existing authorizations and limited intake stay intact.
begin;
set local lock_timeout='5s';

do $outbound$
declare definition text;
 old_condition text:='if price<=capacity or seconds=120 then';
begin
 definition:=pg_get_functiondef('public.icash_reserve_flexible_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 if position(old_condition in definition)=0 then raise exception 'Outbound duration prerequisite changed';end if;
 -- The existing loop starts at 600 for normal calls, 120 for limited intake.
 -- Take that reviewed limit; never search for a shorter wallet-based timeout.
 execute replace(definition,old_condition,'if price>0 then');
end $outbound$;

do $inbound$
declare signature text;definition text;
 old_loop text:='for seconds in reverse 600..120 by 60 loop';
 old_condition text:='if price>0 and price<=c.charge_cap_cents and (price<=capacity or seconds=120) then';
begin
 foreach signature in array array[
  'public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text)',
  'public.icash_reserve_flexible_reception(uuid,text,text,text,text,text,text,text,text,text,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position(old_loop in definition)=0 or position(old_condition in definition)=0 then raise exception 'Inbound duration prerequisite changed: %',signature;end if;
  -- Normal calls must fit the reviewed rate at the full configured duration.
  -- Preserve the price check, zero-credit gate, VIP pricing and all other gates.
  definition:=replace(definition,old_loop,'for seconds in reverse 600..600 by 60 loop');
  execute replace(definition,old_condition,'if price>0 and price<=c.charge_cap_cents then');
 end loop;
end $inbound$;

commit;
