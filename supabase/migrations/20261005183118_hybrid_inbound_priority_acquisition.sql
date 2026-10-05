begin;
-- Owner-requested hybrid acquisition. This is sourcing policy, not recipient
-- consent, licensing clearance, or a promise of daily leads or closings.
create table public.icash_acquisition_policy(
 id integer primary key check(id=1),mode text not null check(mode in ('inbound','hybrid','outbound')),
 research_budget_share numeric not null default .25 check(research_budget_share between .05 and .5),
 updated_at timestamptz not null default now()
);
insert into public.icash_acquisition_policy(id,mode) values(1,'hybrid');
create table public.icash_research_state_exclusions(
 state_code text primary key check(state_code ~ '^[A-Z]{2}$'),reason text not null,source_url text not null,
 effective_from date not null default '2026-10-05',reviewed_on date not null default '2026-10-05'
);
-- Conservative exclusions for an automated, unlicensed, repeated assignment
-- business. Some requirements are conditional or registration rather than a
-- blanket license rule. Other states still have disclosure/transaction duties.
insert into public.icash_research_state_exclusions(state_code,reason,source_url) values
 ('CT','Wholesaler registration','https://portal.ct.gov/dcp/license-services-division/all-license-applications/real-estate-wholesaler'),
 ('IL','Repeated assignable-contract transactions require licensing','https://www.ilga.gov/legislation/ilcs/documents/022504540K1-10.htm'),
 ('IA','Licensed broker or broker representation','https://rules.iowa.gov/Notice/Details/9252C'),
 ('MN','Repeated principal transactions require licensing or representation','https://www.revisor.mn.gov/statutes/cite/82.55'),
 ('NE','Public marketing of equitable interests requires licensing','https://nebraskalegislature.gov/laws/statutes.php?statute=81-885.02'),
 ('OK','Public marketing requires licensing; additional wholesale rules','https://oklahoma.gov/orec/investigations/investigations-faq.html'),
 ('OR','Residential wholesaler registration or applicable license','https://www.oregon.gov/rea/licensing/other-licenses/pages/residential-property-wholesaler.aspx'),
 ('PA','Wholesaling is licensed activity','https://www.legis.state.pa.us/cfdocs/billInfo/bill_history.cfm?syear=2023&sind=0&body=S&type=B&bn=1173'),
 ('SC','Restrictions on marketing property before title','https://llr.sc.gov/re/News/Wholesaling-Assignment-of-Contracts-Guidance.pdf'),
 ('UT','Regulator guidance on repeated assignment business','https://realestate.utah.gov/wp-content/uploads/2023/04/newsletter_q4-2018.pdf'),
 ('VA','Two or more assignable-contract transactions in 12 months','https://law.lis.virginia.gov/vacode/title54.1/chapter21/section54.1-2100/'),
 ('WI','Pattern of selling real estate interests triggers licensing','https://docs.legis.wisconsin.gov/statutes/statutes/452/01');
alter table public.icash_acquisition_policy enable row level security;
alter table public.icash_research_state_exclusions enable row level security;
revoke all on public.icash_acquisition_policy,public.icash_research_state_exclusions from public,anon,authenticated;
grant select on public.icash_acquisition_policy,public.icash_research_state_exclusions to service_role;
create function public.icash_research_state_allowed(p_state text) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(upper(trim(p_state))=any(string_to_array('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC',' ')),false)
 and not exists(select 1 from public.icash_research_state_exclusions where state_code=upper(trim(p_state)) and effective_from<=current_date)
