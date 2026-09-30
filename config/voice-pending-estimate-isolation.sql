-- Voice usage collector owns voice retry fairness timestamps.
CREATE OR REPLACE FUNCTION public.icash_settle_pending_estimates(p_account uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o record;finished integer:=0;held integer:=0;
begin
 if p_limit not between 1 and 100 then raise exception 'Invalid batch';end if;
 for o in select s.operation_key from public.icash_operation_spend s where s.state='dispatched' and (p_account is null or s.account_id=p_account) and exists(select 1 from public.icash_operation_rates r where r.id=s.rate_id and r.operation not in ('seller_call','buyer_call','incoming_call')) order by s.estimate_checked_at nulls first,s.dispatched_at limit p_limit loop
 begin
 if public.icash_settle_estimated_operation(o.operation_key) then finished:=finished+1;else held:=held+1;end if;
 exception when others then held:=held+1;
 end;
 update public.icash_operation_spend set estimate_checked_at=now() where operation_key=o.operation_key;
 end loop;
 return jsonb_build_object('settled',finished,'held',held,'costBasis','estimated');
end $function$
;
