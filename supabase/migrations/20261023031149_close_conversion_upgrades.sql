begin;
-- Shared admission for normal production calls. Existing call identities,
-- recording approvals, credit settlement and unknown-outcome holds stay intact.
set local lock_timeout='5s';
create table public.icash_voice_capacity_policy(
 id integer primary key check(id=1), workspace_limit integer not null check(workspace_limit between 1 and 40),
 verified_at timestamptz not null, source text not null check(length(source) between 1 and 200)
);
create table public.icash_voice_agent_capacity(
 agent_id text primary key, concurrent_limit integer not null check(concurrent_limit between 1 and 40),
 verified_at timestamptz not null
);
alter table public.icash_voice_capacity_policy enable row level security;
alter table public.icash_voice_agent_capacity enable row level security;
revoke all on public.icash_voice_capacity_policy,public.icash_voice_agent_capacity from public,anon,authenticated;
grant select,insert,update on public.icash_voice_capacity_policy,public.icash_voice_agent_capacity to service_role;
create index icash_recording_active_capacity on public.icash_call_recordings(account_id,agent_id,operation_key) where call_ended_at is null;
create index icash_reception_active_capacity on icash_recorded_reception_private.sessions(account_id,agent_id,operation_key) where call_ended_at is null;

create function public.icash_voice_capacity_targets() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('agentId',agent_id,'branchId',branch_id)),'[]') from (
  select agent_id,null::text branch_id from public.icash_voice_configs where enabled
  union select agent_id,branch_id from icash_recorded_reception_private.configs where enabled and call_profile='normal'
 ) targets
$$;
create function public.icash_save_voice_capacity(p_limit integer,p_agents jsonb,p_source text) returns void
language plpgsql security invoker set search_path='' as $$
declare a jsonb;
begin
 if p_limit not between 1 and 4 or jsonb_typeof(p_agents) is distinct from 'array' or jsonb_array_length(p_agents) not between 1 and 12 then raise exception 'Verified capacity required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 for a in select value from jsonb_array_elements(p_agents) loop
  if coalesce(a->>'agentId','')!~'^agent_[A-Za-z0-9]+$' or (a->>'limit')::integer not between 1 and p_limit then raise exception 'Invalid capacity';end if;
  insert into public.icash_voice_agent_capacity values(a->>'agentId',(a->>'limit')::integer,now())
   on conflict(agent_id) do update set concurrent_limit=excluded.concurrent_limit,verified_at=excluded.verified_at;
 end loop;
 insert into public.icash_voice_capacity_policy values(1,p_limit,now(),p_source)
  on conflict(id) do update set workspace_limit=excluded.workspace_limit,verified_at=excluded.verified_at,source=excluded.source;
