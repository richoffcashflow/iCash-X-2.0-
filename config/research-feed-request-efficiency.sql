-- Resume original free owner checks without redundant identity reads, and let
-- a funded starter synchronize the exact exclusion list its current financial
-- query requires. No quota reset, limit increase, paid retry or policy switch.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_pending_owner_preflight(p_account uuid,p_primary uuid,p_candidates jsonb,p_mobile boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare cohort jsonb;result jsonb;
begin
 if p_account is null or p_primary is null or p_mobile is null
  or jsonb_typeof(p_candidates) is distinct from 'array' then return null;end if;
 if jsonb_array_length(p_candidates) not between 1 and 5 or octet_length(p_candidates::text)>524288 then return null;end if;
 if not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
  where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents)
  or not public.icash_membership_work_allowed(p_account) then return null;end if;
 cohort:=icash_research_private.owner_preflight_cohort(p_account,p_primary);
 if cohort is null or (select jsonb_agg(i.value-'ids' order by i.ordinality)
  from jsonb_array_elements(cohort) with ordinality i(value,ordinality)) is distinct from p_candidates then return null;end if;
 select jsonb_build_object('items',p.items,'request',p.request) into result
 from icash_research_private.owner_export_preflights p
 where p.account_id=p_account and p.items=cohort and p.items->0->>'screeningId'=p_primary::text
  and p.state in ('creating','waiting','checking') and p.created_at<=now() and p.created_at>now()-interval '30 minutes'
  and p.deleted_at is null and p.cleanup_attempts=0
  and coalesce(p.request->'mobile_only','false'::jsonb)=to_jsonb(p_mobile)
 order by p.created_at,p.id limit 1;
 return result;
end $$;
revoke all on function public.icash_pending_owner_preflight(uuid,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.icash_pending_owner_preflight(uuid,uuid,jsonb,boolean) to service_role;

-- Independent financial queries deliberately do not populate the legacy
-- config.research_list_id. Bind to their enabled, exact shared query list.
create function icash_research_private.starter_exclusion_list_current(p_account uuid,p_list text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_discovery_configs c
  join icash_research_private.settings s on s.id=1 and s.enabled
  where c.account_id=p_account and c.enabled and c.auto_enabled and not c.exhausted
   and c.data_rights_until>now() and c.research_version in (1,2)
   and ((s.exclusions_enabled and c.research_list_id=p_list)
    or (s.exclusion_sync_enabled
     and exists(select 1 from icash_research_private.financial_settings f where f.id=1 and f.enabled)
     and exists(select 1 from icash_research_private.targeting_query_settings q where q.id=1 and q.enabled and q.list_id=p_list))))
$$;
revoke all on function icash_research_private.starter_exclusion_list_current(uuid,text) from public,anon,authenticated,service_role;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_starter_research_exclusions(uuid)'::regprocedure);
 if md5(d)<>'c3e4e7cff174d7c0f61f5b0dce99f6ba' then raise exception 'Starter sync claim prerequisite changed';end if;
 needle:='where id=1 and enabled and exclusions_enabled)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter sync switch boundary changed';end if;
 d:=replace(d,needle,'where id=1 and enabled and (exclusions_enabled or exclusion_sync_enabled))');
 needle:='c.account_id=p_account and c.research_list_id=s.list_id';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter sync source boundary changed';end if;
 d:=replace(d,needle,'c.account_id=p_account and icash_research_private.starter_exclusion_list_current(p_account,s.list_id)');
 needle:='exists(select 1 from icash_research_private.targeting_settings where id=1 and enabled)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter sync pending-source boundary changed';end if;
 execute replace(d,needle,needle||' or exists(select 1 from icash_research_private.financial_settings where id=1 and enabled)');

 d:=pg_get_functiondef('icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz)'::regprocedure);
 if md5(d)<>'34ff4553e0d099cef6a309d9b1389463' then raise exception 'Starter sync admission prerequisite changed';end if;
 needle:='c.account_id=claim.account_id and c.research_list_id=claim.list_id';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter sync final source boundary changed';end if;
 d:=replace(d,needle,'c.account_id=claim.account_id and icash_research_private.starter_exclusion_list_current(claim.account_id,claim.list_id)');
 needle:='where id=1 and enabled and exclusions_enabled)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter sync final switch boundary changed';end if;
 execute replace(d,needle,'where id=1 and enabled and (exclusions_enabled or exclusion_sync_enabled))');
end $patch$;
commit;
