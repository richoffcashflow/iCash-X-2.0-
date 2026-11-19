-- Stable acquisition bounds for each account's market revision.
set local lock_timeout='2s';
-- Preserve the exact historical request only for operations already reserved at rollout.
create table icash_research_private.wholesale_prior_reservations as
 select o.account_id,o.operation_key from public.icash_operation_spend o where o.state='reserved' and o.operation_key like 'discovery:%';
alter table icash_research_private.wholesale_prior_reservations add primary key(operation_key);
revoke all on icash_research_private.wholesale_prior_reservations from public,anon,authenticated;
create table icash_research_private.wholesale_value_bands(
 account_id uuid not null, revision uuid not null, min_value integer not null, max_value integer not null,
 primary key(account_id,revision),check(min_value>=0 and max_value between greatest(1,min_value) and 500000)
);
revoke all on icash_research_private.wholesale_value_bands from public, anon, authenticated;
create function icash_research_private.snapshot_wholesale_value_band() returns trigger
language plpgsql security definer set search_path='' as $$
declare lower_value integer:=0; upper_value integer:=500000; buyer_cap integer; chosen record;
begin
 if tg_op='UPDATE' and new.revision is not distinct from old.revision then return new;end if;
 if new.revision is null then return new;end if;
 select floor((public.icash_current_buyer_demand(new.zip)->>'budgetCents')::numeric/100)::integer into buyer_cap;
 if buyer_cap>50000 then upper_value:=least(upper_value,buyer_cap);end if;
 -- Retain one in five revisions for exploration inside the wholesale ceiling.
 if mod(get_byte(uuid_send(new.revision),0),5)<>0 then
  with candidates as (
   select o.*, (s.snapshot#>>'{raw,data,estimated_value}')::numeric price,
    exists(select 1 from public.icash_deal_files d where d.account_id=o.account_id and d.screening_id=o.screening_id and d.funded_at is not null) closed
   from public.icash_opportunity_outcomes o join public.icash_screening_jobs s on s.account_id=o.account_id and s.id=o.screening_id
   where o.account_id=new.account_id and o.zip=new.zip and o.research_source and o.attempted
    and o.discovered_at between now()-interval '90 days' and now()-interval '72 hours'
    and jsonb_typeof(s.snapshot#>'{raw,data,estimated_value}')='number'
  ), bands as (
   select floor((ceil(price)-1)/100000)::integer*100000 as low,count(*) attempts,
    count(*) filter(where closed) closings,count(*) filter(where purchase_signed) signed,
    count(*) filter(where interested and not opted_out) positive,count(*) filter(where opted_out) stops,
    bool_and(costs_complete) known,sum(provider_cost_micros) micros from candidates
   where price>0 and price<=upper_value group by 1
  ) select low into chosen from bands where attempts>=20 and positive+signed+closings>0
   and (positive>=3 or signed>0 or closings>0)
   order by (8*closings+4*signed+positive-stops)::numeric/greatest(attempts,1) desc,
    case when known and micros>0 then (8*closings+4*signed+positive)::numeric/micros end desc nulls last,attempts desc,low limit 1;
  if found then lower_value:=chosen.low;upper_value:=least(upper_value,chosen.low+100000);end if;
 end if;
 insert into icash_research_private.wholesale_value_bands values(new.account_id,new.revision,lower_value,upper_value)
 on conflict do nothing;
 return new;
end $$;
revoke all on function icash_research_private.snapshot_wholesale_value_band() from public,anon,authenticated;
create trigger snapshot_wholesale_value_band after insert or update of revision on public.icash_discovery_configs
 for each row execute function icash_research_private.snapshot_wholesale_value_band();

do $guard$ begin if md5(pg_get_functiondef('icash_research_private.financial_policy(uuid, uuid, jsonb)'::regprocedure))<>'d19fccba9eebfa698a129723bb503880' then raise exception 'Definition changed: financial_policy';end if;end $guard$;
CREATE OR REPLACE FUNCTION icash_research_private.financial_policy(p_account uuid, p_revision uuid, p_base jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select case when exists(select 1 from icash_research_private.wholesale_prior_reservations p join public.icash_discovery_configs c on c.account_id=p.account_id
  where c.account_id=p_account and c.revision=p_revision and p.operation_key='discovery:'||p_account||':'||p_revision||':'||c.next_page)
  then '{}'::jsonb else jsonb_build_object('valueBand',jsonb_build_object('min',coalesce(b.min_value,0),'max',coalesce(b.max_value,500000))) end || jsonb_build_object('version','financial-prefilter-v1','exclusionListId',p_base->'exclusionListId','asOf',s.as_of::text,
  'tier',coalesce((select max(w.tier)+1 from icash_research_private.financial_widenings w where w.account_id=p_account and w.revision=p_revision),0))
 from icash_research_private.financial_settings s left join icash_research_private.wholesale_value_bands b on b.account_id=p_account and b.revision=p_revision where s.id=1 and s.enabled and s.as_of<=current_date;
$function$
;

do $guard$ begin if md5(pg_get_functiondef('icash_research_private.financial_filters(jsonb, jsonb)'::regprocedure))<>'b8652e71842c1e0dd7a2b2c3f5c1096d' then raise exception 'Definition changed: financial_filters';end if;end $guard$;
CREATE OR REPLACE FUNCTION icash_research_private.financial_filters(p_policy jsonb, p_plan jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare filters jsonb;tier integer;as_of date;floor_value numeric;
begin
 if p_policy->>'version' is distinct from 'financial-prefilter-v1'
  or (p_policy-'valueBand') is distinct from jsonb_build_object('version','financial-prefilter-v1','exclusionListId',p_policy->'exclusionListId','asOf',p_policy->'asOf','tier',p_policy->'tier')
  or coalesce(p_policy->>'exclusionListId','') !~ '^[A-Za-z0-9_-]{1,100}$'
  or jsonb_typeof(p_policy->'tier') is distinct from 'number' or p_policy->>'tier' not in('0','1','2')
  or coalesce(p_policy->>'asOf','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return null;end if;
 tier:=(p_policy->>'tier')::integer;as_of:=(p_policy->>'asOf')::date;
 if to_char(as_of,'YYYY-MM-DD')<>p_policy->>'asOf' then return null;end if;
 floor_value:=case when p_plan->>'strategy'='repairs' or p_plan#>>'{targeting,segment}'='off_market_repairs' then 50000 else 14285.72 end;
 if p_policy ? 'valueBand' and (jsonb_typeof(p_policy->'valueBand') is distinct from 'object'
  or p_policy->'valueBand' is distinct from jsonb_build_object('min',p_policy#>'{valueBand,min}','max',p_policy#>'{valueBand,max}')
  or jsonb_typeof(p_policy#>'{valueBand,min}') is distinct from 'number' or jsonb_typeof(p_policy#>'{valueBand,max}') is distinct from 'number'
  or (p_policy#>>'{valueBand,min}') !~ '^[0-9]+$' or (p_policy#>>'{valueBand,max}') !~ '^[0-9]+$'
  or (p_policy#>>'{valueBand,max}')::numeric not between greatest(floor_value+0.01,(p_policy#>>'{valueBand,min}')::numeric) and 500000) then return null;end if;
 filters:=jsonb_build_array(
  jsonb_build_object('filter_id','market_status','operator','contains_any','value',jsonb_build_array(6)),
  case when p_policy ? 'valueBand' then jsonb_build_object('filter_id','estimated_value','operator','range','value',jsonb_build_object('min',greatest(floor_value+0.01,(p_policy#>>'{valueBand,min}')::numeric),'max',p_policy#>'{valueBand,max}')) else jsonb_build_object('filter_id','estimated_value','operator','greater_than','value',floor_value) end,
  jsonb_build_object('filter_id','estimated_repair_cost','operator','greater_than_or_equal','value',0),
  jsonb_build_object('filter_id','num_total_active_liens','operator','less_than_or_equal','value',0));
 if tier<2 then
  filters:=filters||jsonb_build_array(
   jsonb_build_object('filter_id','estimated_equity_percentage','operator','greater_than_or_equal','value',case when tier=0 then 90 else 80 end),
   jsonb_build_object('filter_id','last_sale_date','operator','is_before','value',to_char(as_of-case when tier=0 then interval '10 years' else interval '7 years' end,'YYYY-MM-DD')));
  if tier=0 then filters:=filters||'[{"filter_id":"has_absentee_owners","value":true}]'::jsonb;end if;
 end if;
 return filters;
exception when others then return null;
end $function$
;

do $guard$ begin if md5(pg_get_functiondef('icash_research_private.financial_capable()'::regprocedure))<>'4b5ae548ff0b2e0e60c2bf41ce7b9648' then raise exception 'Definition changed: financial_capable';end if;end $guard$;
CREATE OR REPLACE FUNCTION icash_research_private.financial_capable()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c jsonb;f jsonb;m jsonb;
begin
 select result into c from public.icash_integration_checks where provider='dealmachine_targeting' and checked_at between now()-interval '7 days' and now();
 if c->>'status' is distinct from 'verified' or c->'catalogVersion' is distinct from '4'::jsonb or c#>'{plan,is_paid}' is distinct from 'true'::jsonb then return false;end if;
 for f in select value from jsonb_array_elements(icash_research_private.financial_filters(jsonb_build_object('version','financial-prefilter-v1','exclusionListId','capability-check','valueBand',jsonb_build_object('min',0,'max',500000),'asOf',current_date::text,'tier',0))||'[ {"filter_id":"property_type","operator":"contains_any","value":[1]}, {"filter_id":"has_active_lien","value":false}, {"filter_id":"has_hoa_lien","value":false}, {"filter_id":"is_tax_delinquent","value":false}]'::jsonb) loop
  if (select count(*) from jsonb_array_elements(c->'filters') x where x->>'filter_id'=f->>'filter_id')<>1 then return false;end if;
  select value into m from jsonb_array_elements(c->'filters') x where x->>'filter_id'=f->>'filter_id';
  if m->'is_premium_filter' is distinct from 'false'::jsonb
   or m->>'type' is distinct from (case when jsonb_typeof(f->'value')='boolean' then 'BOOLEAN' when f->>'filter_id'='last_sale_date' then 'DATE' when f->>'filter_id' in('market_status','property_type') then 'MULTI_SELECT' else 'NUMBER' end)
   or (f ? 'operator' and not coalesce(m->'allowed_operators' ? (f->>'operator'),false)) then return false;end if;
  if f->>'filter_id'='market_status' and (select count(*) from jsonb_array_elements(m->'options') o where o->'option_id'='6'::jsonb and o->>'label'='Off Market')<>1 then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $function$
;

do $guard$ begin if md5(pg_get_functiondef('icash_research_private.combine_financial_filters(jsonb)'::regprocedure))<>'80f6c229ab7f4c02092e3d861bcdd488' then raise exception 'Definition changed: combine_financial_filters';end if;end $guard$;
CREATE OR REPLACE FUNCTION icash_research_private.combine_financial_filters(p_filters jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare result jsonb:='[]';f jsonb;previous jsonb;position integer;bounds jsonb;bound jsonb;range_filter jsonb;ending date;minimum numeric;
begin
 if jsonb_typeof(p_filters) is distinct from 'array' then return null;end if;
 for f in select value from jsonb_array_elements(p_filters) loop
  select (ordinality-1)::integer,value into position,previous from jsonb_array_elements(result) with ordinality
   where value->>'filter_id'=f->>'filter_id';
  if not found then result:=result||jsonb_build_array(f);continue;end if;
  if previous->'operator' is not distinct from f->'operator' and previous->'value'=f->'value' then continue;end if;
  if f->>'filter_id'='estimated_value' and f->>'operator'='range' and previous->>'operator'='range' then
   minimum:=greatest((f#>>'{value,min}')::numeric,(previous#>>'{value,min}')::numeric);
   bounds:=jsonb_build_object('min',minimum,'max',least((f#>>'{value,max}')::numeric,(previous#>>'{value,max}')::numeric));
   if minimum>(bounds->>'max')::numeric then return null;end if;
   result:=jsonb_set(result,array[position::text],f||jsonb_build_object('value',bounds));continue;
  end if;
  if previous->>'operator' in ('greater_than','greater_than_or_equal') and f->>'operator' in ('greater_than','greater_than_or_equal')
   and jsonb_typeof(previous->'value')='number' and jsonb_typeof(f->'value')='number' then
   if (f->>'value')::numeric>(previous->>'value')::numeric or(f->'value'=previous->'value' and f->>'operator'='greater_than') then result:=jsonb_set(result,array[position::text],f);end if;
   continue;
  end if;
  if f->>'filter_id'='last_sale_date' then
   if previous->>'operator'='is_before' and f->>'operator'='is_before' then
    result:=jsonb_set(result,array[position::text],previous||jsonb_build_object('value',least(previous->>'value',f->>'value')));continue;
   end if;
   range_filter:=case when previous->>'operator'='date_range' then previous when f->>'operator'='date_range' then f end;
   bound:=case when previous->>'operator'='is_before' then previous when f->>'operator'='is_before' then f end;
   if range_filter is not null and bound is not null then
    bounds:=range_filter->'value';ending:=least((bounds->>'end')::date,(bound->>'value')::date-1);
    if (bounds->>'start')::date>ending then return null;end if;
    result:=jsonb_set(result,array[position::text],range_filter||jsonb_build_object('value',jsonb_build_object('start',bounds->>'start','end',to_char(ending,'YYYY-MM-DD'))));continue;
   end if;
  end if;
  range_filter:=case when previous->>'operator'='range' then previous when f->>'operator'='range' then f end;
  bound:=case when previous->>'operator' in('greater_than','greater_than_or_equal') then previous when f->>'operator' in('greater_than','greater_than_or_equal') then f end;
  if range_filter is not null and bound is not null then
   bounds:=range_filter->'value';
   if jsonb_typeof(bounds->'min') is distinct from 'number' or jsonb_typeof(bounds->'max') is distinct from 'number' or jsonb_typeof(bound->'value') is distinct from 'number' then return null;end if;
   if bound->>'operator'='greater_than' and (bounds->>'min')::numeric<=(bound->>'value')::numeric then return null;end if;
   minimum:=greatest((bounds->>'min')::numeric,(bound->>'value')::numeric);
   if minimum>(bounds->>'max')::numeric then return null;end if;
   result:=jsonb_set(result,array[position::text],range_filter||jsonb_build_object('value',jsonb_build_object('min',minimum,'max',bounds->'max')));continue;
  end if;
  return null;
 end loop;
 return result;
exception when others then return null;
end $function$
;

do $guard$ begin if md5(pg_get_functiondef('public.icash_filter_sms_interest(uuid, uuid)'::regprocedure))<>'c9c1c7564e0203beca4ffaab780c6709' then raise exception 'Definition changed: icash_filter_sms_interest';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.icash_filter_sms_interest(p_account uuid, p_screening uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(
 select 1 from public.icash_deal_files d join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party='seller'
 join public.icash_seller_opener_assignments a on a.thread_id=t.id and a.account_id=t.account_id
 where d.account_id=p_account and d.screening_id=p_screening and a.delivered_at is not null and not a.opted_out
 and public.icash_seller_sms_interest_at(p_account,t.id,a.created_at,a.delivered_at+interval '72 hours') is not null
 ) or exists(
 select 1 from public.icash_deal_files d
 join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
 join public.icash_sms_seller_openings opening on opening.thread_id=t.id and opening.account_id=t.account_id
 join public.icash_text_messages question on question.id=opening.interest_message_id and question.thread_id=t.id and question.account_id=t.account_id
 join public.icash_text_messages reply on reply.thread_id=t.id and reply.account_id=t.account_id
 where d.account_id=p_account and d.screening_id=p_screening
 and question.direction='outgoing' and question.state in ('accepted','delivered') and question.provider_id is not null
 and reply.direction='incoming' and reply.state='received' and (reply.provider_id is not null or reply.event_id is not null)
 and reply.created_at>question.created_at
 and lower(trim(reply.body)) ~ '^(yes|yeah|yep|sure|interested|i am interested|i''m interested|yes i am|yes i am interested|yes, i am interested|yes interested|yes, interested)[.! ]*$'
 and not exists(select 1 from public.icash_text_messages between_message where between_message.thread_id=t.id and between_message.account_id=t.account_id
  and between_message.created_at>question.created_at and between_message.created_at<reply.created_at
  and ((between_message.direction='outgoing' and between_message.provider_id is not null and between_message.state in ('accepted','delivered')) or (between_message.direction='incoming' and between_message.state='received')))
 );
$function$
;

do $guard$ begin if md5(pg_get_functiondef('public.icash_opportunity_market_score_local(uuid, text)'::regprocedure))<>'bb5c91d666cb98655c4dbdd7f2be4a67' then raise exception 'Definition changed: icash_opportunity_market_score_local';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.icash_opportunity_market_score_local(p_account uuid, p_zip text)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when count(*) filter(where attempted)<20 then 0 else greatest(-0.5,least(1,
 (0.20*public.icash_learning_lower(count(*) filter(where interested and not opted_out and attempted),count(*) filter(where attempted))
 +0.35*public.icash_learning_lower(count(*) filter(where purchase_signed),count(*))
 +0.45*public.icash_learning_lower(count(*) filter(where exists(select 1 from public.icash_deal_files d where d.account_id=o.account_id and d.screening_id=o.screening_id and d.funded_at is not null)),count(*)))
 /case when bool_and(costs_complete) then 1+greatest(0,avg(provider_cost_micros))/1000000 else 1 end
 -least(0.5,count(*) filter(where opted_out)::numeric/greatest(1,count(*) filter(where attempted))))) end
 from public.icash_opportunity_outcomes o where account_id=p_account and zip=p_zip and research_source and discovered_at between now()-interval '90 days' and now()-interval '1 day';
$function$
;

do $guard$ begin if md5(pg_get_functiondef('public.icash_opportunity_market_score_before_demand(uuid, text)'::regprocedure))<>'08a7249263b7ec2c83ee2553afc8abf4' then raise exception 'Definition changed: icash_opportunity_market_score_before_demand';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.icash_opportunity_market_score_before_demand(p_account uuid, p_zip text)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare s jsonb;
begin
 s:=public.icash_shared_learning_stats('market','research-v1',p_zip)->0;
 if coalesce((s->>'contributors')::integer,0)<3 or coalesce((s->>'effective_attempts')::numeric,0)<60 then return public.icash_opportunity_market_score_local(p_account,p_zip);end if;
 return greatest(-0.5,least(1,(0.2*public.icash_learning_lower((s->>'effective_positive')::numeric,(s->>'effective_attempts')::numeric)
  +0.35*public.icash_learning_lower((s->>'effective_contracts')::numeric,(s->>'effective_contract_trials')::numeric)
  +0.45*public.icash_learning_lower(coalesce((s->>'effective_closings')::numeric,0),coalesce((s->>'effective_closing_trials')::numeric,0)))
  /case when s->>'costs_complete'='true' then 1+coalesce((s->>'effective_cost_cents')::numeric,0)/(100*greatest(1,(s->>'effective_attempts')::numeric)) else 1 end
  -least(0.5,(s->>'effective_opted_out')::numeric/greatest(1,(s->>'effective_attempts')::numeric))));
end $function$
;

do $guard$ begin if md5(pg_get_functiondef('public.icash_refresh_learning_before_ranker(uuid)'::regprocedure))<>'d3ef0867e331b8fc28bba5c1f0998dba' then raise exception 'Definition changed: icash_refresh_learning_before_ranker';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.icash_refresh_learning_before_ranker(p_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare zip_code text;s jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81021));
 perform public.icash_refresh_opportunity_outcomes(p_account);
 delete from public.icash_learning_rollups where account_id=p_account;
 for zip_code in select distinct zip from public.icash_discovery_filter_pages where account_id=p_account and created_at>now()-interval '90 days' loop
  for s in select value from jsonb_array_elements(public.icash_discovery_filter_feedback(p_account,zip_code)) loop
   insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,cost_cents,costs_complete,contract_trials,contracts,closing_trials,closings)
   select p_account,'seller_filters','seller-filters-v1',zip_code,s->>'strategy',(s->>'attempted')::bigint,(s->>'pendingAttempts')::bigint,(s->>'interested')::bigint,(s->>'optedOut')::bigint,(s->>'costCents')::bigint,(s->>'costsComplete')::boolean,
    count(*) filter(where p.created_at<=now()-interval '30 days'),
    count(*) filter(where p.created_at<=now()-interval '30 days' and e.purchase_at between p.created_at and p.created_at+interval '30 days'),
    count(*) filter(where p.created_at<=now()-interval '60 days'),
    count(*) filter(where p.created_at<=now()-interval '60 days' and e.closed_at between p.created_at and p.created_at+interval '60 days')
   from public.icash_discovery_filter_pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
   left join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=a.screening_id
   where p.account_id=p_account and p.zip=zip_code and p.plan->>'version'='seller-filters-v1' and p.plan->>'strategy'=s->>'strategy' and p.created_at between now()-interval '90 days' and now();
  end loop;
 end loop;
 -- Market learning uses verified signatures, never an optimistic deal stage.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,costs_complete,cost_cents)
 select p_account,'market','research-v1',o.zip,'market',count(*),0,count(*) filter(where o.interested and not o.opted_out),count(*) filter(where o.opted_out),
 count(*) filter(where o.discovered_at<=now()-interval '30 days'),count(*) filter(where o.discovered_at<=now()-interval '30 days' and e.purchase_at between o.discovered_at and o.discovered_at+interval '30 days'),
 count(*) filter(where o.discovered_at<=now()-interval '60 days'),count(*) filter(where o.discovered_at<=now()-interval '60 days' and e.closed_at between o.discovered_at and o.discovered_at+interval '60 days'),bool_and(o.costs_complete),round(sum(o.provider_cost_micros)/10000.0)::bigint
 from public.icash_opportunity_outcomes o left join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=o.screening_id
 where o.account_id=p_account and o.research_source and o.discovered_at between now()-interval '90 days' and now()-interval '72 hours' group by o.zip;
 -- Recovery: one first delivered attempt per deal/context, 30-day contract and
 -- 60-day closing windows. Disabled copy remains disabled.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_recovery',a.reason||':'||a.stage||':'||a.source_channel,'*',a.variant,count(*),count(*) filter(where a.delivered_at>now()-interval '30 days'),
 count(*) filter(where a.delivered_at<=now()-interval '30 days' and a.responded_at between a.delivered_at and a.delivered_at+interval '30 days' and a.opted_out_at is null),count(*) filter(where a.opted_out_at is not null),
 count(*) filter(where a.delivered_at<=now()-interval '30 days'),count(*) filter(where a.delivered_at<=now()-interval '30 days' and e.purchase_at between a.delivered_at and a.delivered_at+interval '30 days'),
 count(*) filter(where a.delivered_at<=now()-interval '60 days'),count(*) filter(where a.delivered_at<=now()-interval '60 days' and e.closed_at between a.delivered_at and a.delivered_at+interval '60 days'),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from (select distinct on (deal_id,reason,stage,source_channel) * from public.icash_seller_recovery_attempts where account_id=p_account and delivered_at between now()-interval '180 days' and now() order by deal_id,reason,stage,source_channel,delivered_at,gap_id) a
 join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=a.deal_id
 left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||a.message_id group by a.reason,a.stage,a.source_channel,a.variant;
 -- Versioned seller texts count confirmed selling interest, never ownership replies.
 perform public.icash_refresh_seller_interest(p_account);
 -- Only prospective, actually dispatched versioned call assignments count.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_calls',a.context,'*',a.variant,count(*),count(*) filter(where c.created_at>now()-interval '72 hours'),
 count(*) filter(where c.created_at<=now()-interval '72 hours' and c.state='complete' and c.completed_at<=c.created_at+interval '72 hours' and public.icash_call_selling_interest(c.result) and coalesce(c.result->>'optedOut','false')<>'true'),
 count(*) filter(where c.result->'optedOut'='true'::jsonb),count(*) filter(where c.created_at<=now()-interval '30 days'),count(*) filter(where c.created_at<=now()-interval '30 days' and e.purchase_at between c.created_at and c.created_at+interval '30 days'),
 count(*) filter(where c.created_at<=now()-interval '60 days'),count(*) filter(where c.created_at<=now()-interval '60 days' and e.closed_at between c.created_at and c.created_at+interval '60 days'),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from public.icash_learning_assignments a join lateral(select c.* from public.icash_live_conversations c where c.account_id=a.account_id and c.screening_id::text||':'||c.contact_key=a.subject and c.strategy_key=a.variant and c.party='seller' and c.conversation_id is not null and c.created_at>=a.created_at and exists(select 1 from public.icash_call_recordings r where r.operation_key=c.operation_key and r.account_id=c.account_id and r.call_context->>'strategyKey'=a.variant and position('REVIEWED INTEREST QUESTION (shared-v1/'||a.context||'):' in r.call_context->>'prompt')>0) order by c.created_at,c.id limit 1) c on true
 join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=c.screening_id
 join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=p_account and o.dispatched_at is not null
 where a.account_id=p_account and a.domain='seller_calls' and a.policy_version='shared-v1'
 and not exists(select 1 from public.icash_live_conversations earlier join public.icash_call_recordings er on er.account_id=earlier.account_id and er.operation_key=earlier.operation_key where earlier.account_id=p_account and earlier.screening_id=c.screening_id and earlier.party='seller' and earlier.conversation_id is not null and row(earlier.created_at,earlier.id)<row(c.created_at,c.id) and position('REVIEWED INTEREST QUESTION (shared-v1/' in er.call_context->>'prompt')>0) and c.created_at between now()-interval '180 days' and now() group by a.context,a.variant;
 -- Buyer policies are assigned per deal/revision. Qualification is an explicit
 -- reviewed buyer match; an owner lookup or an email click is not qualification.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'buyer_search','order-v1',a.market,a.variant,count(*),count(*) filter(where first_receipt.at>now()-interval '30 days'),
 count(*) filter(where first_receipt.at<=now()-interval '30 days' and exists(select 1 from public.icash_buyer_matches m where m.deal_id=d.id and m.ready and m.qualification_request_id is not null and m.created_at between first_receipt.at and first_receipt.at+interval '30 days')),0,
 count(*) filter(where first_receipt.at<=now()-interval '30 days'),count(*) filter(where first_receipt.at<=now()-interval '30 days' and e.assignment_at between first_receipt.at and first_receipt.at+interval '30 days'),
 count(*) filter(where first_receipt.at<=now()-interval '60 days'),count(*) filter(where first_receipt.at<=now()-interval '60 days' and e.closed_at between first_receipt.at and first_receipt.at+interval '60 days'),coalesce(sum(cost.cents),0),bool_and(cost.complete) is true
 from public.icash_learning_assignments a join public.icash_deal_files d on d.account_id=a.account_id and a.subject like d.id::text||':%'
 join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=d.id
 join lateral(select min(r.created_at) at from public.icash_buyer_search_receipts r where r.deal_id=d.id and a.subject=d.id::text||':'||r.revision and r.created_at>=a.created_at) first_receipt on first_receipt.at is not null
 cross join lateral(select coalesce(sum(o.charged_cents) filter(where o.state='settled'),0) cents,bool_and(case when r.operation_key is null then r.receipt->'emptyEstimate'='true'::jsonb else o.state='settled' and o.charged_cents is not null end) complete from public.icash_buyer_search_receipts r left join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=p_account where r.deal_id=d.id and a.subject=d.id::text||':'||r.revision) cost
 where a.account_id=p_account and a.domain='buyer_search' and a.policy_version='shared-v1' and a.context='order-v1' and first_receipt.at between now()-interval '180 days' and now() group by a.market,a.variant;
end $function$
;
do $test$
declare p jsonb:='{"version":"financial-prefilter-v1","exclusionListId":"check","asOf":"2026-11-19","tier":2}';
 f jsonb; merged jsonb;
begin
 f:=icash_research_private.financial_filters(p||'{"valueBand":{"min":0,"max":500000}}'::jsonb,null);
 if not coalesce(f @> '[{"filter_id":"estimated_value","operator":"range","value":{"min":14285.73,"max":500000}}]'::jsonb,false) then raise exception 'Wholesale range missing';end if;
 merged:=icash_research_private.combine_financial_filters('[{"filter_id":"estimated_value","operator":"range","value":{"min":200000,"max":650000}}]'::jsonb||f);
 if not coalesce(merged @> '[{"filter_id":"estimated_value","value":{"min":200000,"max":500000}}]'::jsonb,false) then raise exception 'Buyer overlap missing';end if;
 if icash_research_private.combine_financial_filters('[{"filter_id":"estimated_value","operator":"range","value":{"min":600000,"max":700000}}]'::jsonb||f) is not null then raise exception 'Disjoint ranges admitted';end if;
 if not coalesce(icash_research_private.financial_filters(p,null) @> '[{"filter_id":"estimated_value","operator":"greater_than","value":14285.72}]'::jsonb,false) then raise exception 'Historical estimate changed';end if;
end $test$;
