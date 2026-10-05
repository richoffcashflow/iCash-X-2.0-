-- Public intake, private qualification and exactly-once paid assignment.
-- This installs no ad campaign, contact permission, legal clearance or spending allowance.
create table public.icash_seller_controls (
 id integer primary key check(id=1),enabled boolean not null default false,
 lookup_allowance_micros bigint not null default 0 check(lookup_allowance_micros>=0),
 lookup_reserved_micros bigint not null default 0 check(lookup_reserved_micros>=0),
 lookup_used_micros bigint not null default 0 check(lookup_used_micros>=0),
 data_rights_until timestamptz,review_ref text,
 assignment_fee_cents bigint not null default 1000000 check(assignment_fee_cents>=0),
 seller_cost_reserve_cents bigint not null default 100000 check(seller_cost_reserve_cents>=0),
 updated_by uuid,updated_at timestamptz not null default now()
);
insert into public.icash_seller_controls(id) values(1);
create table public.icash_seller_markets (
 city text not null,state text not null check(state ~ '^[A-Z]{2}$'),primary key(city,state),
 major_city boolean not null default false,enabled boolean not null default false,
 review_ref text not null,reviewed_until timestamptz not null,updated_by uuid,
 check(city=lower(trim(city)) and length(city) between 1 and 100)
);
create table public.icash_seller_intakes (
 id uuid primary key default gen_random_uuid(),request_id uuid not null unique,guest_hash text not null,
 duplicate_key text not null check(duplicate_key ~ '^[a-f0-9]{64}$'),
 name text not null check(length(name) between 1 and 100),address text not null check(length(address) between 1 and 300),
 phone text not null check(phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$'),
 ai_consented boolean not null,consent_version text not null,consent_text text not null,sharing_text text not null,
 owner_claimed boolean not null default true,agent_hash text not null,attribution jsonb not null,
 state text not null default 'received' check(state in ('received','duplicate','checking','review','unmatched','numbers_review','market_review','qualified','assigned')),
 canonical_id uuid references public.icash_seller_intakes(id),claim_token uuid,claimed_at timestamptz,
 lookup_costs jsonb,lookup_cap_micros bigint,lookup_cost_basis text,data_rights_until timestamptz,
 result jsonb,property jsonb,numbers_passed boolean not null default false,market_qualified boolean not null default false,
 checked_at timestamptz,ad_cost_micros bigint check(ad_cost_micros>=0),ad_cost_receipt text,
 assigned_account uuid references public.icash_accounts(id),screening_id uuid references public.icash_screening_jobs(id),
 operation_key text unique references public.icash_operation_spend(operation_key),assigned_at timestamptz,
 next_assignment_at timestamptz not null default now(),hold_reason text,created_at timestamptz not null default now(),
 check((assigned_account is null)=(screening_id is null))
);
create index icash_seller_duplicate on public.icash_seller_intakes(duplicate_key,created_at desc);
create index icash_seller_queue on public.icash_seller_intakes(created_at) where state='received';
create index icash_seller_assignment_queue on public.icash_seller_intakes(next_assignment_at) where state in ('qualified','assigned');
create index icash_seller_account on public.icash_seller_intakes(assigned_account,assigned_at desc) where assigned_account is not null;
create unique index icash_seller_screening on public.icash_seller_intakes(screening_id) where screening_id is not null;
create index icash_seller_canonical on public.icash_seller_intakes(canonical_id) where canonical_id is not null;
create index icash_seller_property on public.icash_seller_intakes((property->>'id'),created_at desc) where checked_at is not null;
create index icash_seller_campaign on public.icash_seller_intakes((attribution->>'source'),(attribution->>'campaign'),created_at);
-- Each real customer gets at most one paid, non-exclusive match per request.
create table public.icash_seller_matches (
 lead_id uuid not null references public.icash_seller_intakes(id),
 account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null unique references public.icash_screening_jobs(id),
 operation_key text not null unique references public.icash_operation_spend(operation_key),
 charge_cents bigint not null check(charge_cents>0),
 assigned_at timestamptz not null default now(),
 primary key(lead_id,account_id)
);
create index icash_seller_matches_account on public.icash_seller_matches(account_id,assigned_at desc);
create table public.icash_seller_ad_costs (
 receipt_id text primary key,source text not null,campaign text not null,
 period_start timestamptz not null,period_end timestamptz not null check(period_end>period_start),
 spend_micros bigint not null check(spend_micros>=0),qualified_count integer not null check(qualified_count>0),
 evidence_ref text not null,recorded_by uuid not null,created_at timestamptz not null default now()
);
create table public.icash_seller_events (
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.icash_seller_intakes(id),
 event_name text not null check(event_name in ('CompleteRegistration','Lead','Contact','SubmitApplication')),
 occurred_at timestamptz not null default now(),evidence_ref text not null,
 delivery_state text not null default 'pending' check(delivery_state in ('pending','sending','delivered','review')),
 delivery_token uuid,attempted_at timestamptz,delivered_at timestamptz,attempts integer not null default 0,
 unique(lead_id,event_name)
);
create index icash_seller_event_queue on public.icash_seller_events(occurred_at) where delivery_state='pending';
do $$ declare t text;begin
 foreach t in array array['icash_seller_matches','icash_seller_controls','icash_seller_markets','icash_seller_intakes','icash_seller_ad_costs','icash_seller_events'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function public.icash_submit_seller_intake(p_request uuid,p_guest text,p_name text,p_address text,p_phone text,p_duplicate text,p_consented boolean,p_consent_version text,p_consent_text text,p_sharing_text text,p_attribution jsonb,p_agent_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare prior public.icash_seller_intakes;canonical uuid;new_id uuid;
begin
 if p_guest !~ '^[a-f0-9]{64}$' or p_agent_hash !~ '^[a-f0-9]{64}$' or p_duplicate !~ '^[a-f0-9]{64}$' or p_consent_version<>'homeoffer-seller-ai-2026-10-05.1' or length(p_consent_text)<100 or length(p_sharing_text)<100 or octet_length(p_attribution::text)>1500 then raise exception 'Invalid intake evidence';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_duplicate,0));
 select * into prior from public.icash_seller_intakes where request_id=p_request;
 if found then
  if row(prior.guest_hash,prior.name,prior.address,prior.phone,prior.ai_consented,prior.consent_version,prior.consent_text,prior.sharing_text,prior.attribution) is distinct from row(p_guest,p_name,p_address,p_phone,p_consented,p_consent_version,p_consent_text,p_sharing_text,p_attribution) then raise exception 'Submission retry mismatch';end if;
  return prior.id;
 end if;
 select id into canonical from public.icash_seller_intakes where duplicate_key=p_duplicate and state<>'duplicate' and created_at>now()-interval '90 days' order by created_at limit 1;
 insert into public.icash_seller_intakes(request_id,guest_hash,name,address,phone,duplicate_key,ai_consented,consent_version,consent_text,sharing_text,attribution,agent_hash,state,canonical_id)
 values(p_request,p_guest,p_name,p_address,p_phone,p_duplicate,p_consented,p_consent_version,p_consent_text,p_sharing_text,p_attribution,p_agent_hash,case when canonical is null then 'received' else 'duplicate' end,canonical) returning id into new_id;
 return new_id;
end $$;

create function public.icash_claim_seller_lookup() returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_seller_controls;l public.icash_seller_intakes;r public.icash_operation_rates;u public.icash_data_cost_settings;parts jsonb;cap bigint;token uuid:=gen_random_uuid();
begin
 select * into c from public.icash_seller_controls where id=1 for update;
 if not c.enabled or c.data_rights_until is null or c.data_rights_until<=now() or length(coalesce(c.review_ref,''))<10 then return null;end if;
 -- An ambiguous lookup is held permanently until an operator reconciles it.
 update public.icash_seller_intakes set state='review',hold_reason='Lookup outcome unknown; do not repeat automatically' where state='checking' and claimed_at<now()-interval '2 minutes';
 select * into r from public.icash_operation_rates where operation='property_search' and enabled and verified_at<=now() and expires_at>now() order by verified_at desc,id limit 1;
 select * into u from public.icash_data_cost_settings where provider='dealmachine';
 if r.id is null or u.credit_micros is null then return null;end if;
 parts:=r.costs_micros||jsonb_build_object('dealmachine',u.credit_micros,'acquisition',0);
 select sum(value::numeric)::bigint into cap from jsonb_each_text(parts);
 if cap<=0 or c.lookup_used_micros+c.lookup_reserved_micros+cap>c.lookup_allowance_micros then return null;end if;
 select * into l from public.icash_seller_intakes where state='received' order by created_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros+cap where id=1;
 update public.icash_seller_intakes set state='checking',claim_token=token,claimed_at=now(),lookup_costs=parts,lookup_cap_micros=cap,lookup_cost_basis=u.cost_basis||'; '||u.source_ref||'; non-data allocations: '||r.evidence_ref,data_rights_until=c.data_rights_until where id=l.id;
 return jsonb_build_object('id',l.id,'token',token,'address',l.address,'assignmentFeeCents',c.assignment_fee_cents,'sellerCostReserveCents',c.seller_cost_reserve_cents);
end $$;

create function public.icash_finish_seller_lookup(p_id uuid,p_token uuid,p_output jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;parts jsonb;cost bigint;numbers boolean;market boolean;city_name text;st text;used integer;duplicate_property uuid;
begin
 perform 1 from public.icash_seller_controls where id=1 for update;
 select * into l from public.icash_seller_intakes where id=p_id for update;
 if not found or l.state<>'checking' or l.claim_token<>p_token or l.claimed_at<now()-interval '2 minutes' then return false;end if;
 used:=(p_output->>'creditsUsed')::integer;
 if used not between 0 and 1 or used is null or octet_length(p_output::text)>64000 then raise exception 'Invalid lookup receipt';end if;
 numbers:=coalesce((p_output->>'numbersPassed')::boolean,false) and p_output->'result'->'financialCheck'->>'status'='eligible' and (p_output->'result'->>'preliminarySellerCeilingCents')::bigint>0;
 city_name:=lower(trim(p_output->'property'->>'city'));st:=upper(p_output->'property'->>'state');
 select numbers and exists(select 1 from public.icash_seller_markets m where m.city=city_name and m.state=st and m.enabled and m.major_city and m.reviewed_until>now() and length(m.review_ref)>=10) into market;
 parts:=l.lookup_costs||jsonb_build_object('dealmachine',(l.lookup_costs->>'dealmachine')::bigint*used);
 select sum(value::numeric)::bigint into cost from jsonb_each_text(parts);
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros-l.lookup_cap_micros,lookup_used_micros=lookup_used_micros+cost where id=1;
 if p_output->'property'->>'id' is not null then
  perform pg_advisory_xact_lock(hashtextextended('seller-property:'||(p_output->'property'->>'id'),0));
  select id into duplicate_property from public.icash_seller_intakes where id<>l.id and property->>'id'=p_output->'property'->>'id' and state<>'duplicate' and checked_at is not null and created_at>now()-interval '90 days' order by created_at limit 1;
 end if;
 if duplicate_property is not null then
  update public.icash_seller_intakes set state='duplicate',canonical_id=duplicate_property,lookup_costs=parts,result=p_output->'result',property=p_output->'property',checked_at=now(),numbers_passed=false,market_qualified=false where id=l.id;
  return true;
 end if;
 update public.icash_seller_intakes set lookup_costs=parts,result=p_output->'result',property=p_output->'property',numbers_passed=coalesce(numbers,false),market_qualified=coalesce(market,false),checked_at=now(),state=case when market then 'qualified' when numbers then 'market_review' when p_output->>'status'='unmatched' then 'unmatched' else 'numbers_review' end where id=l.id;
 if numbers then insert into public.icash_seller_events(lead_id,event_name,evidence_ref) values(l.id,'CompleteRegistration','dealmachine:screening:'||l.id) on conflict do nothing;end if;
 if market then insert into public.icash_seller_events(lead_id,event_name,evidence_ref) values(l.id,'Lead','reviewed-market:'||st||':'||city_name) on conflict do nothing;end if;
 return true;
end $$;

-- The operator imports a completed advertising spend receipt, not a target CPL.
-- Allocation uses the actual count of unique qualified requests in that period.
create function public.icash_allocate_seller_ad_cost(p_receipt text,p_source text,p_campaign text,p_start timestamptz,p_end timestamptz,p_spend bigint,p_evidence text,p_actor uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare n bigint;l record;idx bigint:=0;prior public.icash_seller_ad_costs;
begin
 perform 1 from public.icash_seller_controls where id=1 for update;
 if p_spend<0 or p_spend>1000000000000 or p_end>now() or p_start>=p_end or p_source not in ('meta','google','youtube','tiktok','direct','other') or length(p_campaign)>100 or length(p_evidence)<10 or length(p_receipt) not between 8 and 200 or (p_source='direct' and p_spend<>0) then raise exception 'Completed spend receipt required';end if;
 select * into prior from public.icash_seller_ad_costs where receipt_id=p_receipt;
 if found then
  if row(prior.source,prior.campaign,prior.period_start,prior.period_end,prior.spend_micros,prior.evidence_ref) is distinct from row(p_source,p_campaign,p_start,p_end,p_spend,p_evidence) then raise exception 'Ad receipt conflict';end if;
  return jsonb_build_object('allocated',prior.qualified_count,'spendMicros',prior.spend_micros);
 end if;
 if exists(select 1 from public.icash_seller_ad_costs where source=p_source and campaign=p_campaign and period_start<p_end and period_end>p_start) then raise exception 'Ad cost period overlaps';end if;
 if exists(select 1 from public.icash_seller_intakes where state in ('received','checking','review','market_review') and attribution->>'source'=p_source and attribution->>'campaign'=p_campaign and created_at>=p_start and created_at<p_end) then raise exception 'Finish outstanding property and market reviews before allocating this period';end if;
 select count(*) into n from public.icash_seller_intakes where market_qualified and state='qualified' and ad_cost_receipt is null and attribution->>'source'=p_source and attribution->>'campaign'=p_campaign and created_at>=p_start and created_at<p_end;
 if n=0 then raise exception 'No unique qualified leads to allocate';end if;
 insert into public.icash_seller_ad_costs(receipt_id,source,campaign,period_start,period_end,spend_micros,qualified_count,evidence_ref,recorded_by) values(p_receipt,p_source,p_campaign,p_start,p_end,p_spend,n,p_evidence,p_actor);
 for l in select id from public.icash_seller_intakes where market_qualified and state='qualified' and ad_cost_receipt is null and attribution->>'source'=p_source and attribution->>'campaign'=p_campaign and created_at>=p_start and created_at<p_end order by created_at,id for update loop
  update public.icash_seller_intakes set ad_cost_micros=p_spend/n+case when idx<mod(p_spend,n) then 1 else 0 end,ad_cost_receipt=p_receipt,next_assignment_at=now() where id=l.id;idx:=idx+1;
 end loop;
 return jsonb_build_object('allocated',n,'spendMicros',p_spend,'averageCostMicros',p_spend::numeric/n);
end $$;

create function public.icash_assign_seller_lead() returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;a record;parts jsonb;total bigint;charge bigint;rate uuid;op text;screen uuid;evidence text;manifest jsonb;city_name text;state_code text;match_count integer;
begin
 -- Consistent lock order with all other paid operations.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_seller_controls where id=1 and enabled for share;if not found then return null;end if;
 select * into l from public.icash_seller_intakes where state in ('qualified','assigned') and ad_cost_micros is not null and next_assignment_at<=now()
 and (select count(*) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<10
 and exists(select 1 from public.icash_accounts ac where ac.billing_model='daily' and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id and m.account_id=ac.id))
 order by next_assignment_at,created_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 city_name:=lower(trim(l.property->>'city'));state_code:=upper(l.property->>'state');
 if l.data_rights_until<=now() or not exists(select 1 from public.icash_seller_markets m where m.city=city_name and m.state=state_code and m.enabled and m.major_city and m.reviewed_until>now()) then
 update public.icash_seller_intakes set state='review',hold_reason='Fresh property data or current market review required' where id=l.id;return jsonb_build_object('status','review');end if;
 if l.checked_at<now()-interval '24 hours' then
  update public.icash_seller_intakes set state='received',numbers_passed=false,market_qualified=false,hold_reason='Refreshing stale property data before matching' where id=l.id;
  return jsonb_build_object('status','property_refresh_queued');
 end if;
 parts:=l.lookup_costs||jsonb_build_object('acquisition',l.ad_cost_micros);select sum(value::numeric)::bigint into total from jsonb_each_text(parts);charge:=ceil(total::numeric*3/10000);
 if charge<=0 then raise exception 'Positive cost-based lead price required';end if;
 evidence:='ESTIMATE: allocated ad receipt '||l.ad_cost_receipt||'; '||l.lookup_cost_basis;
 select count(*) into match_count from public.icash_seller_matches where lead_id=l.id;
 -- Largest funded bid wins at the same cost-based price, with oldest assignment
 -- first for equal capacity. A bid is bounded by wallet AND rolling daily usage.
 for a in select ac.id,least(w.balance_cents-w.reserved_cents,ac.daily_limit_cents-w.reserved_cents-coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=ac.id and kind='usage' and created_at>now()-interval '24 hours'),0)) capacity
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 join public.icash_bot_setups bs on bs.account_id=ac.id
 where ac.billing_model='daily' and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=ac.id) and exists(select 1 from public.icash_daily_plans p where p.account_id=ac.id and p.state='active' and p.mode='live' and p.consent_version like 'daily-2026-10-04.1%')
 and (bs.profile->>'marketMode'='nationwide' or lower(trim(bs.profile->>'market')) in (city_name,city_name||', '||lower(state_code),l.property->>'zip'))
 and not exists(select 1 from public.icash_billing_reviews where account_id=ac.id and resolved_at is null)
 order by capacity desc,(select max(assigned_at) from public.icash_seller_matches where account_id=ac.id) asc nulls first,ac.id limit 50 loop
  if a.capacity<charge then continue;end if;
  op:='seller-lead:'||l.id||':'||a.id;
  begin
   insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
   values('seller_lead',op,charge,parts,0,evidence,now(),least(l.checked_at+interval '24 hours',l.data_rights_until),true) returning id into rate;
   perform public.icash_reserve_operation(a.id,op,rate,l.data_rights_until,l.checked_at,true);
   if not public.icash_claim_operation(op) then raise exception 'Lead reservation held';end if;
   select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',evidence)) into manifest from jsonb_each(parts);
   perform public.icash_settle_complete_costs(op,charge,manifest,evidence);
   update public.icash_operation_spend set cost_basis='estimated' where operation_key=op;
   insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at)
   values(a.id,op,jsonb_build_object('propertyId',l.property->>'id','propertyType','house','fetchedAt',l.property->>'fetchedAt','raw',l.property->'raw','sellerRequest',jsonb_build_object('id',l.id,'ownerName',l.name,'phone',l.phone,'aiConsented',l.ai_consented,'consentVersion',l.consent_version,'shared',true,'maximumBuyers',10)), 'complete',l.result,now()) returning id into screen;
   insert into public.icash_seller_matches(lead_id,account_id,screening_id,operation_key,charge_cents) values(l.id,a.id,screen,op,charge);
   -- Pace genuine matching; the first 3 are at least 20 minutes apart, then
   -- expand by 2 per day up to 10. This never simulates buyers or contact.
   update public.icash_seller_intakes set state='assigned',assigned_account=coalesce(assigned_account,a.id),screening_id=coalesce(screening_id,screen),operation_key=coalesce(operation_key,op),assigned_at=coalesce(assigned_at,now()),
    next_assignment_at=case when match_count+1<3 then now()+interval '20 minutes' else greatest(now()+interval '20 minutes',coalesce(assigned_at,now())+((match_count+1-3)/2+1)*interval '24 hours') end,hold_reason=null where id=l.id;
   return jsonb_build_object('status','assigned','chargeCents',charge);
  exception when others then
   -- The subtransaction rolls back rate, reservation, charge and assignment together.
   null;
  end;
 end loop;
 update public.icash_seller_intakes set next_assignment_at=now()+interval '15 minutes',hold_reason='Waiting for a funded bot whose market and daily limit fit this lead' where id=l.id;
 return jsonb_build_object('status','waiting_for_budget');
