-- Rank due inventory before evaluating market scope and geography. The outer
-- ORDER BY preserves the original top 64 eligible ZIPs even if a plan changes.
set local lock_timeout = '3s';
set local statement_timeout = '10s';
set local search_path = '';

do $migration$
declare
  signature constant regprocedure := 'public.icash_continue_stalled_research(uuid)'::regprocedure;
  source text := pg_get_functiondef(signature);
  original text := $old$select account_id,zip from public.icash_inventory_markets where account_id=p_account and zip<>c.zip
  and eligible_until>now() and next_scan_at<=now() and public.icash_research_zip_known(zip)
  and (not independent_query or not (zip=any(blocked_zips)))
  and public.icash_inventory_scope_allowed(p_account,zip)
  and not exists(select 1 from icash_research_private.stalled_searches q where q.account_id=p_account and q.zip=icash_inventory_markets.zip)
  order by priority,md5(zip||p_account::text) limit 64$old$;
  replacement text := $new$select due.account_id,due.zip from (
   select market.account_id,market.zip,market.priority,md5(market.zip||p_account::text) as tie
   from public.icash_inventory_markets market
   where market.account_id=p_account and market.zip<>c.zip
    and market.eligible_until>now() and market.next_scan_at<=now()
    and (not independent_query or not (market.zip=any(blocked_zips)))
   order by market.priority,md5(market.zip||p_account::text) offset 0
  ) due
  where public.icash_research_zip_known(due.zip)
   and public.icash_inventory_scope_allowed(p_account,due.zip)
   and not exists(select 1 from icash_research_private.stalled_searches held
    where held.account_id=p_account and held.zip=due.zip offset 0)
  order by due.priority,due.tie limit 64$new$;
begin
  if md5(source)<>'28957145a028fdd9a69d26b8debe768f'
    or length(source)-length(replace(source,original,''))<>length(original)
    or not exists(select 1 from pg_proc p where p.oid=signature and p.prosecdef
     and pg_get_userbyid(p.proowner)='postgres' and p.provolatile='v'
     and p.proconfig=array['search_path=""']::text[]
     and p.proacl=array['postgres=X/postgres','service_role=X/postgres']::aclitem[]) then
    raise exception 'Independent search ranking predecessor changed';
  end if;
  perform pg_advisory_xact_lock(726341927);
  perform 1 from public.icash_operating_budget where id=1 for update nowait;
  if not found then raise exception 'Operating budget missing';end if;
  execute replace(source,original,replacement);
end $migration$;
