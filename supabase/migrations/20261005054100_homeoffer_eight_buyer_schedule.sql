-- Three immediate assignments, then one additional buyer per day, capped at eight.
-- Match creation remains atomic, unique per account, and subject to available credits.
create function public.icash_seller_assignment_due(p_completed integer,p_first timestamptz,p_now timestamptz) returns timestamptz language sql immutable security invoker set search_path='' as $$
 select case when p_completed>=8 then 'infinity'::timestamptz when p_completed<3 then p_now
 else greatest(p_now+interval '24 hours',p_first+(p_completed-2)*interval '24 hours') end
$$;
revoke all on function public.icash_seller_assignment_due(integer,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_seller_assignment_due(integer,timestamptz,timestamptz) to service_role;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_assign_seller_lead()'::regprocedure);
 needle:='m.lead_id=icash_seller_intakes.id)<10';
 if position(needle in definition)=0 then raise exception 'Seller assignment cap changed';end if;
 definition:=replace(definition,needle,'m.lead_id=icash_seller_intakes.id)<8');
 needle:=$old$'maximumBuyers',10$old$;
 if position(needle in definition)=0 then raise exception 'Seller sharing metadata changed';end if;
 definition:=replace(definition,needle,$new$'maximumBuyers',8$new$);
 needle:=$old$case when match_count+1<3 then now()+interval '20 minutes' else greatest(now()+interval '20 minutes',coalesce(assigned_at,now())+((match_count+1-3)/2+1)*interval '24 hours') end$old$;
 if position(needle in definition)=0 then raise exception 'Seller assignment schedule changed';end if;
 definition:=replace(definition,needle,'public.icash_seller_assignment_due(match_count+1,coalesce(assigned_at,now()),now())');
 definition:=replace(definition,'-- Pace genuine matching; the first 3 are at least 20 minutes apart, then','-- Three immediate matches; additional buyers are spread over subsequent days.');
 definition:=replace(definition,'-- expand by 2 per day up to 10. This never simulates buyers or contact.','-- Cap at eight actual buyers. This never simulates buyers or contact.');
 execute definition;
end $patch$;
