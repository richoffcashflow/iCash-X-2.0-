begin;
set local lock_timeout='2s';
-- Per-call bounds derived from the existing reviewed quote. Historical rates stay intact.
create table public.icash_voice_credit_bounds (
 operation_key text primary key, account_id uuid not null references public.icash_accounts(id),
 rate_id uuid not null references public.icash_operation_rates(id),
 max_seconds integer not null check(max_seconds between 120 and 600 and max_seconds%60=0),
 charge_cents bigint not null check(charge_cents>0), costs_micros jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.icash_voice_credit_bounds enable row level security;
revoke all on public.icash_voice_credit_bounds from public,anon,authenticated;
grant select,insert,delete on public.icash_voice_credit_bounds to service_role;
create function public.icash_voice_credit_bound(p_account uuid,p_operation text,p_rate uuid) returns jsonb language sql stable set search_path='' as $$
 select to_jsonb(b) from public.icash_voice_credit_bounds b join public.icash_voice_jobs j on b.operation_key='voice:'||j.id and b.account_id=j.account_id
 join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
 join public.icash_voice_configs c on c.account_id=j.account_id
 where b.account_id=p_account and b.operation_key=p_operation and b.rate_id=p_rate and c.enabled and c.reviewed_until>now()
 and b.rate_id=case p.party when 'buyer' then c.buyer_rate_id else c.seller_rate_id end;
$$;
-- Preserve every fixed cost. Prorate only time-based carrier/agent ceilings, with
-- an additional carrier minute for rounding; reserve the existing buffer too.
create function public.icash_voice_bounded_costs(p_costs jsonb,p_seconds integer) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_object_agg(key,case key when 'twilio' then ceil(value::numeric*least(600,p_seconds+60)/600) when 'elevenlabs' then ceil(value::numeric*p_seconds/600) else value::numeric end) from jsonb_each_text(p_costs);
$$;
create function public.icash_reserve_flexible_voice(p_account uuid,p_job uuid,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;r public.icash_operation_rates;c public.icash_voice_configs;b public.icash_operating_budget;bound public.icash_voice_credit_bounds;capacity bigint;parts jsonb;price bigint;seconds integer;allowance jsonb;total numeric;operation text:='voice:'||p_job;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return null;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 select * into c from public.icash_voice_configs where account_id=p_account;
 select * into r from public.icash_operation_rates where id=p_rate and enabled and verified_at<=now() and expires_at>now() and voice_max_duration_seconds=600 and charge_cents=977 and version like 'required-audio-30d-speech-v1:%';
 if p.id is null or r.id is null or not c.enabled or c.reviewed_until<=now() or p_rate is distinct from (case p.party when 'buyer' then c.buyer_rate_id else c.seller_rate_id end) then return null;end if;
 if exists(select 1 from public.icash_operation_spend where operation_key=operation) then
  select * into bound from public.icash_voice_credit_bounds where operation_key=operation and account_id=p_account and rate_id=p_rate;
  if public.icash_reserve_paced_voice(p_account,p_job,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible) then return jsonb_build_object('maxSeconds',coalesce(bound.max_seconds,600));end if;return null;
 end if;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 capacity:=(public.icash_daily_allowance(p_account)->>'remainingCents')::bigint;
 if not b.require_company_reserve then
  select least(capacity,greatest(0,a.customer_cap_cents-coalesce((select sum(case when state='settled' then charged_cents else charge_cap_cents end) from public.icash_operation_spend where account_id=p_account and state in ('reserved','dispatched','settled')),0))) into capacity
   from public.icash_spend_activations a where a.account_id=p_account and a.enabled;
 end if;
 if capacity is null then return null;end if;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
 if p.party='seller' and j.callback_id is null and exists(select 1 from public.icash_daytime_pacing_settings where id=1 and enabled) and not public.icash_seller_voice_permission_current(p_account,p.id) then
  allowance:=public.icash_voice_daytime_allowance(p_account,p.id);capacity:=least(capacity,coalesce((allowance->>'allowedCents')::bigint,0));
 end if;
 for seconds in reverse (case when public.icash_seller_limited_contact(p_account,p.screening_id) then 120 else 600 end)..120 by 60 loop
  parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
  select sum(value::numeric) into total from jsonb_each_text(parts);
  price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
  if price<=capacity then
   insert into public.icash_voice_credit_bounds(operation_key,account_id,rate_id,max_seconds,charge_cents,costs_micros) values(operation,p_account,p_rate,seconds,price,parts);
   if public.icash_reserve_paced_voice(p_account,p_job,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible) then return jsonb_build_object('maxSeconds',seconds,'reservedCents',price);end if;
   delete from public.icash_voice_credit_bounds where operation_key=operation;
   return null;
  end if;
 end loop;
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',outcome='Waiting for available credits or daily allowance',updated_at=now() where id=p_job;
 return null;
end $$;

-- Patch the deployed layers, retaining VIP pricing, inventory and all current checks.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=' if p_permission_until is null or p_permission_until<=now() then';
 if position(needle in definition)=0 then raise exception 'Voice reservation prerequisite changed';end if;
 execute replace(definition,needle,$new$ if public.icash_voice_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_voice_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
$new$||needle);
 definition:=pg_get_functiondef('public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=' if p.id is null or r.id is null then return false;end if;';
 if position(needle in definition)=0 then raise exception 'Voice pacing prerequisite changed';end if;
 execute replace(definition,needle,needle||$new$
 if public.icash_voice_credit_bound(p_account,'voice:'||j.id,p_rate) is not null then
  r.charge_cents:=(public.icash_voice_credit_bound(p_account,'voice:'||j.id,p_rate)->>'charge_cents')::bigint;
 end if;$new$);
 definition:=pg_get_functiondef('public.icash_reserve_before_membership(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:=' select charge_cents into charge from public.icash_operation_rates where id=p_rate;';
 if position(needle in definition)=0 then raise exception 'Voice activation prerequisite changed';end if;
 execute replace(definition,needle,$new$ select coalesce((public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint,charge_cents) into charge from public.icash_operation_rates where id=p_rate;$new$);
 definition:=pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure);
 needle:='if r.operation=''seller_call'' and (o.financial_checked_at is null or o.financial_checked_at<now()-interval ''24 hours'') then return false; end if;';
 if position(needle in definition)=0 then raise exception 'Final financial gate changed';end if;
 execute replace(definition,needle,'if r.operation=''seller_call'' and not public.icash_limited_seller_voice(o.account_id,p_operation) and (o.financial_checked_at is null or o.financial_checked_at<now()-interval ''24 hours'') then return false; end if;');
 definition:=pg_get_functiondef('public.icash_create_call_recording(uuid,text,text,text,text,text,text,jsonb,jsonb)'::regprocedure);
 needle:=$old$p_context->'maxTotalSeconds' is distinct from '600'::jsonb$old$;
 if position(needle in definition)=0 then raise exception 'Recording duration prerequisite changed';end if;
 definition:=replace(definition,needle,$new$coalesce(p_context->>'maxTotalSeconds','') !~ '^(120|180|240|300|360|420|480|540|600)$'$new$);
 needle:='o.charge_cap_cents=977 and rate.charge_cents=o.charge_cap_cents and rate.voice_max_duration_seconds=600';
 if position(needle in definition)=0 then raise exception 'Recording reservation prerequisite changed';end if;
 definition:=replace(definition,needle,$new$rate.charge_cents=977 and o.charge_cap_cents=coalesce((public.icash_voice_credit_bound(p_account,p_operation,o.rate_id)->>'charge_cents')::bigint,977)
 and (p_context->>'maxTotalSeconds')::integer=coalesce((public.icash_voice_credit_bound(p_account,p_operation,o.rate_id)->>'max_seconds')::integer,600) and rate.voice_max_duration_seconds=600$new$);
 needle:='b.rate_id,b.charge_cap_cents,600,p_nonce_hash';
 if position(needle in definition)=0 then raise exception 'Recording insert prerequisite changed';end if;
 execute replace(definition,needle,$new$b.rate_id,b.charge_cap_cents,(p_context->>'maxTotalSeconds')::integer,p_nonce_hash$new$);
end $patch$;
alter table public.icash_call_recordings drop constraint icash_call_recordings_charge_cap_cents_check;
alter table public.icash_call_recordings add constraint icash_call_recordings_charge_cap_cents_check check(charge_cap_cents between 1 and 977);
alter table public.icash_call_recordings drop constraint icash_call_recordings_max_total_seconds_check;
alter table public.icash_call_recordings add constraint icash_call_recordings_max_total_seconds_check check(max_total_seconds between 120 and 600 and max_total_seconds%60=0);
revoke all on function public.icash_voice_credit_bound(uuid,text,uuid),public.icash_voice_bounded_costs(jsonb,integer),public.icash_reserve_flexible_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.icash_voice_credit_bound(uuid,text,uuid),public.icash_voice_bounded_costs(jsonb,integer),public.icash_reserve_flexible_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean) to service_role;
commit;