$$;
-- Only explicit state tokens in a postal address. Never guess a state from a
-- phone number or ZIP prefix. Ambiguous submissions are kept without paid work.
create function public.icash_address_state(p_address text) returns text language sql immutable set search_path='' as $$
 with states as (select key code,value name from jsonb_each_text('{"AL":"Alabama","AK":"Alaska","AZ":"Arizona","AR":"Arkansas","CA":"California","CO":"Colorado","CT":"Connecticut","DE":"Delaware","FL":"Florida","GA":"Georgia","HI":"Hawaii","ID":"Idaho","IL":"Illinois","IN":"Indiana","IA":"Iowa","KS":"Kansas","KY":"Kentucky","LA":"Louisiana","ME":"Maine","MD":"Maryland","MA":"Massachusetts","MI":"Michigan","MN":"Minnesota","MS":"Mississippi","MO":"Missouri","MT":"Montana","NE":"Nebraska","NV":"Nevada","NH":"New Hampshire","NJ":"New Jersey","NM":"New Mexico","NY":"New York","NC":"North Carolina","ND":"North Dakota","OH":"Ohio","OK":"Oklahoma","OR":"Oregon","PA":"Pennsylvania","RI":"Rhode Island","SC":"South Carolina","SD":"South Dakota","TN":"Tennessee","TX":"Texas","UT":"Utah","VT":"Vermont","VA":"Virginia","WA":"Washington","WV":"West Virginia","WI":"Wisconsin","WY":"Wyoming","DC":"District of Columbia"}'::jsonb))
 select code from states where trim(p_address) ~* ('[ ,]('||code||'|'||name||')([ ,]+[0-9]{5}(-[0-9]{4})?)?([ ,]+(USA|US|United States))?$') limit 1
$$;
create or replace function public.icash_research_zip_known(p_zip text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_market_shortlist where zip=p_zip and public.icash_research_state_allowed(state))
 or exists(select 1 from public.icash_property_zip_geographies where zip=p_zip and public.icash_research_state_allowed(state_code) and property_count>0 and checked_at<=now() and expires_at>now())
$$;
-- A planning target, never a lead guarantee. Bigger budgets receive a higher
-- target share of requests; small accounts rely more on exclusive prospecting.
create function public.icash_hybrid_inbound_share(p_daily bigint) returns numeric language sql immutable set search_path='' as $$
 select case when p_daily>=5000 then .5 when p_daily>=2500 then .35 else .2 end
$$;
-- Exclusive lifetime ownership for newly sourced outbound records. Inbound
-- sharing keeps its separate three-recipient schedule and consent provenance.
create table public.icash_outbound_property_owners(
 property_id text primary key,account_id uuid not null references public.icash_accounts(id),
 assigned_at timestamptz not null default now()
);
alter table public.icash_outbound_property_owners enable row level security;
revoke all on public.icash_outbound_property_owners from public,anon,authenticated;
grant select,insert on public.icash_outbound_property_owners to service_role;
insert into public.icash_outbound_property_owners(property_id,account_id)
 select distinct on(snapshot->>'propertyId') snapshot->>'propertyId',account_id from public.icash_screening_jobs
 where event_key like 'discovery:%' and snapshot->>'propertyId' ~ '^prop_[A-Za-z0-9]+$'
 order by snapshot->>'propertyId',created_at,id on conflict do nothing;
