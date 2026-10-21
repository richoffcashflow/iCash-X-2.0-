-- Staged shared-learning rollout: private helpers before policy activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_shared_buyer_cursor(p_account uuid,p_deal uuid,p_revision uuid,p_page integer,p_strategy text,p_provider_page integer) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare a public.icash_learning_assignments;prior public.icash_buyer_search_receipts;second text;
begin
 select * into a from public.icash_learning_assignments where account_id=p_account and domain='buyer_search' and subject=p_deal::text||':'||p_revision;
 if not found then return false;end if;
 second:=case when a.variant='recent_corporate' then 'corporate_owners' else 'recent_corporate' end;
 select * into prior from public.icash_buyer_search_receipts where deal_id=p_deal and revision=p_revision and page<p_page order by page desc limit 1;
 if p_page<>coalesce(prior.page,0)+1 then return false;end if;
 if prior.page is null then return p_page=1 and p_strategy=a.variant and p_provider_page=1;end if;
 if prior.receipt->>'learningVersion' is distinct from 'shared-v1' or prior.receipt->>'firstStrategy' is distinct from a.variant then return false;end if;
 if prior.page=1 then return p_strategy=second and p_provider_page=1;end if;
 return prior.has_next_page and p_strategy=second and p_provider_page=(prior.receipt->>'providerPage')::integer+1;
end $$;
alter function public.icash_save_buyer_search(uuid,uuid,uuid,integer,text,jsonb) rename to icash_save_buyer_search_before_shared;
create function public.icash_save_buyer_search(p_account uuid,p_deal uuid,p_revision uuid,p_page integer,p_operation text,p_receipt jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.icash_learning_assignments;
begin
 select * into a from public.icash_learning_assignments where account_id=p_account and domain='buyer_search' and subject=p_deal::text||':'||p_revision;
 if found and (p_receipt->>'learningVersion' is distinct from 'shared-v1' or p_receipt->>'firstStrategy' is distinct from a.variant or p_receipt->>'zip' is distinct from a.market
  or not public.icash_shared_buyer_cursor(p_account,p_deal,p_revision,p_page,p_receipt->>'strategy',(p_receipt->>'providerPage')::integer)) then raise exception 'Shared buyer receipt binding changed';end if;
 perform public.icash_save_buyer_search_before_shared(p_account,p_deal,p_revision,p_page,p_operation,p_receipt);
end $$;
create or replace function public.icash_save_empty_buyer_search(p_account uuid,p_deal uuid,p_revision uuid,p_page integer,p_strategy text,p_provider_page integer,p_zip text) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.icash_buyer_search_configs;last public.icash_buyer_search_receipts;actual_zip text;receipt jsonb;assignment public.icash_learning_assignments;
begin
 select * into strict c from public.icash_buyer_search_configs where account_id=p_account and revision=p_revision and enabled and rights_until>now() for update;
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then raise exception 'Buyer search held';end if;
 select left(sc.snapshot->'raw'->'data'->>'zip',5) into actual_zip from public.icash_deal_files d join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected','title_open','closing')
 and exists(select 1 from public.icash_signing_envelopes e where e.deal_id=d.id and e.account_id=d.account_id and e.kind='purchase' and e.state='completed' and not e.test_mode)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual);
 if actual_zip is null or actual_zip<>p_zip or p_zip !~ '^[0-9]{5}$' or p_page not between 1 and c.max_pages or p_provider_page not between 1 and c.max_pages or p_strategy not in ('recent_corporate','corporate_owners') then raise exception 'Buyer search binding required';end if;
 select * into assignment from public.icash_learning_assignments where account_id=p_account and domain='buyer_search' and subject=p_deal::text||':'||p_revision;
 receipt:=jsonb_build_object('strategy',p_strategy,'providerPage',p_provider_page,'zip',p_zip,'estimatedCredits',0,'creditsUsed',0,'peopleCredits',0,'propertyCredits',0,'hasNextPage',false,'emptyEstimate',true);
 if assignment.variant is not null then receipt:=receipt||jsonb_build_object('learningVersion','shared-v1','firstStrategy',assignment.variant);end if;
 select * into last from public.icash_buyer_search_receipts where deal_id=p_deal and revision=p_revision and page=p_page;
 if found then if last.operation_key is not null or last.receipt<>receipt then raise exception 'Conflicting buyer receipt';end if;return;end if;
 if exists(select 1 from public.icash_operation_spend where operation_key='buyers:'||p_deal||':'||p_revision||':'||p_page||(case when p_strategy='corporate_owners' then ':corporate' else '' end) and state<>'reserved') then raise exception 'Paid buyer receipt requires reconciliation';end if;
 select * into last from public.icash_buyer_search_receipts where deal_id=p_deal and revision=p_revision order by page desc limit 1;
 if p_page<>coalesce(last.page,0)+1 then raise exception 'Sequential buyer cursor required';end if;
 if assignment.variant is not null then
  if not public.icash_shared_buyer_cursor(p_account,p_deal,p_revision,p_page,p_strategy,p_provider_page) then raise exception 'Shared buyer cursor changed';end if;
 elsif last.page is null then
  if p_strategy<>'recent_corporate' or p_provider_page<>1 then raise exception 'Focused search required first';end if;
 elsif coalesce(last.receipt->>'strategy','recent_corporate')<>'corporate_owners' then
  if p_strategy<>'corporate_owners' or p_provider_page<>1 then raise exception 'Corporate expansion required';end if;
 elsif not last.has_next_page or p_strategy<>'corporate_owners' or p_provider_page<>(last.receipt->>'providerPage')::integer+1 then raise exception 'Corporate cursor exhausted';end if;
 insert into public.icash_buyer_search_receipts(deal_id,revision,page,operation_key,has_next_page,receipt) values(p_deal,p_revision,p_page,null,false,receipt);
end $$;

revoke all on function public.icash_shared_buyer_cursor(uuid,uuid,uuid,integer,text,integer),public.icash_save_buyer_search(uuid,uuid,uuid,integer,text,jsonb),public.icash_save_buyer_search_before_shared(uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_shared_buyer_cursor(uuid,uuid,uuid,integer,text,integer),public.icash_save_buyer_search(uuid,uuid,uuid,integer,text,jsonb),public.icash_save_buyer_search_before_shared(uuid,uuid,uuid,integer,text,jsonb) to service_role;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['icash_shared_buyer_cursor','icash_save_buyer_search','icash_save_empty_buyer_search']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
