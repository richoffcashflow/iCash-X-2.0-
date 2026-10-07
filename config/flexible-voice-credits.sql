begin;
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
 select least(w.balance_cents-w.reserved_cents,a.daily_limit_cents-w.reserved_cents-coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours'),0)) into capacity from public.icash_wallets w join public.icash_accounts a on a.id=w.account_id where w.account_id=p_account;
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
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',outcome='Add credits to start this call',updated_at=now() where id=p_job;
 return null;
end $$;
CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid; required numeric; price numeric; voice_bound jsonb;
begin
 if p_operation is null or length(p_operation) not between 1 and 160 then raise exception 'Invalid operation'; end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.enabled then raise exception 'Automation on hold'; end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation;
 if found then
  if o.account_id<>p_account or o.rate_id<>p_rate then raise exception 'Operation conflict'; end if;
  return jsonb_build_object('operationKey',o.operation_key,'state',o.state,'reservedMicros',o.reserved_micros);
 end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.verified_at>now() or r.expires_at<=now() then raise exception 'Verified rate required'; end if;
 voice_bound:=public.icash_voice_credit_bound(p_account,p_operation,p_rate);
 if voice_bound is not null then r.charge_cents:=(voice_bound->>'charge_cents')::bigint;r.costs_micros:=voice_bound->'costs_micros';end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/10000);
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/10000);
 price:=r.charge_cents::numeric*10000;
 if r.operation='sms_send' then
 select customer_price_micros into price from public.icash_text_messages where 'text:'||id=p_operation and account_id=p_account;
 end if;

 if r.flat_customer_price_cents is not null then
  if r.operation<>'sms_send' or price is distinct from r.flat_customer_price_cents::numeric*10000 then raise exception 'SMS flat price snapshot mismatch';end if;
  -- Snapshot cost-coverage accounting only for this explicit flat-price operation.
  -- The existing fractional ledger charges the immutable customer_price_micros.
  required:=held;b.standard_cost_multiplier:=1;b.elevenlabs_cost_multiplier:=1;
 end if;
 if price is null or price<required then raise exception 'Price below provider cost multiplier';end if;
 if b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.reserved_micros-b.protected_micros<held then raise exception 'Company budget exhausted'; end if;
 select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where settled_at>now()-interval '24 hours';
 if b.require_company_reserve and daily+b.reserved_micros+held>b.daily_limit_micros then raise exception 'Company daily limit'; end if;
 -- Protect 20% of daily credits from new search spending while follow-up work exists.
 if r.operation='property_search' and (
 exists(select 1 from public.icash_voice_jobs where account_id=p_account and callback_id is not null and state in ('ready','issued','dispatching','dispatched'))
 or exists(select 1 from public.icash_deal_files where account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing'))
 ) then
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 if (select w.balance_cents-w.reserved_cents-r.charge_cents<ceil(a.daily_limit_cents*0.20) from public.icash_wallets w join public.icash_accounts a on a.id=w.account_id where w.account_id=p_account)
 then raise exception 'Credits protected for active deals and callbacks'; end if;
 end if;
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_reserve_paced_voice(p_account uuid, p_job uuid, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;r public.icash_operation_rates;a jsonb;voice_bound jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return false;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 select * into r from public.icash_operation_rates where id=p_rate;
 if p.id is null or r.id is null then return false;end if;
 voice_bound:=public.icash_voice_credit_bound(p_account,'voice:'||j.id,p_rate);if voice_bound is not null then r.charge_cents:=(voice_bound->>'charge_cents')::bigint;end if;
 if p.party='seller' and j.callback_id is null and exists(select 1 from public.icash_daytime_pacing_settings where id=1 and enabled)
 and not public.icash_seller_voice_permission_current(p_account,p.id)
 and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id and account_id=p_account) then
 a:=public.icash_voice_daytime_allowance(p_account,p.id);
 if coalesce((a->>'allowedCents')::bigint,0)<r.charge_cents then
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '30 minutes',outcome='Waiting for daytime budget allocation',updated_at=now() where id=j.id;
 return false;
 end if;end if;

 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',true)
   or not public.icash_claim_inventory(p_account,p.screening_id,p.phone) then return false;end if;
  p_permission_until:=least(p_permission_until,p.permission_until);
 end if;
 perform public.icash_reserve_operation(p_account,'voice:'||j.id,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
 return true;
end $function$
;
alter table public.icash_call_recordings drop constraint icash_call_recordings_charge_cap_cents_check;
alter table public.icash_call_recordings add constraint icash_call_recordings_charge_cap_cents_check check(charge_cap_cents between 1 and 977);
alter table public.icash_call_recordings drop constraint icash_call_recordings_max_total_seconds_check;
alter table public.icash_call_recordings add constraint icash_call_recordings_max_total_seconds_check check(max_total_seconds between 120 and 600 and max_total_seconds%60=0);
CREATE OR REPLACE FUNCTION public.icash_create_call_recording(p_account uuid, p_operation text, p_provider_account_sid text, p_call_sid text, p_nonce_hash text, p_stop_token_hash text, p_disclosure_version text, p_pricing_policy jsonb, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.icash_call_recordings; b record;t timestamptz:=icash_recording_private.clock_now();
begin
 if p_account is null or p_operation is null or length(p_operation) not between 1 and 160
  or coalesce(p_provider_account_sid,'') !~ '^AC[0-9a-fA-F]{32}$'
  or (p_call_sid is not null and p_call_sid !~ '^CA[0-9a-fA-F]{32}$')
  or coalesce(p_nonce_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_stop_token_hash,'') !~ '^[a-f0-9]{64}$'
  or p_disclosure_version is null or length(btrim(p_disclosure_version)) not between 1 and 100
  or not icash_recording_private.keys(p_context,array['fromPhone','branchId','versionId','maxTotalSeconds'],array['callContext'])
  or coalesce(p_context->>'fromPhone','') !~ '^\+[1-9][0-9]{7,14}$'
  or coalesce(p_context->>'branchId','') !~ '^agtbrch_[A-Za-z0-9]{1,160}$'
  or coalesce(p_context->>'versionId','') !~ '^agtvrsn_[A-Za-z0-9]{1,160}$'
  or coalesce(p_context->>'maxTotalSeconds','') !~ '^(120|180|240|300|360|420|480|540|600)$'
  or p_pricing_policy is distinct from '{"version":"required-audio-30d-speech-v1","retentionDays":30,"recordingMicrosPerMinute":2500,"storageMicrosPerMinuteMonth":500,"recordingAllowanceMicros":31000,"speechGatherMicros":20000,"estimate":true}'::jsonb
  then raise exception 'Invalid recording session input';end if;
 if p_context ? 'callContext' then
  if not icash_recording_private.keys(p_context->'callContext',array['principal','assistantName','firstMessage','prompt','strategyKey'],array['voiceId'])
   or jsonb_typeof(p_context->'callContext'->'principal') is distinct from 'string' or length(p_context->'callContext'->>'principal') not between 1 and 160
   or jsonb_typeof(p_context->'callContext'->'assistantName') is distinct from 'string' or length(p_context->'callContext'->>'assistantName') not between 1 and 160
   or jsonb_typeof(p_context->'callContext'->'firstMessage') is distinct from 'string' or length(p_context->'callContext'->>'firstMessage') not between 1 and 2000
   or jsonb_typeof(p_context->'callContext'->'prompt') is distinct from 'string' or length(p_context->'callContext'->>'prompt') not between 1 and 24000
   or (p_context->'callContext' ? 'voiceId' and (jsonb_typeof(p_context->'callContext'->'voiceId') is distinct from 'string' or p_context->'callContext'->>'voiceId' !~ '^[A-Za-z0-9_-]{1,100}$'))
   or coalesce(p_context->'callContext'->>'strategyKey','') not in ('cash_interest','flexible_timing') then raise exception 'Invalid bound call context';end if;
 end if;
 select * into r from public.icash_call_recordings where operation_key=p_operation;
 if found then
  if row(r.account_id,r.provider_account_sid,r.nonce_hash,r.stop_token_hash,r.disclosure_version,r.pricing_policy,r.from_phone,r.branch_id,r.version_id,r.call_context)
   is distinct from row(p_account,p_provider_account_sid,p_nonce_hash,p_stop_token_hash,p_disclosure_version,p_pricing_policy,p_context->>'fromPhone',p_context->>'branchId',p_context->>'versionId',p_context->'callContext')
   or r.max_total_seconds is distinct from (p_context->>'maxTotalSeconds')::integer or (p_call_sid is not null and r.call_sid is distinct from p_call_sid) then return null;end if;
  return to_jsonb(r);
 end if;
 select j.id as job_id,j.permission_id,j.operational_contact_id,p.screening_id,p.party,p.phone,p.contact_key,c.agent_id,o.rate_id,o.charge_cap_cents into b
 from public.icash_operation_spend o
 join public.icash_voice_jobs j on j.account_id=o.account_id and j.operation_key=o.operation_key and o.operation_key='voice:'||j.id
 join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
 join public.icash_voice_configs c on c.account_id=j.account_id
 join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation=case p.party when 'seller' then 'seller_call' when 'buyer' then 'buyer_call' end
 where o.operation_key=p_operation and o.account_id=p_account and o.state='dispatched'
  and o.permission_until>t and o.customer_price_micros is null and rate.charge_cents=977 and o.charge_cap_cents=coalesce((public.icash_voice_credit_bound(p_account,p_operation,o.rate_id)->>'charge_cents')::bigint,977) and (p_context->>'maxTotalSeconds')::integer=coalesce((public.icash_voice_credit_bound(p_account,p_operation,o.rate_id)->>'max_seconds')::integer,600) and rate.voice_max_duration_seconds=600
  and j.state in ('dispatching','dispatched') and (j.provider_call_sid is null or j.provider_call_sid=p_call_sid)
  and j.conversation_id is null and p.revoked_at is null and p.permission_until>t and (p.dnc_clear or public.icash_seller_voice_permission_current(j.account_id,p.id))
  and c.enabled and c.reviewed_until>t and c.agent_id is not null and c.max_duration_seconds=600
  and exists(select 1 from public.icash_accounts a where a.id=o.account_id and not a.bot_paused)
  and o.rate_id=case p.party when 'seller' then c.seller_rate_id when 'buyer' then c.buyer_rate_id end
  and not exists(select 1 from public.icash_live_conversations lc where lc.operation_key=o.operation_key)
 for share of o,j,p,c,rate;
 if not found then return null;end if;
 insert into public.icash_call_recordings(account_id,operation_key,voice_job_id,permission_id,operational_contact_id,screening_id,party,call_context,provider_account_sid,call_sid,
  to_phone,from_phone,contact_key,agent_id,branch_id,version_id,rate_id,charge_cap_cents,max_total_seconds,
  nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,consent_deadline_at,updated_at,next_reconcile_at)
 values(p_account,p_operation,b.job_id,b.permission_id,b.operational_contact_id,b.screening_id,b.party,p_context->'callContext',p_provider_account_sid,p_call_sid,b.phone,p_context->>'fromPhone',b.contact_key,b.agent_id,
  p_context->>'branchId',p_context->>'versionId',b.rate_id,b.charge_cap_cents,(p_context->>'maxTotalSeconds')::integer,p_nonce_hash,p_stop_token_hash,p_disclosure_version,p_pricing_policy,
  t,t+interval '2 minutes',t,t+interval '2 minutes') on conflict do nothing returning * into r;
 if not found then return null;end if;
 return to_jsonb(r);
end $function$
;
revoke all on function public.icash_voice_credit_bound(uuid,text,uuid),public.icash_voice_bounded_costs(jsonb,integer),public.icash_reserve_flexible_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.icash_voice_credit_bound(uuid,text,uuid),public.icash_voice_bounded_costs(jsonb,integer),public.icash_reserve_flexible_voice(uuid,uuid,uuid,timestamptz,timestamptz,boolean) to service_role;
CREATE OR REPLACE FUNCTION public.icash_reserve_before_membership(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cap bigint;used numeric;charge bigint;b public.icash_operating_budget;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.require_company_reserve then
 select customer_cap_cents into cap from public.icash_spend_activations where account_id=p_account and enabled;
 if cap is null or not exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null) then raise exception 'Account spending not activated';end if;
 if not exists(select 1 from public.icash_operation_spend where operation_key=p_operation) then
 select coalesce((public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint,charge_cents) into charge from public.icash_operation_rates where id=p_rate;
 select coalesce(sum(case when state='settled' then charged_cents else charge_cap_cents end),0) into used from public.icash_operation_spend where account_id=p_account and state in ('reserved','dispatched','settled');
 if charge is null or used+charge>cap then raise exception 'Activation spending cap reached';end if;
 end if;
 end if;
 return public.icash_reserve_before_activation(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
end $function$
;
-- Final dispatch repeats the financial check. A brief inquiry must use the same
-- bound limited-contact exception here; it still cannot create an offer.
do $patch$
declare source text;old_clause text:='if r.operation=''seller_call'' and (o.financial_checked_at is null or o.financial_checked_at<now()-interval ''24 hours'') then return false; end if;';
begin
 source:=pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure);
 if strpos(source,old_clause)=0 then raise exception 'Final financial gate changed; review required';end if;
 execute replace(source,old_clause,'if r.operation=''seller_call'' and not public.icash_limited_seller_voice(o.account_id,p_operation) and (o.financial_checked_at is null or o.financial_checked_at<now()-interval ''24 hours'') then return false; end if;');
end $patch$;
commit;
