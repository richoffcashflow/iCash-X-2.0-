-- Current deployed flexible-call functions; no provider calls in this fixture.
create table public.icash_voice_configs(account_id uuid primary key,enabled boolean,reviewed_until timestamptz,seller_rate_id uuid,buyer_rate_id uuid);
create table public.icash_voice_credit_bounds(operation_key text primary key,account_id uuid,rate_id uuid,max_seconds integer check(max_seconds between 120 and 600 and max_seconds%60=0),charge_cents bigint,costs_micros jsonb,created_at timestamptz default now());
create function public.icash_daily_allowance(uuid) returns jsonb language sql as $$select jsonb_build_object('remainingCents',balance_cents) from public.icash_wallets where account_id=$1$$;
create function public.icash_seller_limited_contact(uuid,uuid) returns boolean language sql as $$select false$$;
-- The surrounding consent gates are fixture inputs; real admission and billing
-- remain exercised by the production reserve function and migration trigger.
create function public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean) returns boolean language plpgsql as $$begin perform public.icash_reserve_before_fractional($1,'voice:'||$2,$3,$4,$5,$6);return true;end$$;
create function public.icash_voice_bounded_costs(p_costs jsonb,p_seconds integer) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_object_agg(key,case key when 'twilio' then ceil(value::numeric*least(600,p_seconds+60)/600) when 'elevenlabs' then ceil(value::numeric*p_seconds/600) else value::numeric end) from jsonb_each_text(p_costs);
$$;
CREATE OR REPLACE FUNCTION public.icash_reserve_flexible_voice(p_account uuid, p_job uuid, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;r public.icash_operation_rates;c public.icash_voice_configs;b public.icash_operating_budget;bound public.icash_voice_credit_bounds;capacity bigint;parts jsonb;price bigint;seconds integer;allowance jsonb;total numeric;operation text:='voice:'||p_job;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return null;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 select * into c from public.icash_voice_configs where account_id=p_account;
 select * into r from public.icash_operation_rates where id=p_rate and enabled and verified_at<=now() and expires_at>now() and voice_max_duration_seconds=600 and charge_cents=977 and version like 'required-audio-30d-speech-v1:%';
 if p.id is null or p.party is distinct from 'seller' or r.id is null or not c.enabled or c.reviewed_until<=now() or p_rate is distinct from (case p.party when 'buyer' then c.buyer_rate_id else c.seller_rate_id end) then return null;end if;
 if exists(select 1 from public.icash_operation_spend where operation_key=operation) then
  select * into bound from public.icash_voice_credit_bounds where operation_key=operation and account_id=p_account and rate_id=p_rate;
  if public.icash_reserve_paced_voice(p_account,p_job,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible) then return jsonb_build_object('maxSeconds',coalesce(bound.max_seconds,600));end if;return null;
 end if;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 capacity:=(public.icash_daily_allowance(p_account)->>'remainingCents')::bigint;
 if coalesce(capacity,0)<=0 then return null;end if;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;end if;
 for seconds in reverse (case when public.icash_seller_limited_contact(p_account,p.screening_id) then 120 else 600 end)..120 by 60 loop
  parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
  select sum(value::numeric) into total from jsonb_each_text(parts);
  price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
  if price>0 then
   insert into public.icash_voice_credit_bounds(operation_key,account_id,rate_id,max_seconds,charge_cents,costs_micros) values(operation,p_account,p_rate,seconds,price,parts);
   if public.icash_reserve_paced_voice(p_account,p_job,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible) then return jsonb_build_object('maxSeconds',seconds,'reservedCents',price);end if;
   delete from public.icash_voice_credit_bounds where operation_key=operation;
   return null;
  end if;
 end loop;
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',outcome='Add credits to continue calling',updated_at=now() where id=p_job;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_voice_credit_bound(p_account uuid, p_operation text, p_rate uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select to_jsonb(b) from public.icash_voice_credit_bounds b join public.icash_voice_jobs j on b.operation_key='voice:'||j.id and b.account_id=j.account_id
 join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
 join public.icash_voice_configs c on c.account_id=j.account_id
 where b.account_id=p_account and b.operation_key=p_operation and b.rate_id=p_rate and c.enabled and c.reviewed_until>now()
 and b.rate_id=case p.party when 'buyer' then c.buyer_rate_id else c.seller_rate_id end;
$function$;