create function public.icash_outbound_search_due(p_account uuid) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare a public.icash_accounts;c public.icash_discovery_configs;policy public.icash_acquisition_policy;capacity bigint;research_spend bigint;cost bigint;target integer;inbound_count integer;outbound_count integer;profile jsonb;
begin
 select * into policy from public.icash_acquisition_policy where id=1;
 if not found or policy.mode='inbound' then return false;end if;
 select * into a from public.icash_accounts where id=p_account;
 if not found or a.bot_paused or a.daily_limit_cents<=0 then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now() or not public.icash_research_zip_known(c.zip) then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return false;end if;
 select charge_cents into cost from public.icash_operation_rates where id=c.rate_id and enabled and expires_at>now() and operation='property_search';
 if cost is null then return false;end if;
 select least(w.balance_cents-w.reserved_cents,a.daily_limit_cents-w.reserved_cents-coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours'),0)) into capacity from public.icash_wallets w where account_id=p_account;
 if capacity is null or capacity<cost then return false;end if;
 select coalesce(sum(case when o.state='settled' then o.charged_cents else o.charge_cap_cents end),0) into research_spend
 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
 where o.account_id=p_account and r.operation in ('property_search','owner_enrichment') and o.state in ('reserved','dispatched','settled') and o.created_at>now()-interval '24 hours';
 -- Protect most of the budget for conversations and deal work.
 if research_spend+cost>floor(a.daily_limit_cents*policy.research_budget_share) then return false;end if;
 if exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state in ('queued','running') and s.created_at>now()-interval '1 day') then return false;end if;
 if policy.mode='outbound' then return true;end if;
 select bs.profile into profile from public.icash_bot_setups bs where account_id=p_account;
 -- Let an affordable, due inbound request be delivered before buying a page.
 if a.billing_model='daily' and exists(select 1 from public.icash_daily_plans p where p.account_id=p_account and p.state='active' and p.mode='live' and p.consent_version like 'daily-2026-10-04.1%') and exists(select 1 from public.icash_seller_intakes l where l.state in ('qualified','assigned') and l.next_assignment_at<=now() and l.data_rights_until>now() and l.checked_at>now()-interval '8 days'
 and public.icash_research_state_allowed(l.property->>'state') and (profile->>'marketMode'='nationwide' or lower(trim(profile->>'market')) in (lower(l.property->>'city'),lower(l.property->>'city')||', '||lower(l.property->>'state'),l.property->>'zip'))
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=p_account)
 and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations lc on lc.account_id=sm.account_id and lc.screening_id=sm.screening_id join public.icash_contact_suppressions cs on cs.account_id=lc.account_id and cs.contact_key=lc.contact_key where sm.lead_id=l.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=l.id)
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=l.id)<=now()
 and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>p_account)
 and ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,l.lookup_costs)))*3/10000)<=capacity) then return false;end if;
 target:=least(20,greatest(2,ceil(a.daily_limit_cents::numeric/1000)::integer));
 select count(*) into inbound_count from public.icash_seller_matches where account_id=p_account and assigned_at>now()-interval '24 hours';
 select count(*) into outbound_count from public.icash_screening_jobs where account_id=p_account and state='complete' and completed_at>now()-interval '24 hours' and event_key like 'discovery:%' and result->'financialCheck'->>'status'='eligible';
 -- Refill a real shortfall. Never buy filler merely to create a daily charge.
 return inbound_count+outbound_count<target and outbound_count<case when inbound_count>=ceil(target*public.icash_hybrid_inbound_share(a.daily_limit_cents)) then ceil(target*(1-public.icash_hybrid_inbound_share(a.daily_limit_cents))) else greatest(1,target-inbound_count) end;
