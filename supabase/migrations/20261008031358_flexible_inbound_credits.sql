begin;
set local lock_timeout='2s';
-- A new incoming call may reserve a shorter duration from its existing reviewed
-- quote. Configs, historical rates, wallet balance and daily limits stay intact.
create table icash_recorded_reception_private.credit_bounds (
 operation_key text primary key check(operation_key ~ '^recorded-reception:CA[0-9a-fA-F]{32}$'),
 config_id uuid not null references icash_recorded_reception_private.configs(id),
 account_id uuid not null references public.icash_accounts(id),
 rate_id uuid not null references public.icash_operation_rates(id),
 max_seconds integer not null check(max_seconds between 120 and 600 and max_seconds%60=0),
 charge_cents bigint not null check(charge_cents>0),costs_micros jsonb not null,
 created_at timestamptz not null default now()
);
alter table icash_recorded_reception_private.credit_bounds enable row level security;
revoke all on icash_recorded_reception_private.credit_bounds from public,anon,authenticated,service_role;
create function icash_recorded_reception_private.guard_credit_bound() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Incoming call credit bounds are immutable';end $$;
create trigger reception_credit_bound_immutable before update or delete on icash_recorded_reception_private.credit_bounds for each row execute function icash_recorded_reception_private.guard_credit_bound();
create trigger reception_credit_bound_no_truncate before truncate on icash_recorded_reception_private.credit_bounds for each statement execute function icash_recorded_reception_private.guard_credit_bound();
create function public.icash_reception_credit_bound(p_account uuid,p_operation text,p_rate uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(b) from icash_recorded_reception_private.credit_bounds b
 join icash_recorded_reception_private.configs c on c.id=b.config_id and c.account_id=b.account_id and c.rate_id=b.rate_id
 where b.account_id=p_account and b.operation_key=p_operation and b.rate_id=p_rate
 and c.enabled and c.call_profile='normal' and c.max_total_seconds=600
 and b.max_seconds<=c.max_total_seconds and b.charge_cents<=c.charge_cap_cents
 and c.reviewed_until>now();
$$;
revoke all on function public.icash_reception_credit_bound(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_reception_credit_bound(uuid,text,uuid) to service_role;
alter table icash_recorded_reception_private.sessions drop constraint sessions_max_total_seconds_check;
alter table icash_recorded_reception_private.sessions add constraint sessions_max_total_seconds_check
 check(max_total_seconds=60 or (max_total_seconds between 120 and 600 and max_total_seconds%60=0));
-- Patch only the current layers, keeping all their other eligibility checks.
do $patch$
declare definition text;needle text;replacement text;pair text[];
begin
 definition:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=' if p_permission_until is null or p_permission_until<=now() then';
 if position(needle in definition)=0 then raise exception 'Incoming reserve prerequisite changed';end if;
 execute replace(definition,needle,$new$ if public.icash_reception_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_reception_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_reception_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
$new$||needle);
 definition:=pg_get_functiondef('public.icash_reserve_before_membership(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:='select coalesce((public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>''charge_cents'')::bigint,charge_cents) into charge';
 replacement:='select coalesce((public.icash_reception_credit_bound(p_account,p_operation,p_rate)->>''charge_cents'')::bigint,(public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>''charge_cents'')::bigint,charge_cents) into charge';
 if position(needle in definition)=0 then raise exception 'Incoming activation prerequisite changed';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_reserve_recorded_reception(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure);
 foreach pair slice 1 in array array[
  array['planned numeric;p icash_recorded_reception_private.cost_policies;', 'planned numeric;p icash_recorded_reception_private.cost_policies;capacity bigint;seconds integer;price bigint;parts jsonb;total numeric;funded_seconds integer;funded_price bigint;funded_costs jsonb;'],
  array[' begin
  perform public.icash_reserve_operation', $new$ begin
  funded_seconds:=c.max_total_seconds;funded_price:=c.charge_cap_cents;funded_costs:=r.costs_micros;
  if c.call_profile='normal' and c.max_total_seconds=600 then
   capacity:=(public.icash_daily_allowance(c.account_id)->>'remainingCents')::bigint;
   select least(capacity,greatest(0,a.customer_cap_cents-coalesce((select sum(case when state='settled' then charged_cents else charge_cap_cents end) from public.icash_operation_spend where account_id=c.account_id and state in ('reserved','dispatched','settled')),0))) into capacity
    from public.icash_spend_activations a where a.account_id=c.account_id and a.enabled;
   if capacity is null then raise exception 'Active spending permission required';end if;
   if capacity<c.charge_cap_cents then
    funded_seconds:=null;
    for seconds in reverse 600..120 by 60 loop
     -- Preserve fixed/recording estimates. Round carrier time up by one minute.
     parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
     select sum(value::numeric) into total from jsonb_each_text(parts);
     price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
     if price>0 and price<=least(capacity,c.charge_cap_cents) then
      funded_seconds:=seconds;funded_price:=price;funded_costs:=parts;exit;
     end if;
    end loop;
    if funded_seconds is null then return jsonb_build_object('allowed',false,'reason','insufficient_call_allowance');end if;
    insert into icash_recorded_reception_private.credit_bounds(operation_key,config_id,account_id,rate_id,max_seconds,charge_cents,costs_micros)
     values(op,c.id,c.account_id,c.rate_id,funded_seconds,funded_price,funded_costs);
   end if;
  end if;
  perform public.icash_reserve_operation$new$],
  array['into planned from jsonb_each(r.costs_micros)', 'into planned from jsonb_each(funded_costs)'],
  array['o.charge_cap_cents<>c.charge_cap_cents', 'o.charge_cap_cents<>funded_price'],
  array['cr.amount_cents=c.charge_cap_cents', 'cr.amount_cents=funded_price'],
  array['o.reserved_micros,c.charge_cap_cents,c.max_total_seconds,o.standard_cost_multiplier', 'o.reserved_micros,funded_price,funded_seconds,o.standard_cost_multiplier']
 ] loop
  if position(pair[1] in definition)=0 then raise exception 'Incoming admission prerequisite changed: %',pair[1];end if;
  definition:=replace(definition,pair[1],pair[2]);
 end loop;
 -- Add the new entrypoint first; the existing deployed handler remains unchanged
 -- until the application release switches to this RPC.
 execute replace(definition,'FUNCTION public.icash_reserve_recorded_reception(', 'FUNCTION public.icash_reserve_flexible_reception(');
end $patch$;
revoke all on function public.icash_reserve_flexible_reception(uuid,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_reserve_flexible_reception(uuid,text,text,text,text,text,text,text,text,text,text) to service_role;
commit;