end $$;
revoke all on function public.icash_voice_capacity_targets(),public.icash_save_voice_capacity(integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_voice_capacity_targets(),public.icash_save_voice_capacity(integer,jsonb,text) to service_role;

-- One row per operation even when both a dispatch job and a recording exist.
-- Receipt reconciliation, never a timeout, releases uncertain calls.
create function public.icash_active_voice_slots() returns table(operation_key text,account_id uuid,agent_id text,contact_key text)
language sql stable security definer set search_path='' as $$
 select 'voice:'||j.id,j.account_id,c.agent_id,t.contact_key
 from public.icash_voice_jobs j join public.icash_voice_configs c on c.account_id=j.account_id
 left join public.icash_voice_contact_targets t on t.id=coalesce(j.permission_id,j.operational_contact_id) and t.account_id=j.account_id
 where j.state in ('issued','dispatching') or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))
 union
 select l.operation_key,l.account_id,l.agent_id,l.contact_key from public.icash_live_conversations l where l.state in ('waiting','review')
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from public.icash_call_recordings r where r.call_ended_at is null
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from icash_recorded_reception_private.sessions r where r.call_ended_at is null
$$;
create function public.icash_voice_capacity_available(p_account uuid,p_agent text,p_operation text,p_contact text,p_incoming boolean default false) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare total_limit integer:=1;agent_limit integer:=1;account_limit integer:=1;busy integer;agent_busy integer;account_busy integer;contact_busy boolean;
begin
 select least(4,workspace_limit) into total_limit from public.icash_voice_capacity_policy where id=1 and verified_at>now()-interval '24 hours';
 select concurrent_limit into agent_limit from public.icash_voice_agent_capacity where agent_id=p_agent and verified_at>now()-interval '24 hours';
 total_limit:=coalesce(total_limit,1);agent_limit:=coalesce(agent_limit,1);
 select count(distinct operation_key),count(distinct operation_key) filter(where agent_id=p_agent),
 count(distinct operation_key) filter(where account_id=p_account),coalesce(bool_or(p_contact is not null and contact_key=p_contact),false)
 into busy,agent_busy,account_busy,contact_busy from public.icash_active_voice_slots() where operation_key is distinct from p_operation;
 if contact_busy or busy>=total_limit or agent_busy>=agent_limit then return false;end if;
 if p_incoming then return true;end if;
 -- Leave one workspace slot for incoming callbacks; never enable provider burst.
 if (total_limit>1 and busy>=total_limit-1) or (agent_limit>1 and agent_busy>=agent_limit-1
  and exists(select 1 from jsonb_array_elements(public.icash_voice_capacity_targets()) t where t->>'agentId'=p_agent and t->>'branchId' is not null)) then return false;end if;
 select least(3,greatest(1,floor(greatest(0,least(w.balance_cents,
 coalesce((public.icash_daily_allowance(p_account)->>'remainingCents')::bigint,0)))::numeric/1000)))::integer
 into account_limit from public.icash_wallets w where w.account_id=p_account and w.balance_cents>0;
 return account_busy<coalesce(account_limit,0);