end $$;
-- POLICY FUNCTIONS END (isolated decision tests use the real definitions above).
do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text)'::regprocedure);
 needle:=$n$op:='discovery:'||p_account||':'||p_revision||':'||p_page;$n$;
 if position(needle in def)=0 then raise exception 'Discovery claim boundary changed';end if;
 def:=replace(def,needle,E'if not public.icash_research_zip_known(p_zip) or not public.icash_outbound_search_due(p_account) then return false;end if;\n '||needle);execute def;
 def:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:='if c.exhausted or backlog>=c.max_open_prospects then continue;end if;';
 if position(needle in def)=0 then raise exception 'Acquisition scheduler boundary changed';end if;
 execute replace(def,needle,'if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then continue;end if;');
 def:=pg_get_functiondef('public.icash_provision_before_voice_template(uuid)'::regprocedure);
 def:=replace(def,$n$m.state ~ '^[A-Z]{2}$'$n$,'public.icash_research_state_allowed(m.state)');execute def;
 def:=pg_get_functiondef('public.icash_rotate_inventory_market(uuid)'::regprocedure);
 needle:='and eligible_until>now() and next_scan_at<=now()';
 if position(needle in def)=0 then raise exception 'Market rotation boundary changed';end if;
 execute replace(def,needle,needle||' and public.icash_research_zip_known(zip)');
 def:=pg_get_functiondef('public.icash_claim_market_research(uuid,uuid)'::regprocedure);
 needle:='n:=case when j.kind=';
 if position(needle in def)=0 then raise exception 'Market research claim boundary changed';end if;
 execute replace(def,needle,'if not public.icash_research_state_allowed(j.state_code) or not exists(select 1 from public.icash_accounts ac where ac.id=j.account_id and not ac.bot_paused) then return null;end if; '||needle);
 def:=pg_get_functiondef('public.icash_next_before_seller_openers()'::regprocedure);
 needle:='from public.icash_market_research_scopes where enabled and next_scan_at<=now()';
 if position(needle in def)=0 then raise exception 'Free research scope scheduler changed';end if;
 def:=replace(def,needle,needle||' and public.icash_research_state_allowed(state) and exists(select 1 from public.icash_accounts ac where ac.id=account_id and not ac.bot_paused)');
 needle:=$n$where q.state<>'complete' and q.attempts<3 and q.next_attempt_at<=now()$n$;
 if position(needle in def)=0 then raise exception 'Free research job scheduler changed';end if;
 def:=replace(def,needle,needle||' and public.icash_research_state_allowed(q.state_code) and exists(select 1 from public.icash_accounts ac where ac.id=q.account_id and not ac.bot_paused)');execute def;
 def:=pg_get_functiondef('public.icash_enrichment_candidate(uuid)'::regprocedure);
 needle:=$n$and s.state='complete'$n$;
 if position(needle in def)=0 then raise exception 'Enrichment candidate boundary changed';end if;
 execute replace(def,needle,needle||$n$ and s.snapshot->'sellerRequest' is null and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state')$n$);
 def:=pg_get_functiondef('public.icash_claim_seller_lookup_for(uuid)'::regprocedure);
 needle:=$n$select * into l from public.icash_seller_intakes where state='received'$n$;
 if position(needle in def)=0 then raise exception 'Intake lookup boundary changed';end if;
 def:=replace(def,needle,$n$update public.icash_seller_intakes set state='review',hold_reason='Property state is excluded or needs an exact postal address; no paid research started' where state='received' and (p_id is null or id=p_id) and not public.icash_research_state_allowed(public.icash_address_state(address));
 select * into l from public.icash_seller_intakes where state='received'$n$);execute def;
 def:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle:=$n$city_name:=lower(trim(l.property->>'city'));state_code:=upper(l.property->>'state');$n$;
 if position(needle in def)=0 then raise exception 'Seller assignment boundary changed';end if;
 def:=replace(def,needle,needle||$n$
 if not public.icash_research_state_allowed(state_code) then update public.icash_seller_intakes set state='review',hold_reason='State excluded from automatic acquisition' where id=l.id;return jsonb_build_object('status','state_excluded');end if;$n$);
 -- Higher budgets get greater access while the existing no-lead fairness and
 -- waiting-time rotation keep small funded accounts in the distribution.
 def:=replace(def,'/sqrt(greatest(candidate.capacity,charge)::numeric/charge)','/power(greatest(candidate.capacity,charge)::numeric/charge,0.75) / public.icash_hybrid_inbound_share((select daily_limit_cents from public.icash_accounts where id=candidate.id))');
 needle:=$n$where ac.billing_model='daily' and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id$n$;
 if position(needle in def)=0 then raise exception 'Seller candidate filter changed';end if;
 -- Do not sell a later inbound submission of an exclusive property to another client.
 def:=replace(def,needle,$n$where not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>ac.id) and ac.billing_model='daily' and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id$n$);execute def;
