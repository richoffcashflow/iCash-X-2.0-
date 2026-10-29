-- Reuse free exact-query estimates and reject newly assigned pages before spend.
-- No quota reset, purchase replay, contact sharing or pricing change.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create index research_estimates_exact_query on icash_research_private.estimates(md5(query::text));
alter table icash_research_private.estimates add column shared_hits bigint not null default 0;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_claim_discovery_estimate(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 needle:='declare e icash_research_private.estimates;';
 if strpos(d,needle)=0 then raise exception 'Estimate declaration changed';end if;
 d:=replace(d,needle,needle||'peer icash_research_private.estimates;');
 needle:=' update icash_research_private.estimates set query=p_query,exclusion_synced_at=generation,token=t,';
 replacement:=$insert$
 -- The existing operating-budget lock serializes these claims across accounts.
 -- A lease survives the transaction and coalesces the actual free network call.
 -- Hash is an index aid only: exact JSON and exclusion generation must match.
 select * into peer from icash_research_private.estimates other
 where other.operation_key<>op and md5(other.query::text)=md5(p_query::text)
  and other.query=p_query and other.exclusion_synced_at is not distinct from generation
  and (other.lease_until>now() or other.retry_at>now()
   or (other.response is not null and other.saved_at between now()-interval '5 minutes' and now()))
 order by (other.response is not null and other.saved_at between now()-interval '5 minutes' and now()) desc nulls last,
  other.saved_at desc nulls last,other.operation_key limit 1;
 if found then
  if peer.response is not null and peer.saved_at between now()-interval '5 minutes' and now() then
   -- Share only the validated non-contact estimate fields. Keep its original age.
   update icash_research_private.estimates set shared_hits=shared_hits+1 where operation_key=peer.operation_key;
   return jsonb_build_object('status','cached','response',jsonb_build_object('estimated_credits',
    jsonb_build_object('this_page',peer.response#>'{estimated_credits,this_page}',
     'breakdown',jsonb_build_object('people',peer.response#>'{estimated_credits,breakdown,people}'))));
  end if;
  return jsonb_build_object('status','held');
 end if;
$insert$||needle;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Estimate claim changed';end if;
 execute replace(d,needle,replacement);

 -- Recheck the exact static page after inventory preparation, before estimating.
 -- Exclusion-list queries are mutable and never use this page cache.
 d:=pg_get_functiondef('public.icash_research_query_ready(uuid,jsonb,jsonb,jsonb)'::regprocedure);
 needle:=' if p_plan is not null then';
 replacement:=$insert$
 if p_plan is not null and public.icash_discovery_filter_plan_valid(p_plan)
  and public.icash_known_assigned_research_page(c.zip,p_plan->>'strategy',
   (p_plan->>'providerPage')::integer,c.per_page,p_policy) is not null then return false;end if;
$insert$||needle;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Query ready prerequisite changed';end if;
 execute replace(d,needle,replacement);

 -- A second worker may finish the same page while this worker awaits its free
 -- estimate. Repeat scope, known-page and unknown-operation checks under the
 -- original admission locks, before any wallet reservation or paid claim.
 d:=pg_get_functiondef('public.icash_reserve_research_discovery(uuid,jsonb,jsonb,jsonb)'::regprocedure);
 needle:=' if p_plan is not null then';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Research admission prerequisite changed';end if;
 execute replace(d,needle,' if not public.icash_research_query_ready(p_account,p_scope,p_plan,p_policy) then return false;end if;'||E'\n'||needle);
end $patch$;

-- This preflight is a read, not admission. Final SQL admission still arbitrates
-- races. Unknown exports keep their slot; they do not consume more free previews.
create function public.icash_owner_active_export_capacity() returns text
language sql stable security definer set search_path='' as $$
 select case when not coalesce(public.icash_owner_active_export_enabled(),false) then 'disabled'
  when exists(select 1 from icash_research_private.owner_exports where terminal_at is null) then 'export_busy'
  when not public.icash_dealmachine_capacity_available(3) then 'quota_wait'
  else 'ready' end;
$$;
revoke all on function public.icash_owner_active_export_capacity() from public,anon,authenticated;
grant execute on function public.icash_owner_active_export_capacity() to service_role;
commit;
