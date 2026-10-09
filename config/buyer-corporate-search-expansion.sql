begin;
-- A zero-result estimate is free. Save its cursor without inventing a paid
-- operation, so the worker advances to broader owners instead of looping.
alter table public.icash_buyer_search_receipts alter column operation_key drop not null;
-- A broader search is a distinct provider request, never a retry of an
-- ambiguous paid request for the original narrower criteria.
do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_save_buyer_search(uuid,uuid,uuid,integer,text,jsonb)'::regprocedure);
 needle:=$old$p_operation<>'buyers:'||p_deal||':'||p_revision||':'||p_page then$old$;
 if position(needle in definition)=0 then raise exception 'Buyer receipt binding changed; review before migration';end if;
 execute replace(definition,needle,$new$p_operation<>'buyers:'||p_deal||':'||p_revision||':'||p_page||(case when p_receipt->>'strategy'='corporate_owners' then ':corporate' else '' end) then$new$);
end $patch$;
create function public.icash_save_empty_buyer_search(p_account uuid,p_deal uuid,p_revision uuid,p_page integer,p_strategy text,p_provider_page integer,p_zip text) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.icash_buyer_search_configs;last public.icash_buyer_search_receipts;actual_zip text;receipt jsonb;
begin
 select * into strict c from public.icash_buyer_search_configs where account_id=p_account and revision=p_revision and enabled and rights_until>now() for update;
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then raise exception 'Buyer search held';end if;
 select left(sc.snapshot->'raw'->'data'->>'zip',5) into actual_zip from public.icash_deal_files d join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and exists(select 1 from public.icash_signing_envelopes e where e.deal_id=d.id and e.account_id=d.account_id and e.kind='purchase' and e.state='completed' and not e.test_mode)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual);
 if actual_zip is null or actual_zip<>p_zip or p_zip !~ '^[0-9]{5}$' or p_page not between 1 and c.max_pages or p_provider_page not between 1 and c.max_pages or p_strategy not in ('recent_corporate','corporate_owners') then raise exception 'Buyer search binding required';end if;
 receipt:=jsonb_build_object('strategy',p_strategy,'providerPage',p_provider_page,'zip',p_zip,'estimatedCredits',0,'creditsUsed',0,'peopleCredits',0,'propertyCredits',0,'hasNextPage',false,'emptyEstimate',true);
 select * into last from public.icash_buyer_search_receipts where deal_id=p_deal and revision=p_revision and page=p_page;
 if found then if last.operation_key is not null or last.receipt<>receipt then raise exception 'Conflicting buyer receipt';end if;return;end if;
 if exists(select 1 from public.icash_operation_spend where operation_key='buyers:'||p_deal||':'||p_revision||':'||p_page||(case when p_strategy='corporate_owners' then ':corporate' else '' end) and state<>'reserved') then raise exception 'Paid buyer receipt requires reconciliation';end if;
 select * into last from public.icash_buyer_search_receipts where deal_id=p_deal and revision=p_revision order by page desc limit 1;
 if p_page<>coalesce(last.page,0)+1 then raise exception 'Sequential buyer cursor required';end if;
 if last.page is null then
  if p_strategy<>'recent_corporate' or p_provider_page<>1 then raise exception 'Focused search required first';end if;
 elsif coalesce(last.receipt->>'strategy','recent_corporate')<>'corporate_owners' then
  if p_strategy<>'corporate_owners' or p_provider_page<>1 then raise exception 'Corporate expansion required';end if;
 elsif not last.has_next_page or p_strategy<>'corporate_owners' or p_provider_page<>(last.receipt->>'providerPage')::integer+1 then raise exception 'Corporate cursor exhausted';end if;
 insert into public.icash_buyer_search_receipts(deal_id,revision,page,operation_key,has_next_page,receipt) values(p_deal,p_revision,p_page,null,false,receipt);
end $$;
revoke all on function public.icash_save_empty_buyer_search(uuid,uuid,uuid,integer,text,integer,text) from public,anon,authenticated;
grant execute on function public.icash_save_empty_buyer_search(uuid,uuid,uuid,integer,text,integer,text) to service_role;
commit;