end $patch$;
do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_save_discovery(uuid,text,uuid,integer,jsonb)'::regprocedure);
 needle:=$n$perform public.icash_enqueue_screening(p_account,$n$;
 if position(needle in def)=0 then raise exception 'Discovery persistence changed';end if;
 def:=replace(def,needle,$n$if not public.icash_research_state_allowed(row->>'state') then continue;end if;
  insert into public.icash_outbound_property_owners(property_id,account_id) values(row->>'dm_property_id',p_account) on conflict do nothing;
  if not exists(select 1 from public.icash_outbound_property_owners where property_id=row->>'dm_property_id' and account_id=p_account)
   or exists(select 1 from public.icash_screening_jobs where account_id=p_account and snapshot->>'propertyId'=row->>'dm_property_id') then continue;end if;
  perform public.icash_enqueue_screening(p_account,$n$);execute def;
 def:=pg_get_functiondef('public.icash_claim_inventory(uuid,uuid,text)'::regprocedure);
 needle:=$n$keys:=array['property:'||prop];$n$;
 if position(needle in def)=0 then raise exception 'Inventory claim changed';end if;
 execute replace(def,needle,$n$if exists(select 1 from public.icash_outbound_property_owners where property_id=prop and account_id<>p_account) then return false;end if;
 keys:=array['property:'||prop];$n$);
end $patch$;
create function public.icash_research_purchase_allowed(p_account uuid,p_operation text,p_rate uuid) returns boolean language plpgsql stable security invoker set search_path='' as $$
 declare r public.icash_operation_rates;a public.icash_accounts;p public.icash_acquisition_policy;spent bigint;screen public.icash_screening_jobs;
 begin
  select * into r from public.icash_operation_rates where id=p_rate;
  if not found then return false;end if;
  if r.operation not in ('property_search','owner_enrichment') then return true;end if;
  select * into p from public.icash_acquisition_policy where id=1;
  if not found or p.mode='inbound' then return false;end if;
  select * into a from public.icash_accounts where id=p_account;
  if not found or a.bot_paused or a.daily_limit_cents<=0 then return false;end if;
  select coalesce(sum(case when o.state='settled' then o.charged_cents else o.charge_cap_cents end),0) into spent from public.icash_operation_spend o join public.icash_operation_rates rate on rate.id=o.rate_id
   where o.account_id=p_account and o.operation_key<>p_operation and rate.operation in ('property_search','owner_enrichment') and o.state in ('reserved','dispatched','settled') and o.created_at>now()-interval '24 hours';
  if spent+r.charge_cents>floor(a.daily_limit_cents*p.research_budget_share) then return false;end if;
  if r.operation='owner_enrichment' then
   select * into screen from public.icash_screening_jobs where account_id=p_account and 'owners:'||p_account||':'||id=p_operation;
   if not found or screen.snapshot->'sellerRequest' is not null or not public.icash_research_state_allowed(screen.snapshot->'raw'->'data'->>'state') then return false;end if;
   if exists(select 1 from public.icash_outbound_property_owners where property_id=screen.snapshot->>'propertyId' and account_id<>p_account) then return false;end if;
  elsif not exists(select 1 from public.icash_discovery_configs where account_id=p_account and public.icash_research_zip_known(zip)) then return false;
  end if;
  return true;
 end $$;
do $patch$ declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure);
 needle:='if not public.icash_membership_work_allowed(p_account)';
 if position(needle in def)=0 then raise exception 'Reservation boundary changed';end if;
 execute replace(def,needle,$n$perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_operation_spend where operation_key=p_operation) and not public.icash_research_purchase_allowed(p_account,p_operation,p_rate) then raise exception 'Research pacing or state hold';end if;
 if not public.icash_membership_work_allowed(p_account)$n$);
 def:=pg_get_functiondef('public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz)'::regprocedure);
 needle:='return public.icash_claim_operation(p_operation);';
 if position(needle in def)=0 then raise exception 'Owner dispatch boundary changed';end if;
 execute replace(def,needle,'if not public.icash_research_purchase_allowed(p_account,p_operation,p_rate) then return false;end if; '||needle);
 end $patch$;
-- All new helpers are server-only. No new owner data is exposed to clients.
do $$ declare f record;begin for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in ('icash_research_state_allowed','icash_address_state','icash_research_zip_known','icash_hybrid_inbound_share','icash_outbound_search_due','icash_research_purchase_allowed') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
end loop;end $$;
-- Explicit platform release only; do not unpause accounts or create funding.
update public.icash_discovery_configs set auto_enabled=true,next_run_at=now() where enabled and data_rights_until>now() and public.icash_research_zip_known(zip);
update public.icash_market_research_scopes set enabled=true,next_scan_at=now() where public.icash_research_state_allowed(state);
-- Retire the prior inbound-only release's infinite holds without replaying them.
update public.icash_market_research_jobs set attempts=3 where state='held' and next_attempt_at='infinity' and attempts<3;
-- Old held jobs stay historical; the scheduler creates a new bounded cycle.
commit;
