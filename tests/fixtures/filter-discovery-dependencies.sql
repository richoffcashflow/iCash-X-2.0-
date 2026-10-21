-- Exact existing production persistence functions; no data or credentials.
CREATE OR REPLACE FUNCTION public.icash_mark_inventory_empty(p_account uuid, p_revision uuid, p_page integer)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 update public.icash_discovery_configs set exhausted=true where account_id=p_account and revision=p_revision and next_page=p_page;
 if found then
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=(select zip from public.icash_discovery_configs where account_id=p_account);
 perform public.icash_rotate_inventory_market(p_account);
 end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_save_discovery(p_account uuid, p_operation text, p_revision uuid, p_page integer, p_result jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_discovery_configs; o public.icash_operation_spend; saved jsonb; row jsonb; n integer:=0; stamp timestamptz; used bigint;
begin
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.account_id<>p_account or o.state<>'dispatched' then raise exception 'Dispatched acquisition required'; end if;
 select result into saved from public.icash_discovery_results where operation_key=p_operation;
 if found then if saved<>p_result then raise exception 'Discovery result conflict';end if;return jsonb_array_length(saved->'rows');end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision<>p_revision or c.next_page<>p_page or c.rate_id<>o.rate_id then raise exception 'Discovery configuration changed';end if;
 if jsonb_typeof(p_result->'rows') is distinct from 'array' or jsonb_array_length(p_result->'rows')>c.per_page or octet_length(p_result::text)>524288 then raise exception 'Invalid discovery result';end if;
 used:=(p_result->>'creditsUsed')::bigint;stamp:=(p_result->>'fetchedAt')::timestamptz;
 if used is null or used<0 or stamp is null or stamp>now()+interval '1 minute' or stamp<now()-interval '1 day' or (p_result->>'peopleCredits')::bigint is distinct from 0 then raise exception 'Invalid discovery receipt';end if;
 perform public.icash_record_cost_observation('dealmachine',p_operation,'dealmachine:search:'||p_operation,used,'provider_credits');
 for row in select value from jsonb_array_elements(p_result->'rows') loop
  if not public.icash_research_state_allowed(row->>'state') then continue;end if;
  insert into public.icash_outbound_property_owners(property_id,account_id) values(row->>'dm_property_id',p_account) on conflict do nothing;
  if not exists(select 1 from public.icash_outbound_property_owners where property_id=row->>'dm_property_id' and account_id=p_account)
   or exists(select 1 from public.icash_screening_jobs where account_id=p_account and snapshot->>'propertyId'=row->>'dm_property_id') then continue;end if;
  perform public.icash_enqueue_screening(p_account,p_operation||':'||(row->>'dm_property_id'),jsonb_build_object('propertyId',row->>'dm_property_id','propertyType','house','fetchedAt',stamp,'assignmentFeeCents',c.assignment_fee_cents,'sellerCostReserveCents',c.seller_cost_reserve_cents,'raw',jsonb_build_object('data',row)),stamp);
  n:=n+1;
 end loop;
 insert into public.icash_discovery_results(operation_key,account_id,result) values(p_operation,p_account,p_result);
 update public.icash_discovery_configs set next_page=next_page+1,exhausted=not coalesce((p_result->>'hasNextPage')::boolean,false),enabled=case when used>(p_result->>'estimatedCredits')::bigint then false else enabled end where account_id=p_account;
 return n;
end $function$
;