end $$;
revoke all on function public.icash_active_voice_slots(),public.icash_voice_capacity_available(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_active_voice_slots(),public.icash_voice_capacity_available(uuid,text,text,text,boolean) to service_role;

-- Exact guarded edits keep the current, layered recipient and financial checks.
do $patch$
declare d text;needle text;signature text;
begin
 d:=pg_get_functiondef('public.icash_voice_queue_slot_open(uuid,uuid)'::regprocedure);
 if position('busy.account_id=j.account_id or ' in d)=0 or position('live.account_id=j.account_id or ' in d)=0 then raise exception 'Queue capacity prerequisite changed';end if;
 d:=replace(replace(d,'busy.account_id=j.account_id or ',''),'live.account_id=j.account_id or ','');
 needle:='j.state=''ready''';
 d:=replace(d,needle,needle||E'\n and public.icash_voice_capacity_available(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),''voice:''||j.id,target.contact_key,false)');
 execute d;
 foreach signature in array array['public.icash_claim_voice_job(uuid)','public.icash_claim_cancellation_voice(uuid,uuid,jsonb)','public.icash_meta_claim_voice(uuid,uuid)','public.icash_meta_claim_or_defer_voice(uuid,uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position('icash_operating_budget' in d)=0 or position('icash_claim_operation(''voice:''||j.id)' in d)=0 then raise exception 'Claim capacity prerequisite changed: %',signature;end if;
  -- Contact exclusion remains global. Only the old per-account singleton goes.
  d:=replace(replace(replace(d,'v.account_id=j.account_id or ',''),'v.account_id=p_account or ',''),'account_id=p_account or contact_key=p.contact_key','contact_key=p.contact_key');
  d:=replace(d,'account_id=j.account_id or contact_key=p.contact_key','contact_key=p.contact_key');
  needle:='if not public.icash_claim_operation(''voice:''||j.id) then';
  if signature like '%claim_or_defer%' then
   -- Keep its existing bounded, receipt-free deferral when shared capacity is full.
   needle:='if exists(select 1 from public.icash_voice_jobs';
   if position(needle in d)=0 then raise exception 'Meta capacity deferral boundary changed';end if;
   d:=replace(d,needle,'if not public.icash_voice_capacity_available(p_account,(select agent_id from public.icash_voice_configs where account_id=p_account),''voice:''||j.id,p.contact_key,false) or exists(select 1 from public.icash_voice_jobs');
  else
   d:=replace(d,needle,'if not public.icash_voice_capacity_available(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),''voice:''||j.id,p.contact_key,false) then return false;end if;'||E'\n '||needle);
  end if;
  execute d;
 end loop;
 d:=pg_get_functiondef('public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure);
 needle:='if exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then return jsonb_build_object(''allowed'',false,''reason'',''concurrency_limit'');end if;';
 if position(needle in d)=0 then raise exception 'Incoming capacity prerequisite changed';end if;
 -- Budget row is the common lock used by every final outbound claim.
 d:=replace(d,needle,'');
 needle:='select * into b from public.icash_operating_budget where id=1 for update;';
 d:=replace(d,needle,needle||E'\n if (c.call_profile=''normal'' and not public.icash_voice_capacity_available(c.account_id,c.agent_id,''recorded-reception:''||p_call_sid,encode(sha256(convert_to(p_from_phone,''UTF8'')),''hex''),true)) or (c.call_profile<>''normal'' and exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null)) then return jsonb_build_object(''allowed'',false,''reason'',''concurrency_limit'');end if;');
 execute d;
end $patch$;

set local lock_timeout='5s';
-- Unknown capacity stays unknown until the buyer explicitly supplies it.
alter table public.icash_network_buyers add column available_deals integer check(available_deals between 0 and 100);
alter function public.icash_network_save_buyer(uuid,jsonb) rename to icash_network_save_buyer_before_capacity;
create function public.icash_network_save_buyer(p_user uuid,p_profile jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare buyer uuid;
begin
 if p_profile ? 'availableDeals' and p_profile->'availableDeals'<>'null'::jsonb and
 (jsonb_typeof(p_profile->'availableDeals')<>'number' or (p_profile->>'availableDeals')::numeric<>trunc((p_profile->>'availableDeals')::numeric) or (p_profile->>'availableDeals')::integer not between 0 and 100) then raise exception 'Invalid buying capacity';end if;
 buyer:=public.icash_network_save_buyer_before_capacity(p_user,p_profile);
 if p_profile ? 'availableDeals' then update public.icash_network_buyers set available_deals=(p_profile->>'availableDeals')::integer where id=buyer and user_id=p_user;end if;
 return buyer;
end $$;
alter function public.icash_network_profile(uuid) rename to icash_network_profile_before_capacity;
create function public.icash_network_profile(p_user uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_network_profile_before_capacity(p_user)||jsonb_build_object('availableDeals',b.available_deals)
 from public.icash_network_buyers b where b.user_id=p_user
$$;
create function public.icash_current_buyer_demand(p_zip text,p_price bigint default null,p_repairs bigint default null) returns jsonb
language sql stable security invoker set search_path='' as $$
 with buyers as (
 select b.* from public.icash_network_buyers b join auth.users u on u.id=b.user_id and u.email_confirmed_at is not null and lower(btrim(u.email))=b.email
 where not b.paused and b.expires_at>now() and b.zips @> array[p_zip] and 'house'=any(b.property_types)
 and (b.available_deals is null or b.available_deals>0)
 and (p_price is null or b.max_price_cents>=p_price) and (p_repairs is null or b.max_repairs_cents>=p_repairs)
 and not exists(select 1 from public.icash_email_suppressions s where lower(s.email)=b.email)
 ) select case when count(*)<3 then jsonb_build_object('buyers',0,'capacityBuyers',0,'score',0) else
 jsonb_build_object('buyers',count(*),'capacityBuyers',count(*) filter(where available_deals>0),
 'budgetCents',floor(percentile_cont(0.5) within group(order by max_price_cents)/1000000)*1000000,
 'repairBudgetCents',floor(percentile_cont(0.5) within group(order by max_repairs_cents)/100000)*100000,
 'score',least(1,(count(*)+count(*) filter(where available_deals>0))::numeric/20)) end from buyers
$$;
alter function public.icash_opportunity_market_score(uuid,text) rename to icash_opportunity_market_score_before_demand;
create function public.icash_opportunity_market_score(p_account uuid,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select 0.8*public.icash_opportunity_market_score_before_demand(p_account,p_zip)
  +0.2*coalesce((public.icash_current_buyer_demand(p_zip)->>'score')::numeric,0)
$$;
alter function public.icash_opportunity_score(uuid,jsonb,text) rename to icash_opportunity_score_before_demand;
create function public.icash_opportunity_score(p_account uuid,p_result jsonb,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select case when p_result->'financialCheck'->>'status'='eligible' then
 0.8*public.icash_opportunity_score_before_demand(p_account,p_result,p_zip)
 +0.2*case when jsonb_typeof(p_result->'property'->'offerCalculation'->'buyerCeilingCents')='number'
 and jsonb_typeof(p_result->'property'->'offerCalculation'->'repairCents')='number' then
 coalesce((public.icash_current_buyer_demand(p_zip,(p_result->'property'->'offerCalculation'->>'buyerCeilingCents')::bigint,
 (p_result->'property'->'offerCalculation'->>'repairCents')::bigint)->>'score')::numeric,0) else 0 end else -1 end
$$;
-- The existing source selector already orders by these functions before buying
-- contact research or rotating an authorized inventory market.
alter function public.icash_network_demand(uuid) rename to icash_network_demand_before_capacity;
create function public.icash_network_demand(p_account uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;markets jsonb;
begin
 result:=public.icash_network_demand_before_capacity(p_account);
 select coalesce(jsonb_agg(m||jsonb_build_object('matchingHouses',d->'buyers','capacityBuyers',d->'capacityBuyers',
 'budgetCents',d->'budgetCents','repairBudgetCents',d->'repairBudgetCents') order by (d->>'score')::numeric desc,m->>'zip'),'[]')
 into markets from jsonb_array_elements(result->'markets') m cross join lateral public.icash_current_buyer_demand(m->>'zip') as demand(d);
 return result||jsonb_build_object('markets',markets);
end $$;

create table public.icash_buyer_deal_feedback(
 id uuid primary key,match_id uuid not null references public.icash_network_matches(id),
 reason text not null check(reason in ('price','repairs','timing','location','capacity','other')),
 counteroffer_cents bigint check(counteroffer_cents between 100000 and 10000000000 and counteroffer_cents%100000=0),
 created_at timestamptz not null default now(),check(counteroffer_cents is null or reason='price')
);
create index icash_buyer_deal_feedback_match on public.icash_buyer_deal_feedback(match_id,created_at desc);
alter table public.icash_buyer_deal_feedback enable row level security;
revoke all on public.icash_buyer_deal_feedback from public,anon,authenticated;
grant select,insert on public.icash_buyer_deal_feedback to service_role;
create function public.icash_network_feedback(p_user uuid,p_match uuid,p_state text,p_key uuid,p_reason text,p_price bigint default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_network_matches m join public.icash_network_buyers b on b.id=m.buyer_id
 where m.id=p_match and b.user_id=p_user for update of m;
 if not found then raise exception 'Match unavailable';end if;
 if exists(select 1 from public.icash_buyer_deal_feedback where id=p_key and match_id=p_match and reason=p_reason and counteroffer_cents is not distinct from p_price) then return;end if;
 perform public.icash_network_respond(p_user,p_match,p_state);
 insert into public.icash_buyer_deal_feedback(id,match_id,reason,counteroffer_cents) values(p_key,p_match,p_reason,p_price);
end $$;
revoke all on function public.icash_network_save_buyer(uuid,jsonb),public.icash_network_profile(uuid),public.icash_current_buyer_demand(text,bigint,bigint),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_network_demand(uuid),public.icash_network_feedback(uuid,uuid,text,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_network_save_buyer(uuid,jsonb),public.icash_network_profile(uuid),public.icash_current_buyer_demand(text,bigint,bigint),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_network_demand(uuid),public.icash_network_feedback(uuid,uuid,text,uuid,text,bigint) to service_role;

set local lock_timeout='5s';
create table public.icash_deal_recovery_authorizations(
 id uuid primary key,account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 actor_id uuid not null references auth.users(id),minimum_fee_cents bigint not null check(minimum_fee_cents between 500000 and 1000000 and minimum_fee_cents%100000=0),
 previous_terms jsonb not null,next_terms jsonb not null,created_at timestamptz not null default now()
);
create index icash_deal_recovery_authorizations_deal on public.icash_deal_recovery_authorizations(deal_id,created_at desc,id);
create index icash_deal_recovery_authorizations_account on public.icash_deal_recovery_authorizations(account_id);
create index icash_deal_recovery_authorizations_actor on public.icash_deal_recovery_authorizations(actor_id);
alter table public.icash_deal_recovery_authorizations enable row level security;
revoke all on public.icash_deal_recovery_authorizations from public,anon,authenticated;
grant select,insert on public.icash_deal_recovery_authorizations to service_role;
create function public.icash_buyer_assignment_pricing(p_price bigint,p_snapshot jsonb,p_fee bigint,p_minimum bigint) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare data jsonb;arv numeric;repairs numeric;budget bigint;target bigint;fee bigint;room bigint;
begin
 if p_minimum is null or p_minimum not between 500000 and 1000000 or p_minimum%100000<>0 then return jsonb_build_object('ready',false,'reason','fee_authorization_required');end if;
 if p_price is null or p_price not between 1 and 99999000000 then return jsonb_build_object('ready',false,'reason','purchase_price_required');end if;
 if p_price%100000<>0 then return jsonb_build_object('ready',false,'reason','rounded_purchase_required');end if;
 data:=p_snapshot->'raw'->'data';
 if p_snapshot->>'propertyType' is distinct from 'house' or jsonb_typeof(data->'estimated_value') is distinct from 'number'
 or jsonb_typeof(data->'estimated_repair_cost') is distinct from 'number' then return jsonb_build_object('ready',false,'reason','research_required');end if;
 arv:=(data->>'estimated_value')::numeric*100;repairs:=(data->>'estimated_repair_cost')::numeric*100;
 if arv<=0 or repairs<0 or arv>9007199254740991 or repairs>9007199254740991 or arv<>trunc(arv) or repairs<>trunc(repairs) then return jsonb_build_object('ready',false,'reason','research_required');end if;
 budget:=floor(greatest(arv-repairs,0)*7000/10000)::bigint;target:=case when arv>=30000000 then 2000000 else 1000000 end;
 room:=floor((budget-p_price)::numeric/100000)::bigint*100000;
 if room<p_minimum then return jsonb_build_object('ready',false,'reason','insufficient_margin','minimumFeeCents',p_minimum);end if;
 fee:=coalesce(p_fee,least(target,room));
 if fee not between p_minimum and 100000000000 or fee%100000<>0 then return jsonb_build_object('ready',false,'reason','rounded_fee_required','minimumFeeCents',p_minimum);end if;
 if fee>room or p_price+fee>100000000000 then return jsonb_build_object('ready',false,'reason','fee_exceeds_buyer_budget');end if;
 return jsonb_build_object('ready',true,'assignmentFeeCents',fee,'assignmentDepositCents',least(fee/5,500000),
 'askingPriceCents',p_price+fee,'buyerCeilingCents',budget,'targetFeeCents',target,'minimumFeeCents',p_minimum);
end $$;
create function public.icash_deal_minimum_fee(p_account uuid,p_deal uuid) returns bigint
language sql stable security invoker set search_path='' as $$
 select coalesce((select minimum_fee_cents from public.icash_deal_recovery_authorizations where account_id=p_account and deal_id=p_deal order by created_at desc,id desc limit 1),1000000)
$$;
create function public.icash_deal_recovery_editable(p_account uuid,p_deal uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_deal_files d where d.id=p_deal and d.account_id=p_account and d.stage='under_contract'
 and coalesce(d.terms->>'practice','false')<>'true')
 and not exists(select 1 from public.icash_disposition_authorities where deal_id=p_deal)
 and not exists(select 1 from public.icash_buyer_package_links where deal_id=p_deal)
 and not exists(select 1 from public.icash_signing_envelopes where deal_id=p_deal and kind='assignment' and not test_mode)
$$;
create function public.icash_deal_recovery(p_account uuid,p_deal uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('editable',public.icash_deal_recovery_editable(p_account,p_deal),'termsHash',md5(d.terms::text),
 'minimumFeeCents',public.icash_deal_minimum_fee(p_account,p_deal),
 'proposal',public.icash_buyer_assignment_pricing((d.terms->>'priceCents')::bigint,s.snapshot,null,500000),
 'feedback',coalesce((select jsonb_agg(row order by created_at desc) from (
  select f.created_at,jsonb_build_object('id',f.id,'reason',f.reason,'counterofferCents',f.counteroffer_cents,
  'buyerPriceCents',a.asking_price_cents,'gapCents',case when f.counteroffer_cents is not null then greatest(0,a.asking_price_cents-f.counteroffer_cents) end,
  'createdAt',f.created_at) row from public.icash_buyer_deal_feedback f join public.icash_network_matches m on m.id=f.match_id
  left join public.icash_disposition_authorities a on a.deal_id=m.deal_id and a.account_id=m.account_id
  where m.account_id=p_account and m.deal_id=p_deal order by f.created_at desc limit 10) feedback),'[]'))
 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
$$;
create function public.icash_authorize_deal_recovery(p_account uuid,p_actor uuid,p_deal uuid,p_key uuid,p_terms_hash text,p_minimum bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;s public.icash_screening_jobs;plan jsonb;next_terms jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Account owner required';end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found then raise exception 'Deal unavailable';end if;
 if exists(select 1 from public.icash_deal_recovery_authorizations where id=p_key and account_id=p_account and actor_id=p_actor and deal_id=p_deal and minimum_fee_cents=p_minimum) then return public.icash_deal_recovery(p_account,p_deal);end if;
 if md5(d.terms::text) is distinct from p_terms_hash or not public.icash_deal_recovery_editable(p_account,p_deal) then raise exception 'Terms changed or already released';end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete';
 if not found then raise exception 'Current research required';end if;
 plan:=public.icash_buyer_assignment_pricing((d.terms->>'priceCents')::bigint,s.snapshot,null,p_minimum);
 if plan->'ready' is distinct from 'true'::jsonb then raise exception 'Deal does not fit this fee floor';end if;
 next_terms:=d.terms||jsonb_build_object('assignmentFeeCents',plan->'assignmentFeeCents','assignmentDepositCents',plan->'assignmentDepositCents');
 insert into public.icash_deal_recovery_authorizations values(p_key,p_account,p_deal,p_actor,p_minimum,d.terms,next_terms,now());
 update public.icash_deal_files set terms=next_terms where id=d.id;
 update public.icash_fulfillment_jobs set state='ready',updated_at=now() where account_id=p_account and deal_id=p_deal and state='complete';
 return public.icash_deal_recovery(p_account,p_deal);
end $$;
do $patch$
declare d text;signature text;needle text;
begin
 foreach signature in array array['public.icash_prepare_disposition_before_deposit(uuid,uuid)','public.icash_unreleased_buyer_pricing(uuid,uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  needle:=case when signature like '%before_deposit%' then 'public.icash_buyer_assignment_pricing(price,s.snapshot,(d.terms->>''assignmentFeeCents'')::bigint)' else 'public.icash_buyer_assignment_pricing((d.terms->>''priceCents'')::bigint,s.snapshot,(d.terms->>''assignmentFeeCents'')::bigint)' end;
  if position(needle in d)=0 then raise exception 'Recovery pricing prerequisite changed';end if;
  execute replace(d,needle,left(needle,length(needle)-1)||',public.icash_deal_minimum_fee(p_account,p_deal))');
 end loop;
end $patch$;
revoke all on function public.icash_buyer_assignment_pricing(bigint,jsonb,bigint,bigint),public.icash_deal_minimum_fee(uuid,uuid),public.icash_deal_recovery_editable(uuid,uuid),public.icash_deal_recovery(uuid,uuid),public.icash_authorize_deal_recovery(uuid,uuid,uuid,uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_buyer_assignment_pricing(bigint,jsonb,bigint,bigint),public.icash_deal_minimum_fee(uuid,uuid),public.icash_deal_recovery_editable(uuid,uuid),public.icash_deal_recovery(uuid,uuid),public.icash_authorize_deal_recovery(uuid,uuid,uuid,uuid,text,bigint) to service_role;

-- Activate only the seven reviewed, bounded continuations. All current source,
-- opt-out, manual takeover, hours, pause, credit and repetition gates still run.
update public.icash_seller_recovery_variants set enabled=true where key in
 ('unanswered-v1','unanswered-v2','repeat-v1','no-response-v1','no-response-v2','viewing-v1','viewing-v2');
commit;
