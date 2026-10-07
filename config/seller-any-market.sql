-- Inbound seller requests do not require a customer-selected market.
-- Keep property/state verification, paid-operation and contact safety gates unchanged.
do $patch$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle := $needle$ join public.icash_bot_setups bs on bs.account_id=ac.id
$needle$;
 if position(needle in definition)=0 then raise exception 'Inbound market prerequisite changed';end if;
 definition:=replace(definition,needle,'');
 needle := $needle$ and (bs.profile->>'marketMode'='nationwide' or lower(trim(bs.profile->>'market')) in (city_name,city_name||', '||lower(state_code),l.property->>'zip'))
$needle$;
 if position(needle in definition)=0 then raise exception 'Inbound market prerequisite changed';end if;
 definition:=replace(definition,needle,'');
 execute definition;
end $patch$;

