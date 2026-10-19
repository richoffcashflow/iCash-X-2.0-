begin;
-- Owner clarification 2026-10-19: only DealMachine research usage changes to 3x.
-- Standard/voice/SMS/lead-package pricing and historical snapshots are untouched.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_operation_spend
 add column dealmachine_cost_multiplier numeric check(dealmachine_cost_multiplier>0),
 add column data_unit_cost_micros bigint check(data_unit_cost_micros>0),
 add column data_cost_basis text;
CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid; required numeric; price numeric; dm_mult numeric; data_unit bigint; data_basis text;
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
 if public.icash_voice_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_voice_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if public.icash_reception_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_reception_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_reception_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and not public.icash_cancellation_voice_current(p_account,p_operation) and not exists(select 1 from public.icash_voice_jobs meta_job where meta_job.account_id=p_account and 'voice:'||meta_job.id=p_operation and public.icash_meta_voice_context(p_account,meta_job.id) is not null) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;end if;
 if r.operation='seller_lead' then
  b.standard_cost_multiplier:=public.icash_seller_lead_rate_multiplier(p_account,p_operation,p_rate)*case when public.icash_vip_active(p_account) then 0.8 else 1 end;
  b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;
 end if;
 if r.operation in ('property_search','owner_enrichment','buyer_discovery') then
  dm_mult:=3*case when public.icash_vip_active(p_account) then 0.8 else 1 end;
  select credit_micros,cost_basis into strict data_unit,data_basis from public.icash_data_cost_settings where provider='dealmachine';
 end if;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/10000);
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier)+coalesce((r.costs_micros->>'dealmachine')::numeric*(dm_mult-b.standard_cost_multiplier),0))*(10000+r.buffer_bps)/10000);
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
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required,dealmachine_cost_multiplier=dm_mult,data_unit_cost_micros=data_unit,data_cost_basis=data_basis where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_account_margin_ok(p_account uuid, p_charge bigint, p_cost bigint, p_pending boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select p_charge>=0 and p_cost>=0 and
 coalesce(sum(case when o.state='settled' then o.actual_micros::numeric*o.standard_cost_multiplier-coalesce((m.components->'elevenlabs'->>'amountMicros')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier)+coalesce((m.components->'dealmachine'->>'amountMicros')::numeric*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier),0)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.required_revenue_micros,o.reserved_micros*o.standard_cost_multiplier) else 0 end),0)
 +p_cost*(select standard_cost_multiplier from public.icash_operating_budget where id=1)
 <=coalesce(sum(case when o.state='settled' then coalesce(o.customer_price_micros,o.charged_cents*10000)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.customer_price_micros,o.charge_cap_cents*10000) else 0 end),0)+p_charge*10000::numeric
 from public.icash_operation_spend o left join public.icash_cost_manifests m on m.operation_key=o.operation_key where o.account_id=p_account
