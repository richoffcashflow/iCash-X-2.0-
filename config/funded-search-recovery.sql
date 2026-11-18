-- Keep original purchases in reconciliation while the scheduler admits independent work.
-- Both changes use the existing account, budget, configuration and source locks.
set local lock_timeout = '3s';
set local statement_timeout = '12s';
set local search_path = '';

do $migration$
declare
  continuation text := pg_get_functiondef('public.icash_continue_stalled_research(uuid)'::regprocedure);
  preparation text := pg_get_functiondef('public.icash_prepare_research_efficiency(uuid)'::regprocedure);
  old_receipt text := $old$or (completed_errors and result->>'outcome'='http_error' and result->'httpStatus'='500'::jsonb))$old$;
  new_receipt text := $new$or (completed_errors and result->>'outcome'='http_error' and result->'httpStatus'='500'::jsonb)
   or (completed_errors and independent_query and finished_at>=created_at and created_at>=o.created_at and (
    -- Historical 402s have no per-request cost. A verified later provider credit
    -- check permits a different ZIP only. A newer refusal or busy policy wins.
    (result->>'outcome'='http_error' and result->'httpStatus'='402'::jsonb
     and not (result ?| array['creditsUsed','returned'])
     and exists(
      select 1 from icash_research_private.dealmachine_credit_state credit
      join icash_research_private.dealmachine_credit_checks checked
       on checked.generation=credit.generation and checked.received_at=credit.latest_usage_at
      where credit.id=1 and credit.enabled and not credit.blocked and credit.available>0
       and credit.latest_usage_generation=credit.generation
       and checked.result='provider_credit_available'
       and credit.latest_usage_at between requests.finished_at and now()
       and credit.latest_refusal_at<=credit.latest_usage_at and credit.cycle_end>now()
      for share of credit skip locked))
    -- A response with recorded usage but no property payload remains unsettled.
    -- Existing query/page/ZIP fences also apply to this independent continuation.
    or (result->>'outcome'='response' and result->'httpStatus'='200'::jsonb
     and jsonb_typeof(result->'returned')='number' and result->'returned'=result->'creditsUsed'
     and case when result->>'returned' ~ '^[1-9][0-9]{0,2}$'
              then (result->>'returned')::integer<=c.per_page else false end)
   )))$new$;
  find_batch text := ' select batch_rate into large from icash_research_private.rate_versions where base_rate=base and unit_micros=c.property_credit_micros;';
  normalize_rate text := $normalize$ -- A copied batch rate can become an account's five-property baseline.
 -- Recover its documented parent only when the original pricing calculation agrees.
 if r.version like 'research25-%' and r.evidence_ref like 'research-efficiency-v1:base:%'
  and c.per_page in (5,25) then
  select parent.* into canonical from icash_research_private.rate_versions link
  join public.icash_operation_rates parent on parent.id=link.base_rate
  join public.icash_operation_rates child on child.id=link.batch_rate and to_jsonb(child)=to_jsonb(r)
  where link.batch_rate=r.id and link.unit_micros=c.property_credit_micros and parent.id<>r.id
   and not exists(select 1 from icash_research_private.rate_versions competing
    where competing.batch_rate=r.id and competing.unit_micros=link.unit_micros and competing.base_rate<>parent.id)
   and parent.operation='property_search' and parent.enabled and parent.verified_at<=now() and parent.expires_at>now()
   and parent.verified_at=r.verified_at and parent.expires_at=r.expires_at and parent.buffer_bps=r.buffer_bps
   and parent.flat_customer_price_cents is not distinct from r.flat_customer_price_cents
   and parent.voice_max_duration_seconds is not distinct from r.voice_max_duration_seconds
   and jsonb_typeof(parent.costs_micros->'dealmachine')='number'
   and (parent.costs_micros->>'dealmachine')::numeric >= 5*c.property_credit_micros
   and r.costs_micros=jsonb_set(parent.costs_micros,'{dealmachine}',
    to_jsonb(greatest((parent.costs_micros->>'dealmachine')::bigint,25*c.property_credit_micros)))
   and r.charge_cents=parent.charge_cents+ceil(((r.costs_micros->>'dealmachine')::numeric
    -(parent.costs_micros->>'dealmachine')::numeric)*3*(10000+parent.buffer_bps)/100000000)
  for share of parent,child,link skip locked;
  if found then
   page_key:='discovery:'||p_account||':'||c.revision||':'||c.next_page;
   if exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind='discovery'
    and ((state='issued' and expires_at>now()) or (state='consumed' and greatest(created_at,expires_at)>now()-interval '5 minutes')))
    or exists(select 1 from public.icash_operation_spend where operation_key=page_key)
    or exists(select 1 from icash_research_private.query_claims where operation_key=page_key)
    or exists(select 1 from public.icash_discovery_filter_pages where operation_key=page_key and state='claimed')
    or exists(select 1 from icash_research_private.estimates where operation_key=page_key
     and lease_until>now()) then return false;end if;
   update icash_research_private.account_rates set base_rate=canonical.id
    where account_id=p_account and base_rate=base;
   -- A rate-only correction preserves the account's ZIP, revision and page.
   -- A genuine change to page size still uses the existing configuration rotation.
   update public.icash_discovery_configs set rate_id=case when c.per_page=5 then canonical.id else r.id end
    where account_id=p_account returning * into c;
   base:=canonical.id;
   r:=canonical;
  end if;
 end if;
$normalize$;
  f record;
begin
  for f in select p.* from pg_proc p where p.oid in (
    'public.icash_continue_stalled_research(uuid)'::regprocedure,
    'public.icash_prepare_research_efficiency(uuid)'::regprocedure) loop
    if pg_get_userbyid(f.proowner)<>'postgres' or not f.prosecdef or f.provolatile<>'v'
      or f.proconfig is distinct from array['search_path=""']::text[]
      or f.proacl is distinct from array['postgres=X/postgres','service_role=X/postgres']::aclitem[] then
      raise exception 'Funded search recovery function privileges changed';
    end if;
  end loop;
  if md5(continuation)<>'fefc2f74f2ddcae1b3bd74dfb4e502f8'
     or md5(preparation)<>'1e2e8acceeaea6b1c928f24d96cca2f0'
     or length(continuation)-length(replace(continuation,old_receipt,''))<>length(old_receipt)
     or length(preparation)-length(replace(preparation,find_batch,''))<>length(find_batch) then
    raise exception 'Funded search recovery predecessor changed';
  end if;
  perform pg_advisory_xact_lock(726341927);
  perform 1 from public.icash_operating_budget where id=1 for update nowait;
  if not found then raise exception 'Operating budget missing';end if;
  execute replace(continuation,old_receipt,new_receipt);
  preparation:=replace(preparation,';base uuid;chosen uuid;',
    ';canonical public.icash_operation_rates;page_key text;base uuid;chosen uuid;');
  execute replace(preparation,find_batch,normalize_rate||find_batch);
end $migration$;
