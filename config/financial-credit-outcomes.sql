-- Observational owner reporting and complete carrier-attempt costs. No spend.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- A no-answer carrier attempt can cost money without an AI conversation.
-- Include it in both the denominator and cost-completeness proof.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure);
 if md5(d)='dccbe762e4f16bb2164a88df58ae3c83' then return;end if;
 if md5(d)<>'272162f19f5dcec30539310b97fb8e80' then raise exception 'Financial learning prerequisite changed';end if;
 needle:='    union all select o.dispatched_at from public.icash_deal_files d';
 if strpos(d,needle)=0 then raise exception 'Financial attempt boundary changed';end if;
 d:=replace(d,needle,$new$
    union all select o.dispatched_at from public.icash_call_recordings r
     join public.icash_operation_spend o on o.account_id=r.account_id and o.operation_key=r.operation_key
     where r.account_id=a.account_id and r.screening_id=a.screening_id and r.party='seller'
      and nullif(btrim(r.call_sid),'') is not null and o.dispatched_at>=r.created_at
    union all select o.dispatched_at from public.icash_voice_jobs j
     join public.icash_operation_spend o on o.account_id=j.account_id and o.operation_key=j.operation_key
     left join public.icash_operational_contacts oc on oc.id=j.operational_contact_id and oc.account_id=j.account_id
     left join public.icash_contact_permissions cp on cp.id=j.permission_id and cp.account_id=j.account_id and cp.party='seller'
     where j.account_id=a.account_id and coalesce(oc.screening_id,cp.screening_id)=a.screening_id
      and nullif(btrim(j.provider_call_sid),'') is not null and o.dispatched_at>=j.created_at
$new$||needle);
 needle:='  union all select p.strategy,''text:''||m.id,m.provider_id is not null from prospects p';
 if strpos(d,needle)=0 then raise exception 'Financial cost boundary changed';end if;
 d:=replace(d,needle,$new$
  union all select p.strategy,r.operation_key,r.call_sid is not null from prospects p
   join public.icash_call_recordings r on r.account_id=p_account and r.screening_id=p.screening_id and r.party='seller'
  union all select p.strategy,j.operation_key,j.provider_call_sid is not null from prospects p
   join public.icash_voice_jobs j on j.account_id=p_account
   left join public.icash_operational_contacts oc on oc.id=j.operational_contact_id and oc.account_id=j.account_id
   left join public.icash_contact_permissions cp on cp.id=j.permission_id and cp.account_id=j.account_id and cp.party='seller'
   where coalesce(oc.screening_id,cp.screening_id)=p.screening_id
$new$||needle);
 execute d;
end $patch$;

-- Resume only these exact reviewed definitions after a migration-ledger collision.
do $guard$
begin
 if to_regprocedure('public.icash_financial_credit_report(uuid,uuid,integer)') is not null
  and md5(pg_get_functiondef(to_regprocedure('public.icash_financial_credit_report(uuid,uuid,integer)')))<>'0474e294bd7fa6d43263885f493fd443' then raise exception 'Financial report prerequisite changed';end if;
