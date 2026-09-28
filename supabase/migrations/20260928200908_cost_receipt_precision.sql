-- Provider JSON numbers pass through IEEE-754 clients. Compare USD receipts at our ledger's micro-dollar precision.
-- Keep the original observed amount; never overwrite evidence to make a retry succeed.
create or replace function public.icash_record_cost_observation(p_provider text,p_event text,p_source text,p_amount numeric,p_units text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.icash_cost_observations; same_amount boolean;
begin
 if p_provider is null or trim(p_provider)='' or p_event is null or trim(p_event)='' or p_source is null or trim(p_source)='' or p_units is null or trim(p_units)='' or p_amount<0 or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid cost observation'; end if;
 insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values(p_provider,p_event,p_source,p_amount,p_units) on conflict do nothing;
 select * into o from public.icash_cost_observations where provider=p_provider and event_key=p_event;
 same_amount:=case when p_units='usd' then round(o.amount,6) is not distinct from round(p_amount,6) else o.amount is not distinct from p_amount end;
 if o.source_ref is distinct from p_source or o.units is distinct from p_units or not same_amount then raise exception 'Cost receipt conflict'; end if;
end $$;
revoke all on function public.icash_record_cost_observation(text,text,text,numeric,text) from public,anon,authenticated;
grant execute on function public.icash_record_cost_observation(text,text,text,numeric,text) to service_role;
