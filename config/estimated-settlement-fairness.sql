alter table public.icash_operation_spend add column estimate_checked_at timestamptz;
create or replace function public.icash_settle_pending_estimates(p_account uuid default null,p_limit integer default 25) returns jsonb language plpgsql set search_path='' as $$
declare o record;finished integer:=0;held integer:=0;
begin
 if p_limit not between 1 and 100 then raise exception 'Invalid batch';end if;
 for o in select operation_key from public.icash_operation_spend where state='dispatched' and (p_account is null or account_id=p_account) order by estimate_checked_at nulls first,dispatched_at limit p_limit loop
 begin
 if public.icash_settle_estimated_operation(o.operation_key) then finished:=finished+1;else held:=held+1;end if;
 exception when others then held:=held+1;
 end;
 update public.icash_operation_spend set estimate_checked_at=now() where operation_key=o.operation_key;
 end loop;
 return jsonb_build_object('settled',finished,'held',held,'costBasis','estimated');
end $$;

do $$ declare d text;begin
d:=pg_get_functiondef('public.icash_settle_estimated_operation(text)'::regprocedure);
d:=replace(d,'''sent'',''customer_signature_needed'',''completed''','''awaiting_counterparty'',''customer_signature_needed'',''completed''');execute d;end $$;
