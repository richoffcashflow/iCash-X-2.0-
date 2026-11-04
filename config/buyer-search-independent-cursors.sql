begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Only the read-only cursor predicate changes. Save/claim/admission locks and
-- original operation keys, receipts, rates and page caps remain authoritative.
do $$begin
 if not exists(select 1 from pg_proc where oid='public.icash_shared_buyer_cursor(uuid,uuid,uuid,integer,text,integer)'::regprocedure
  and md5(prosrc)='871396ed8dbb563511f1d913fed4dbbf' and provolatile='s' and not prosecdef) then
  raise exception 'Buyer cursor predecessor changed; review before migration';
 end if;
end $$;
create or replace function public.icash_shared_buyer_cursor(p_account uuid,p_deal uuid,p_revision uuid,p_page integer,p_strategy text,p_provider_page integer) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare a public.icash_learning_assignments;r public.icash_buyer_search_receipts;second text;n integer:=0;
 first_page integer:=0;second_page integer:=0;first_more boolean:=false;second_more boolean:=false;
 strategy text;provider_page integer;expected_strategy text;expected_page integer;page_cap integer;
begin
 select * into a from public.icash_learning_assignments where account_id=p_account and domain='buyer_search' and subject=p_deal::text||':'||p_revision;
 if not found or a.variant not in ('recent_corporate','corporate_owners') or a.policy_version is distinct from 'shared-v1' then return false;end if;
 select c.max_pages into page_cap from public.icash_buyer_search_configs c where c.account_id=p_account and c.revision=p_revision;
 if page_cap is null or page_cap not between 1 and 5 or p_page is null or p_page not between 1 and page_cap
  or p_strategy is null or p_provider_page is null or p_provider_page not between 1 and page_cap
  or not exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.id=p_deal) then return false;end if;
 second:=case when a.variant='recent_corporate' then 'corporate_owners' else 'recent_corporate' end;
 for r in select * from public.icash_buyer_search_receipts where deal_id=p_deal and revision=p_revision and page<p_page order by page limit 6 loop
  n:=n+1;
  if r.page<>n or r.receipt->>'learningVersion' is distinct from 'shared-v1' or r.receipt->>'firstStrategy' is distinct from a.variant
   or r.receipt->>'zip' is distinct from a.market or r.has_next_page is null
   or jsonb_typeof(r.receipt->'providerPage') is distinct from 'number' or coalesce(r.receipt->>'providerPage','') !~ '^[1-5]$' then return false;end if;
  strategy:=r.receipt->>'strategy';provider_page:=(r.receipt->>'providerPage')::integer;
  if strategy is null or strategy not in (a.variant,second) or n=1 and strategy<>a.variant or n=2 and strategy<>second then return false;end if;
  if strategy=a.variant then
   if provider_page<>first_page+1 or first_page>0 and not first_more then return false;end if;
   first_page:=provider_page;first_more:=r.has_next_page;
  else
   if provider_page<>second_page+1 or second_page>0 and not second_more then return false;end if;
   second_page:=provider_page;second_more:=r.has_next_page;
  end if;
 end loop;
 if p_page<>n+1 then return false;end if;
 if n=0 then expected_strategy:=a.variant;expected_page:=1;
 elsif n=1 then expected_strategy:=second;expected_page:=1;
 elsif second_more then expected_strategy:=second;expected_page:=second_page+1;
 elsif first_more then expected_strategy:=a.variant;expected_page:=first_page+1;
 else return false;end if;
 return p_strategy=expected_strategy and p_provider_page=expected_page;
end $$;
revoke all on function public.icash_shared_buyer_cursor(uuid,uuid,uuid,integer,text,integer) from public,anon,authenticated;
grant execute on function public.icash_shared_buyer_cursor(uuid,uuid,uuid,integer,text,integer) to service_role;
commit;