$function$
;
CREATE OR REPLACE FUNCTION public.icash_quote_dealmachine(p_credits integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare s public.icash_data_cost_settings;mult numeric;
begin
 if p_credits is null or p_credits<0 or p_credits>1000000 then raise exception 'Invalid credit count';end if;
 select * into strict s from public.icash_data_cost_settings where provider='dealmachine';
 mult:=3;
 return jsonb_build_object('providerCredits',p_credits,'unitCostMicros',s.credit_micros,
 'estimatedDataCostMicros',p_credits::bigint*s.credit_micros,
 'dataPriceMicros',ceil(p_credits::numeric*s.credit_micros*mult),
 'multiplier',mult,'costBasis',s.cost_basis,'excludes','Infrastructure, payment costs, outreach and other overhead');
end $function$
;
-- Settle only the new policy's completed, bound provider receipts. Never guess
-- a missing response or re-price previously admitted operations.
create function public.icash_settle_dealmachine_usage(p_operation text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o public.icash_operation_spend;r public.icash_operation_rates;receipt jsonb;observed numeric;
 v_source_ref text;used numeric;part record;components jsonb:='{}';amount numeric;total numeric:=0;price numeric:=0;charge bigint;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.dealmachine_cost_multiplier is null or o.data_unit_cost_micros is null then return false;end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 if r.operation not in ('property_search','owner_enrichment','buyer_discovery') then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 if r.operation='property_search' then
  select result into receipt from public.icash_discovery_results where operation_key=p_operation and account_id=o.account_id;
  v_source_ref:='dealmachine:search:'||p_operation;
 elsif r.operation='owner_enrichment' then
  select result into receipt from public.icash_owner_contacts where operation_key=p_operation and account_id=o.account_id;
  v_source_ref:='dealmachine:owners:'||p_operation;
 else
  select b.receipt into receipt from public.icash_buyer_search_receipts b join public.icash_deal_files d on d.id=b.deal_id and d.account_id=o.account_id where b.operation_key=p_operation;
  v_source_ref:=p_operation;
 end if;
 if receipt is null or jsonb_typeof(receipt->'creditsUsed') is distinct from 'number' then return false;end if;
 used:=(receipt->>'creditsUsed')::numeric;
 select c.amount into observed from public.icash_cost_observations c where c.provider='dealmachine' and c.event_key=p_operation and c.source_ref=v_source_ref and c.units='provider_credits';
 if used<0 or used<>trunc(used) or used is distinct from observed or used*o.data_unit_cost_micros>(r.costs_micros->>'dealmachine')::numeric then return false;end if;
 for part in select key,value from jsonb_each_text(r.costs_micros) loop
  amount:=case when part.key='dealmachine' then used*o.data_unit_cost_micros else part.value::numeric end;
  total:=total+amount;
  price:=price+amount*case when part.key='dealmachine' then o.dealmachine_cost_multiplier when part.key='elevenlabs' then o.elevenlabs_cost_multiplier else o.standard_cost_multiplier end;
  components:=components||jsonb_build_object(part.key,jsonb_build_object('amountMicros',amount,'basis','estimated','evidenceRef',case when part.key='dealmachine' then 'Observed DealMachine credits at saved '||o.data_cost_basis||' unit allocation: '||v_source_ref else 'Existing operation allocation: '||r.version end));
 end loop;
 charge:=ceil(price/10000);
 if charge>o.charge_cap_cents or total>o.reserved_micros then return false;end if;
 evidence:='DealMachine usage v1: '||p_operation;
 perform public.icash_settle_complete_costs(p_operation,charge,components,evidence);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=p_operation;
 return true;
end $$;
revoke all on function public.icash_settle_dealmachine_usage(text) from public,anon,authenticated;
grant execute on function public.icash_settle_dealmachine_usage(text) to service_role;


-- Private outcome facts are rebuilt from saved provider receipts, messages and
-- signatures. No generated lead labels, fabricated interest or shared contact data.
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.icash_opportunity_outcomes(
 screening_id uuid primary key references public.icash_screening_jobs(id),
 account_id uuid not null references public.icash_accounts(id),
 zip text, eligible boolean not null, discovered_at timestamptz not null,
 attempted boolean not null default false, responded boolean not null default false,
 interested boolean not null default false, opted_out boolean not null default false,
 purchase_signed boolean not null default false, response_at timestamptz,
 provider_cost_micros bigint not null default 0, costs_complete boolean not null default false,
 research_source boolean not null, refreshed_at timestamptz not null default now()
);
create index icash_opportunity_outcomes_account on public.icash_opportunity_outcomes(account_id,responded desc,response_at desc);
create index icash_opportunity_outcomes_market on public.icash_opportunity_outcomes(account_id,zip,discovered_at);
create table public.icash_opportunity_refreshes(account_id uuid primary key references public.icash_accounts(id),refreshed_at timestamptz not null);
alter table public.icash_opportunity_outcomes enable row level security;
alter table public.icash_opportunity_refreshes enable row level security;
revoke all on public.icash_opportunity_outcomes,public.icash_opportunity_refreshes from public,anon,authenticated;
grant all on public.icash_opportunity_outcomes,public.icash_opportunity_refreshes to service_role;

create function public.icash_call_has_seller_response(p_result jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
  where t->>'role'='user' and length(trim(coalesce(t->>'message','')))>0
  and t->>'message' !~* '(leave (a |your )?message|after the (beep|tone)|mailbox|not available|voicemail|has been disconnected|number you (have )?dialed|press [0-9]|automated (voice|system))');
$$;

create function public.icash_refresh_opportunity_outcomes(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare last_refresh timestamptz;
begin
 if p_account is null or not pg_try_advisory_xact_lock(hashtextextended(p_account::text,7319)) then return;end if;
 select refreshed_at into last_refresh from public.icash_opportunity_refreshes where account_id=p_account;
 if last_refresh>now()-interval '20 seconds' then return;end if;
 last_refresh:=coalesce(last_refresh,'-infinity'::timestamptz);
 -- Recompute changed properties only. A growing history must not make every
 -- workspace refresh rescan all transcripts and messages.
 with changed as (
  select s.id from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
   where s.account_id=p_account and s.state='complete' and (o.screening_id is null or s.completed_at>=last_refresh)
  union select c.screening_id from public.icash_live_conversations c left join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
   where c.account_id=p_account and (c.created_at>=last_refresh or c.completed_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id
   join public.icash_text_messages m on m.account_id=t.account_id and m.thread_id=t.id
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
   where d.account_id=p_account and (m.updated_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id
   where d.account_id=p_account and e.updated_at>=last_refresh
  union select c.screening_id from public.icash_owner_contacts c join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
   where c.account_id=p_account and (c.created_at>=last_refresh or o.settled_at>=last_refresh)
 )
 insert into public.icash_opportunity_outcomes(screening_id,account_id,zip,eligible,discovered_at,attempted,responded,interested,opted_out,purchase_signed,response_at,provider_cost_micros,costs_complete,research_source)
 select s.id,s.account_id,left(s.snapshot->'raw'->'data'->>'zip',5),coalesce(s.result->'financialCheck'->>'status'='eligible',false),s.created_at,
  coalesce(v.attempted,false) or coalesce(t.attempted,false),coalesce(v.responded,false) or coalesce(t.responded,false),coalesce(v.interested,false),coalesce(v.opted_out,false) or coalesce(t.opted_out,false),coalesce(sig.signed,false),greatest(v.response_at,t.response_at),coalesce(cost.total,0),coalesce(cost.complete,false),s.event_key like 'discovery:%'
 from public.icash_screening_jobs s join changed on changed.id=s.id
 left join lateral (
  select count(*)>0 attempted,bool_or(c.state='complete' and public.icash_call_has_seller_response(c.result)) responded,
   bool_or(c.state='complete' and c.result->'interested'='true'::jsonb and public.icash_call_has_seller_response(c.result)) interested,
   bool_or(c.result->'optedOut'='true'::jsonb) opted_out,
   max(c.completed_at) filter(where c.state='complete' and public.icash_call_has_seller_response(c.result)) response_at
  from public.icash_live_conversations c where c.account_id=s.account_id and c.screening_id=s.id and c.party='seller' and c.conversation_id is not null
 ) v on true
 left join lateral (
  select bool_or(m.direction='outgoing' and m.provider_id is not null and m.state in ('accepted','delivered')) attempted,
   bool_or(m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) responded,
   bool_or(m.direction='incoming' and m.state='received' and public.icash_seller_contact_stop(m.body)) opted_out,
   max(m.created_at) filter(where m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) response_at
  from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.screening_id=s.id and d.account_id=s.account_id
 ) t on true
 left join lateral (
  select bool_or(e.state='completed' and not e.test_mode) signed from public.icash_deal_files d
  join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id and e.kind='purchase'
  where d.screening_id=s.id and d.account_id=s.account_id
 ) sig on true
 left join lateral (
  select sum(o.actual_micros) filter(where o.state='settled')::bigint total,bool_and(o.state='settled') complete
  from public.icash_operation_spend o where o.account_id=s.account_id and (
   o.operation_key='owners:'||s.account_id||':'||s.id or o.operation_key in
   (select c.operation_key from public.icash_live_conversations c where c.account_id=s.account_id and c.screening_id=s.id)
   or o.operation_key in (select 'text:'||m.id from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where d.account_id=s.account_id and d.screening_id=s.id))
 ) cost on true
 where s.account_id=p_account and s.state='complete'
  and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
 on conflict(screening_id) do update set eligible=excluded.eligible,attempted=excluded.attempted,responded=excluded.responded,interested=excluded.interested,opted_out=excluded.opted_out,purchase_signed=excluded.purchase_signed,response_at=excluded.response_at,provider_cost_micros=excluded.provider_cost_micros,costs_complete=excluded.costs_complete,refreshed_at=now();
 insert into public.icash_opportunity_refreshes values(p_account,now()) on conflict(account_id) do update set refreshed_at=excluded.refreshed_at;
end $$;

-- Bayesian smoothing and a small maximum influence avoid treating a handful
-- of replies as proof of a winning market. Only this account's facts are used.
create function public.icash_opportunity_market_score(p_account uuid,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select case when count(*)<20 then 0 else
  0.25*(count(*) filter(where eligible)+2.0)/(count(*)+4.0)
  +0.25*(count(*) filter(where responded and not opted_out)+1.0)/(count(*) filter(where attempted)+5.0)
  +0.35*(count(*) filter(where interested and not opted_out)+0.5)/(count(*) filter(where attempted)+5.0)
  +0.15*(count(*) filter(where purchase_signed)+0.25)/(count(*) filter(where attempted)+5.0)
  -least(0.5,count(*) filter(where opted_out)::numeric/greatest(1,count(*) filter(where attempted))) end
 from public.icash_opportunity_outcomes where account_id=p_account and zip=p_zip and research_source and discovered_at between now()-interval '90 days' and now()-interval '1 day';
$$;
create function public.icash_opportunity_score(p_account uuid,p_result jsonb,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select case when p_result->'financialCheck'->>'status'='eligible' then
  0.75*greatest(0,least(1,(coalesce((p_result->>'preliminarySellerCeilingCents')::numeric,0)-coalesce((p_result->'property'->'financialScreening'->>'estimatedLoanBalanceCents')::numeric,0))/greatest(1,coalesce((p_result->>'preliminarySellerCeilingCents')::numeric,0))))
  +0.25*public.icash_opportunity_market_score(p_account,p_zip) else -1 end;
$$;

-- Apply response ordering before pagination so replies never get buried by volume.
create function public.icash_workspace_opportunities(p_account uuid,p_query text default '',p_offset integer default 0,p_limit integer default 7,p_responses_only boolean default false)
returns table(id uuid,state text,result jsonb,completed_at timestamptz,engagement jsonb) language sql stable security invoker set search_path='' as $$
 select s.id,s.state,s.result,s.completed_at,jsonb_build_object('responded',coalesce(o.responded,false),'interested',coalesce(o.interested,false),'optedOut',coalesce(o.opted_out,false)) from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state='complete'
  and (not p_responses_only or coalesce(o.responded,false) or coalesce(o.purchase_signed,false))
  and (p_query='' or position(lower(p_query) in lower(s.result->'property'->>'address'))>0)
 order by coalesce(o.purchase_signed,false) desc,coalesce(o.interested and not o.opted_out,false) desc,coalesce(o.responded,false) desc,o.response_at desc nulls last,s.created_at desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$$;
create function public.icash_workspace_response_counts(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('responded',count(*) filter(where coalesce(o.responded,false) or coalesce(o.purchase_signed,false) or exists(select 1 from public.icash_meta_leads m where m.screening_id=s.id and m.account_id=s.account_id and m.response_at is not null)),'total',count(*))
 from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state in ('complete','awaiting_address');
$$;

create function public.icash_wake_funded_outreach(p_account uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id where a.id=p_account and not a.bot_paused and w.balance_cents>0)
  or not public.icash_membership_work_allowed(p_account) then return false;end if;
 update public.icash_discovery_configs set next_run_at=least(next_run_at,now()-interval '1 minute') where account_id=p_account and enabled and auto_enabled;
 return found;
end $$;
create function public.icash_wake_on_credit_increase() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.balance_cents>old.balance_cents and new.balance_cents>0 then perform public.icash_wake_funded_outreach(new.account_id);end if;
 return new;
end $$;
create trigger icash_wake_outreach_on_funding after update of balance_cents on public.icash_wallets for each row execute function public.icash_wake_on_credit_increase();

revoke all on function public.icash_call_has_seller_response(jsonb),public.icash_refresh_opportunity_outcomes(uuid),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_workspace_opportunities(uuid,text,integer,integer,boolean),public.icash_workspace_response_counts(uuid),public.icash_wake_funded_outreach(uuid),public.icash_wake_on_credit_increase() from public,anon,authenticated;
grant execute on function public.icash_call_has_seller_response(jsonb),public.icash_refresh_opportunity_outcomes(uuid),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_workspace_opportunities(uuid,text,integer,integer,boolean),public.icash_workspace_response_counts(uuid),public.icash_wake_funded_outreach(uuid),public.icash_wake_on_credit_increase() to service_role;

-- Outcome-driven ranking retains each account's markets, contact gates and prices.
CREATE OR REPLACE FUNCTION public.icash_meta_workspace_response_leads(p_account uuid, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7, p_screening uuid DEFAULT NULL::uuid, p_responses_only boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE sql
 SET search_path TO ''
AS $function$
 select coalesce(jsonb_agg(row),'[]'::jsonb) from (
 select m.lead_id "leadId",m.screening_id "screeningId",d.id "dealId",l.name,l.phone,l.address,l.state,m.paused,m.declined_at "declinedAt",
 m.submitted_at "submittedAt",m.first_outreach_at "firstOutreachAt",m.response_at "responseAt",m.address_confirmed_at "addressConfirmedAt",m.form_id "formId",m.campaign_id "campaignId",
 l.hold_reason "holdReason"
 from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
 join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
 where m.account_id=p_account and (p_screening is null or m.screening_id=p_screening)
 and (not p_responses_only or m.response_at is not null)
 and (p_query='' or position(lower(p_query) in lower(coalesce(l.name,'')||' '||l.phone||' '||coalesce(l.address,'')))>0)
 order by m.response_at desc nulls last,m.created_at desc,m.lead_id limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset))
 ) row;
$function$
;
revoke all on function public.icash_meta_workspace_response_leads(uuid,text,integer,integer,uuid,boolean) from public,anon,authenticated;
grant execute on function public.icash_meta_workspace_response_leads(uuid,text,integer,integer,uuid,boolean) to service_role;
CREATE OR REPLACE FUNCTION public.icash_enrichment_candidate(p_account uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id from public.icash_screening_jobs s
 left join public.icash_automation_tickets t on t.screening_id=s.id
 where s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyType'='house' and s.snapshot->'sellerRequest' is null and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state') and s.result->'financialCheck'->>'status'='eligible'
 and s.completed_at>now()-interval '24 hours'
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id where oc.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and oc.created_at>now()-interval '30 days')
 and (t.id is null or (t.kind='contacts' and t.state='held' and t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id)))
 order by public.icash_opportunity_score(p_account,s.result,left(s.snapshot->'raw'->'data'->>'zip',5)) desc,s.completed_at,s.id limit 1;
$function$
;
CREATE OR REPLACE FUNCTION public.icash_rotate_inventory_market(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_discovery_configs;m public.icash_inventory_markets;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.exhausted or not c.enabled or not c.auto_enabled or c.data_rights_until<=now() then return false;end if;
 if not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents) then return false;end if;
 select * into m from public.icash_inventory_markets where account_id=p_account and eligible_until>now() and next_scan_at<=now() and public.icash_research_zip_known(zip) order by public.icash_opportunity_market_score(p_account,zip) desc,priority,zip for update skip locked limit 1;
 if not found then return false;end if;
 update public.icash_discovery_configs set zip=m.zip,next_page=1,revision=gen_random_uuid(),exhausted=false where account_id=p_account;
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=m.zip;
 return true;
end $function$
;

-- Bounded pending work, not daily record counts, determines discovery demand.
set local lock_timeout='5s';
alter table public.icash_discovery_configs drop constraint icash_discovery_configs_interval_seconds_check;
alter table public.icash_discovery_configs add constraint icash_discovery_configs_interval_seconds_check check(interval_seconds between 60 and 86400);
alter table public.icash_discovery_configs alter column interval_seconds set default 60;

create function public.icash_pending_opportunity_count(p_account uuid) returns integer
language sql stable security invoker set search_path='' as $$
 select count(*)::integer from public.icash_screening_jobs s
 left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.created_at>now()-interval '24 hours'
 and (s.state in ('queued','running') or (s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
  and not coalesce(o.attempted,false) and not coalesce(o.responded,false) and not coalesce(o.opted_out,false)
  and not exists(select 1 from public.icash_property_controls c where c.account_id=s.account_id and c.property_id=s.snapshot->>'propertyId' and c.manual)
  and not exists(select 1 from public.icash_owner_contacts c where c.account_id=s.account_id and c.screening_id=s.id and jsonb_array_length(coalesce(c.result->'contacts','[]'::jsonb))=0)
  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in ('closed','cancelled','cancellation_pending','under_contract','purchase_signed','buyer_selected','assigned','title_open','closing'))));
$$;

-- Retry only billing against an already saved receipt. Never repeat a provider call.
create function public.icash_settle_pending_dealmachine() returns integer
language plpgsql security invoker set search_path='' as $$
declare item record;n integer:=0;
begin
 for item in select operation_key from public.icash_operation_spend where state='dispatched' and dealmachine_cost_multiplier is not null order by dispatched_at desc limit 20 loop
  begin
   if public.icash_settle_dealmachine_usage(item.operation_key) then n:=n+1;end if;
  exception when raise_exception then null; -- Conflicting evidence stays held for reconciliation.
  end;
 end loop;
 return n;
end $$;
revoke all on function public.icash_pending_opportunity_count(uuid),public.icash_settle_pending_dealmachine() from public,anon,authenticated;
grant execute on function public.icash_pending_opportunity_count(uuid),public.icash_settle_pending_dealmachine() to service_role;
CREATE OR REPLACE FUNCTION public.icash_outbound_search_due(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a public.icash_accounts;c public.icash_discovery_configs;policy public.icash_acquisition_policy;capacity bigint;research_spend bigint;cost bigint;target integer;pending_count integer;profile jsonb;
begin
 select * into policy from public.icash_acquisition_policy where id=1;
 if not found or policy.mode='inbound' then return false;end if;
 select * into a from public.icash_accounts where id=p_account;
 if not found or a.bot_paused or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now() or not public.icash_research_zip_known(c.zip) then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return false;end if;
 select charge_cents into cost from public.icash_operation_rates where id=c.rate_id and enabled and expires_at>now() and operation='property_search';
 if cost is null then return false;end if;
 select w.balance_cents into capacity from public.icash_wallets w where account_id=p_account;
 if capacity is null or capacity<=0 then return false;end if;
 if exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state in ('queued','running') and s.created_at>now()-interval '1 day') then return false;end if;
 if policy.mode='outbound' then return public.icash_pending_opportunity_count(p_account)<c.max_open_prospects;end if;
 select bs.profile into profile from public.icash_bot_setups bs where account_id=p_account;
 -- Let an affordable, due inbound request be delivered before buying a page.
 if public.icash_credit_acquisition_allowed(p_account) and exists(select 1 from public.icash_seller_intakes l where l.state in ('qualified','assigned') and l.next_assignment_at<=now() and l.data_rights_until>now() and l.checked_at>now()-interval '8 days'
 and public.icash_research_state_allowed(l.property->>'state') and (profile->>'marketMode'='nationwide' or lower(trim(profile->>'market')) in (lower(l.property->>'city'),lower(l.property->>'city')||', '||lower(l.property->>'state'),l.property->>'zip'))
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=p_account)
 and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations lc on lc.account_id=sm.account_id and lc.screening_id=sm.screening_id join public.icash_contact_suppressions cs on cs.account_id=lc.account_id and cs.contact_key=lc.contact_key where sm.lead_id=l.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=l.id)
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=l.id)<=now()
 and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>p_account)
 and ceil(ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,case when public.icash_seller_acquisition_quote(l.id) is not null then l.lookup_costs||jsonb_build_object('acquisition',(public.icash_seller_acquisition_quote(l.id)->>'costMicros')::bigint) end)))*coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 else 2 end)/10000)*case when public.icash_vip_active(p_account) then 0.8 else 1 end)<=capacity) then return false;end if;
 -- Keep a bounded buffer of fresh, unattempted work. Failed connections and
 -- real responses remain in history without consuming the discovery buffer.
 target:=c.max_open_prospects;
 pending_count:=public.icash_pending_opportunity_count(p_account);
 return pending_count<target;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_next_acquisition()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_discovery_configs;j uuid;t public.icash_automation_tickets;backlog integer;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 perform public.icash_settle_pending_dealmachine();
 update public.icash_automation_tickets set state='held',outcome='expired' where kind in ('contacts','discovery') and state='issued' and expires_at<=now();
 for c in select d.* from public.icash_discovery_configs d join public.icash_accounts a on a.id=d.account_id join public.icash_wallets w on w.account_id=a.id
 where d.enabled and d.auto_enabled and d.next_run_at<=now() and d.data_rights_until>now() and not a.bot_paused and w.balance_cents>w.reserved_cents
 and not exists(select 1 from public.icash_automation_tickets x where x.account_id=a.id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes')))
 order by d.next_run_at,d.account_id limit 20 for update of d skip locked loop
 perform public.icash_refresh_opportunity_outcomes(c.account_id);
 j:=null;
 if c.contacts_enabled and c.contact_rate_id is not null then j:=public.icash_enrichment_candidate(c.account_id);end if;
 if j is not null then
 update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;
 insert into public.icash_automation_tickets(account_id,kind,screening_id) values(c.account_id,'contacts',j)
 on conflict(screening_id) do update set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=now()+interval '2 minutes',issue_attempts=public.icash_automation_tickets.issue_attempts+1
 returning * into t;
 return jsonb_build_object('token',t.token);
 end if;
 -- Provider capacity remains bounded while completed attempts free the queue.
 backlog:=public.icash_pending_opportunity_count(c.account_id);
 update public.icash_discovery_configs set next_run_at=now()+make_interval(secs=>least(interval_seconds,60)) where account_id=c.account_id;
 if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then continue;end if;
 insert into public.icash_automation_tickets(account_id,kind) values(c.account_id,'discovery') returning * into t;
 return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_vip_savings(p_account uuid)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with settled as (
  select o.*,r.operation from public.icash_operation_spend o
  join public.icash_operation_rates r on r.id=o.rate_id
  where o.account_id=p_account and o.state='settled' and o.settled_at is not null
   and o.charged_cents is not null and o.actual_micros is not null
 ), amounts as (
  select case
   when o.dealmachine_cost_multiplier=2.4 and o.standard_cost_multiplier=1.6 and o.elevenlabs_cost_multiplier=1.6 and o.customer_price_micros is null
    and o.charged_cents=ceil((o.actual_micros::numeric*o.standard_cost_multiplier+coalesce((cm.components->'dealmachine'->>'amountMicros')::numeric,0)*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier))/10000)
    then greatest(0,ceil((o.actual_micros::numeric*o.standard_cost_multiplier+coalesce((cm.components->'dealmachine'->>'amountMicros')::numeric,0)*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier))/0.8/10000)-o.charged_cents)*10000
   when o.operation='seller_lead' and o.standard_cost_multiplier in (1.6,2.4)
    and o.charged_cents=ceil(ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000)*0.8)
    then (ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000)-o.charged_cents)*10000
   when o.customer_price_micros is null and o.standard_cost_multiplier in (1.6,2.4) and o.elevenlabs_cost_multiplier=o.standard_cost_multiplier
    and o.charged_cents=ceil(o.actual_micros::numeric*o.standard_cost_multiplier/10000)
    then greatest(0,least(o.charge_cap_cents,ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)/10000))-o.charged_cents)*10000
   when f.price_micros=o.customer_price_micros and f.charged_cents=o.charged_cents then
    case when o.standard_cost_multiplier in (1.6,2.4) and o.customer_price_micros=ceil(o.actual_micros::numeric*o.standard_cost_multiplier)
     then greatest(0,least(o.charge_cap_cents::numeric*10000,ceil(o.actual_micros::numeric*(o.standard_cost_multiplier/0.8)))-o.customer_price_micros)
    when m.customer_price_micros>0 and o.customer_price_micros=ceil(m.customer_price_micros::numeric*0.8)
     then m.customer_price_micros-o.customer_price_micros else 0 end
   else 0 end as savings_micros
  from settled o
  left join public.icash_cost_manifests cm on cm.operation_key=o.operation_key
  left join public.icash_fractional_usage f on f.operation_key=o.operation_key and f.account_id=p_account
  left join public.icash_text_messages m on o.operation_key='text:'||m.id and m.account_id=p_account
  union all
  select ceil(q.cost_micros::numeric*(q.multiplier/0.8))-q.price_micros
  from public.icash_question_usage q where q.account_id=p_account and q.state='settled'
   and q.settled_at is not null and q.provider_id is not null and q.multiplier in (1.6,2.4)
   and q.price_micros=ceil(q.cost_micros::numeric*q.multiplier) and q.charged_cents is not null
 ) select floor(coalesce(sum(greatest(0,savings_micros)),0)/10000)::bigint from amounts
$function$
;

commit;