end $guard$;
create or replace function public.icash_financial_credit_report(p_actor uuid,p_account uuid,p_days integer default 90) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='20s' as $$
declare report jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 if p_account is null or p_days is null or p_days not between 1 and 180 then raise exception 'Bounded account scope required';end if;
 with pages as materialized (
  select p.*,coalesce(r.query_policy,q.policy,'null'::jsonb) policy,
   jsonb_build_object('zip',p.zip,'plan',p.plan-'providerPage'-'mode','queryPolicy',coalesce(r.query_policy,q.policy,'null'::jsonb)) cohort
  from public.icash_discovery_filter_pages p
  left join public.icash_discovery_inventory_receipts r on r.operation_key=p.operation_key and r.account_id=p.account_id
  left join icash_research_private.query_claims q on q.operation_key=p.operation_key and q.account_id=p.account_id
  where p.account_id=p_account and p.created_at between now()-make_interval(days=>p_days) and now()
 ), cohorts as (select distinct cohort from pages), samples as materialized (
  select p.cohort,p.created_at,a.screening_id,s.state,s.result,s.error_code,s.snapshot
  from pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
  join public.icash_screening_jobs s on s.id=a.screening_id and s.account_id=a.account_id
 ), outcomes as materialized (select * from public.icash_learning_deal_outcomes(p_account)),
 receipts as materialized (
  select o.screening_id,sum(r.amount_cents) amount_cents
  from outcomes o join public.icash_proceeds_receipts r on r.deal_id=o.deal_id and r.account_id=p_account
  join public.icash_closing_updates u on u.id=r.closing_update_id and u.account_id=r.account_id and u.deal_id=r.deal_id
  join public.icash_title_replies t on t.id=u.reply_id and t.account_id=u.account_id and t.deal_id=u.deal_id and t.sender_verified
  where o.closed_at is not null and o.closed_at<=r.created_at and o.purchase_at<=u.created_at and o.assignment_at<=u.created_at
   and u.kind='funds_disbursed' and u.amount_cents=r.amount_cents and r.amount_cents>0 and r.confirmed_by is not null
   and (u.confirmed_by is not null or u.confirmation_source='verified_title_format') and t.received_at<=u.created_at
   and u.created_at<=r.created_at and r.created_at<=now() and r.received_date>=u.effective_date
   and r.received_date<=(now() at time zone 'America/Chicago')::date
   and exists(select 1 from public.icash_closing_updates closed join public.icash_title_replies ct
    on ct.id=closed.reply_id and ct.account_id=closed.account_id and ct.deal_id=closed.deal_id and ct.sender_verified
    where closed.account_id=p_account and closed.deal_id=o.deal_id and closed.kind='closed'
     and closed.created_at between greatest(o.purchase_at,o.assignment_at) and r.created_at and ct.received_at<=closed.created_at
     and (closed.confirmed_by is not null or closed.confirmation_source='verified_title_format') and closed.effective_date<=r.received_date)
  group by o.screening_id
 ), observed as materialized (
  select s.*,
   s.state='complete' and s.result#>>'{financialCheck,status}'='eligible' qualified,
   exists(select 1 from public.icash_owner_contacts oc cross join lateral jsonb_array_elements(coalesce(oc.result->'contacts','[]')) person
    cross join lateral jsonb_array_elements(coalesce(person->'phones','[]')) phone where oc.account_id=p_account and oc.screening_id=s.screening_id
     and person->'likelyOwner'='true'::jsonb and phone->'doNotCall'='false'::jsonb and phone->>'activity'='active' and phone->>'number' ~ '^[0-9]{10}$') contactable,
   exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=s.screening_id
    and c.party='seller' and c.state='complete' and c.conversation_id is not null and c.completed_at between s.created_at and now()
    and public.icash_call_has_seller_response(c.result))
    or exists(select 1 from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
     join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where d.account_id=p_account and d.screening_id=s.screening_id
      and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null) and m.created_at between s.created_at and now()) conversation,
   exists(select 1 from icash_research_private.targeting_qualifications q where q.account_id=p_account and q.screening_id=s.screening_id and q.created_at between s.created_at and now()) qualified_seller,
   exists(select 1 from public.icash_deal_files d join icash_call_offer_private.events e on e.deal_id=d.id and e.account_id=d.account_id
    where d.account_id=p_account and d.screening_id=s.screening_id and e.action in('get_offer','update_repairs','accept_offer')
     and e.state->>'quotedPriceCents' ~ '^[1-9][0-9]*$' and e.created_at between s.created_at and now()) offer,
   exists(select 1 from outcomes o where o.screening_id=s.screening_id and o.purchase_at between s.created_at and now()) signed,
   exists(select 1 from outcomes o where o.screening_id=s.screening_id and o.closed_at between s.created_at and now()) closed,
   coalesce((select r.amount_cents from receipts r where r.screening_id=s.screening_id),0) proceeds
  from samples s
 ), raw_keys as (
  select cohort,operation_key,true required,'property' kind from pages where state not in('empty','unavailable')
  union all select cohort,'owners:'||p_account||':'||screening_id,
   exists(select 1 from public.icash_owner_contacts c where c.account_id=p_account and c.screening_id=s.screening_id),'contact' from samples s
 ), operation_keys as (select cohort,operation_key,bool_or(required) required,min(kind) kind from raw_keys group by cohort,operation_key),
 costs as (
  select k.cohort,coalesce(sum(c.amount) filter(where c.amount>=0 and c.units='provider_credits'),0) known_credits,
   coalesce(sum(c.amount) filter(where k.kind='property' and c.amount>=0 and c.units='provider_credits'),0) property_credits,
   coalesce(sum(c.amount) filter(where k.kind='contact' and c.amount>=0 and c.units='provider_credits'),0) contact_credits,
   bool_and(coalesce(case when o.operation_key is null then not k.required and c.event_key is null when o.state='cancelled' then not k.required and c.event_key is null
    else o.state='settled' and o.actual_micros is not null and o.charged_cents is not null and c.amount>=0 and c.units='provider_credits' end,false)) complete
  from operation_keys k left join public.icash_operation_spend o on o.operation_key=k.operation_key and o.account_id=p_account
  left join public.icash_cost_observations c on c.provider='dealmachine' and c.event_key=k.operation_key
   and c.source_ref=case when k.kind='property' then 'dealmachine:search:' else 'dealmachine:owners:' end||k.operation_key
  group by k.cohort
 ), funnel as (
  select cohort,count(*) properties,count(*) filter(where qualified) qualified,count(*) filter(where qualified and contactable) contactable,
   count(*) filter(where conversation) conversations,count(*) filter(where qualified and qualified_seller) qualified_sellers,
   count(*) filter(where qualified and offer) offers,count(*) filter(where signed) contracts,count(*) filter(where closed) closed,
   count(*) filter(where created_at<=now()-interval '30 days') contract_samples,count(*) filter(where created_at<=now()-interval '60 days') closing_samples,
   sum(proceeds) proceeds,
   sum(case when qualified and result#>>'{property,offerCalculation,assignmentFeeCents}' ~ '^[1-9][0-9]{0,12}$'
    then (result#>>'{property,offerCalculation,assignmentFeeCents}')::bigint else 0 end) estimated_fees,
   count(*) filter(where state='failed') technical_failures,
   count(*) filter(where result#>>'{financialCheck,category}'='financial_rejection') financial_rejections,
   count(*) filter(where result#>>'{financialCheck,category}'='missing_financial_information') missing_information,
   count(*) filter(where result#>>'{financialCheck,category}'='inconsistent_financial_calculation') inconsistent_calculations,
   count(*) filter(where state='complete' and result#>>'{financialCheck,status}'<>'eligible' and result#>>'{financialCheck,category}' is null) unclassified_legacy_holds
  from observed group by cohort
 ), rows as (
  select h.cohort scope_cohort,coalesce(c.complete,true) and not exists(select 1 from pages p where p.cohort=h.cohort and p.state not in('complete','empty','unavailable')) costs_complete,
   coalesce(c.known_credits,0) credits,c.property_credits,c.contact_credits,f.* from cohorts h left join costs c on c.cohort=h.cohort left join funnel f on f.cohort=h.cohort
 ) select coalesce(jsonb_agg(jsonb_build_object('scope',r.scope_cohort,'knownCredits',r.credits,'costsComplete',r.costs_complete,
  'propertyCredits',coalesce(r.property_credits,0),'contactCredits',coalesce(r.contact_credits,0),
  'properties',coalesce(r.properties,0),'financiallyQualified',coalesce(r.qualified,0),'contactableOwners',coalesce(r.contactable,0),
  'sellerConversations',coalesce(r.conversations,0),'qualifiedSellers',coalesce(r.qualified_sellers,0),'offerOpportunities',coalesce(r.offers,0),
  'signedContracts',coalesce(r.contracts,0),'closedDeals',coalesce(r.closed,0),'matureContractSamples',coalesce(r.contract_samples,0),'matureClosingSamples',coalesce(r.closing_samples,0),
  'creditsPerFinanciallyQualified',case when r.costs_complete then r.credits/nullif(r.qualified,0) end,
  'creditsPerContactableOwner',case when r.costs_complete then r.credits/nullif(r.contactable,0) end,
  'creditsPerSellerConversation',case when r.costs_complete then r.credits/nullif(r.conversations,0) end,
  'creditsPerQualifiedSeller',case when r.costs_complete then r.credits/nullif(r.qualified_sellers,0) end,
  'creditsPerOfferOpportunity',case when r.costs_complete then r.credits/nullif(r.offers,0) end,
  'creditsPerSignedContract',case when r.costs_complete then r.credits/nullif(r.contracts,0) end,
  'creditsPerClosedDeal',case when r.costs_complete then r.credits/nullif(r.closed,0) end,
  'estimatedPotentialFeesCents',coalesce(r.estimated_fees,0),'receivedProceedsCents',coalesce(r.proceeds,0),
  'estimatedPotentialFeesCentsPerCredit',case when r.costs_complete then r.estimated_fees/nullif(r.credits,0) end,
  'receivedProceedsCentsPerCredit',case when r.costs_complete then r.proceeds/nullif(r.credits,0) end,
  'technicalFailures',coalesce(r.technical_failures,0),'financialRejections',coalesce(r.financial_rejections,0),'missingInformation',coalesce(r.missing_information,0),
  'inconsistentCalculations',coalesce(r.inconsistent_calculations,0),'unclassifiedLegacyHolds',coalesce(r.unclassified_legacy_holds,0))), '[]') into report from rows r;
 return jsonb_build_object('version','financial-credit-outcomes-v1','checkedAt',now(),'accountId',p_account,'days',p_days,'cohorts',report,
  'definitions',jsonb_build_object('credits','Actual DealMachine property and contact credits, including unsuccessful pages; exact total receipts only, never receipt subtotals.',
   'contactableOwners','Properties with a likely-owner active non-DNC phone in saved research; current outreach eligibility is separately enforced.',
   'qualifiedSellers','Financially eligible properties with source-bound completed seller qualification. Motivation is not independently verified.',
   'fees','Potential fee estimates are unweighted and are not predicted revenue. Proceeds require verified signatures, closing, disbursement and receipt; proceeds are not net profit.',
   'allocation','Reporting alone never declares a winner. Existing allocation requires exact query cohorts, mature samples, complete costs and conservative superiority.'));
end $$;
revoke all on function public.icash_financial_credit_report(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_financial_credit_report(uuid,uuid,integer) to service_role;
commit;