end $$;

create function public.icash_save_seller_market(p_city text,p_state text,p_enabled boolean,p_review text,p_until timestamptz,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if length(p_review)<10 or (p_enabled and p_until<=now()) then raise exception 'Current market review required';end if;
 insert into public.icash_seller_markets(city,state,major_city,enabled,review_ref,reviewed_until,updated_by) values(lower(trim(p_city)),p_state,true,p_enabled,p_review,p_until,p_actor)
 on conflict(city,state) do update set enabled=excluded.enabled,major_city=true,review_ref=excluded.review_ref,reviewed_until=excluded.reviewed_until,updated_by=excluded.updated_by;
 -- A later reviewed market may qualify an already screened, still-current request.
 insert into public.icash_seller_events(lead_id,event_name,evidence_ref)
 select id,'Lead','market-review:'||p_review from public.icash_seller_intakes where p_enabled and state='market_review' and numbers_passed and checked_at>now()-interval '24 hours' and lower(trim(property->>'city'))=lower(trim(p_city)) and upper(property->>'state')=p_state on conflict do nothing;
 update public.icash_seller_intakes set state='qualified',market_qualified=true where p_enabled and state='market_review' and numbers_passed and checked_at>now()-interval '24 hours' and lower(trim(property->>'city'))=lower(trim(p_city)) and upper(property->>'state')=p_state;
end $$;
create function public.icash_collect_seller_milestones() returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Completed provider conversation with an actual seller utterance, not a dial attempt.
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select distinct on (l.id) l.id,'Contact',c.completed_at,'conversation:'||c.id
 from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id join public.icash_live_conversations c on c.account_id=m.account_id and c.screening_id=m.screening_id
 where c.party='seller' and c.state='complete' and c.completed_at is not null and (c.result->>'durationSeconds')::numeric>0
 and exists(select 1 from jsonb_array_elements(case when jsonb_typeof(c.result->'transcript')='array' then c.result->'transcript' else '[]'::jsonb end) t where t->>'role'='user' and length(trim(t->>'message'))>2)
 order by l.id,c.completed_at on conflict do nothing;
 -- User-selected advertising definition: SubmitApplication means an executed purchase.
 -- A drafted, sent, test or partially signed contract cannot create this event.
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select distinct on (l.id) l.id,'SubmitApplication',d.seller_signed_at,'executed-purchase:'||e.id
 from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
 join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' and e.provider_id is not null and e.terms=d.terms
 where d.seller_signed_at is not null order by l.id,d.seller_signed_at on conflict do nothing;
end $$;
create function public.icash_claim_seller_event() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_seller_events;l public.icash_seller_intakes;token uuid:=gen_random_uuid();
begin
 update public.icash_seller_events set delivery_state=case when attempts>=3 or occurred_at<now()-interval '7 days' then 'review' else 'pending' end where delivery_state='sending' and attempted_at<now()-interval '2 minutes';
 update public.icash_seller_events set delivery_state='review' where delivery_state='pending' and occurred_at<now()-interval '7 days';
 select ev.* into e from public.icash_seller_events ev join public.icash_seller_intakes i on i.id=ev.lead_id where ev.delivery_state='pending' and (ev.attempted_at is null or ev.attempted_at<now()-interval '2 minutes') and i.attribution->>'source'='meta' and coalesce((i.attribution->>'measurementOptOut')::boolean,false)=false order by ev.occurred_at limit 1 for update of ev skip locked;
 if not found then return null;end if;
 select * into l from public.icash_seller_intakes where id=e.lead_id;
 update public.icash_seller_events set delivery_state='sending',delivery_token=token,attempted_at=now(),attempts=attempts+1 where id=e.id;
 return jsonb_build_object('id',e.id,'leadId',l.id,'token',token,'name',e.event_name,'occurredAt',e.occurred_at,'phone',l.phone);
end $$;
create function public.icash_finish_seller_event(p_id uuid,p_token uuid,p_delivered boolean) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_seller_events set delivery_state=case when p_delivered then 'delivered' when attempts>=3 or occurred_at<now()-interval '7 days' then 'review' else 'pending' end,delivered_at=case when p_delivered then now() end where id=p_id and delivery_token=p_token and delivery_state='sending';return found;
end $$;
create function public.icash_seller_funnel_summary() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('received',(select count(*) from public.icash_seller_intakes where state<>'duplicate'),'qualified',(select count(*) from public.icash_seller_intakes where market_qualified),'assigned',(select count(*) from public.icash_seller_intakes where state='assigned'),'waitingForCosts',(select count(*) from public.icash_seller_intakes where state='qualified' and ad_cost_micros is null),'waitingForBudget',(select count(*) from public.icash_seller_intakes where state='qualified' and ad_cost_micros is not null),'review',(select count(*) from public.icash_seller_intakes where state in ('review','market_review','numbers_review')),'events',(select coalesce(jsonb_object_agg(event_name,n),'{}') from (select event_name,count(*) n from public.icash_seller_events group by event_name) x))
$$;

-- Every RPC is service-only. Client requests never supply price, qualification,
-- account allocation, DNC clearance or a conversion event.
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('icash_submit_seller_intake','icash_claim_seller_lookup','icash_finish_seller_lookup','icash_allocate_seller_ad_cost','icash_assign_seller_lead','icash_save_seller_market','icash_collect_seller_milestones','icash_claim_seller_event','icash_finish_seller_event','icash_seller_funnel_summary') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
