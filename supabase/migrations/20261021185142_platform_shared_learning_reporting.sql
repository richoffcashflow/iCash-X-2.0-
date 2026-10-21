-- Staged shared-learning rollout: private helpers before policy activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Owner-only aggregate report. No account IDs or source records are returned.
-- Persist the historical baseline for all existing accounts, including accounts
-- whose old impressions have passed retention. Only new accounts adapt.
insert into public.icash_learning_assignments(account_id,domain,subject,context,market,variant,mode)
select a.id,'workspace_prompts','account','funding-v1','*',coalesce((select o.variant from public.icash_usage_loop_observations o where o.account_id=a.id order by o.created_at,o.id limit 1),
 case when (get_byte(decode(substr(md5(a.id::text),1,2),'hex'),0)/16)%2=0 then 'control' else 'progress' end),'explore' from public.icash_accounts a;
create function public.icash_learning_usage_variant(p_account uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare existing text;stats jsonb;winner text;chosen text;bucket bigint;mode text:='explore';
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81023));
 select variant into existing from public.icash_learning_assignments where account_id=p_account and domain='workspace_prompts' and subject='account';
 if existing is not null then return existing;end if;
 bucket:=('x'||substr(md5(p_account::text||'funding-v1'),1,8))::bit(32)::bigint%10000;
 chosen:=case when bucket%2=0 then 'control' else 'progress' end;
 select report->'variants' into stats from public.icash_learning_conversion_cache where id=1 and updated_at>now()-interval '6 hours';
 if jsonb_array_length(stats)=2 and (select bool_and((s->>'observedAccounts')::bigint>=100 and (s->>'fundedAccounts')::bigint>=5 and s->>'variant' in ('control','progress')) from jsonb_array_elements(stats) s) then
  select s->>'variant' into winner from jsonb_array_elements(stats) s order by public.icash_learning_lower((s->>'fundedAccounts')::numeric,(s->>'observedAccounts')::numeric) desc,s->>'variant' limit 1;
  if bucket>=8000 then chosen:=winner;mode:='shared';end if;
 end if;
 insert into public.icash_learning_assignments(account_id,domain,subject,context,market,variant,mode) values(p_account,'workspace_prompts','account','funding-v1','*',chosen,mode);
 return chosen;
end $$;
do $$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_create_usage_loop_observation(uuid,text,text)'::regprocedure);
 needle:=$old$assigned:=case when (get_byte(decode(substr(md5(p_account::text),1,2),'hex'),0)/16)%2=0 then 'control' else 'progress' end;$old$;
 if position(needle in definition)=0 then raise exception 'Usage assignment prerequisite changed';end if;
 execute replace(definition,needle,'assigned:=public.icash_learning_usage_variant(p_account);');
end $$;

create function public.icash_platform_learning_report(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 return jsonb_build_object('version','shared-v1','checkedAt',now(),'minimumAccounts',3,'contributionCap',200,'maxLearnedShare',0.6,
 'dueAccounts',(select count(*) from public.icash_learning_queue where due_at<=now()),'failedAccounts',(select count(*) from public.icash_learning_queue where last_error_at is not null),
 'lastRefresh',(select max(last_refreshed_at) from public.icash_learning_queue),
 'conversionUpdatedAt',(select updated_at from public.icash_learning_conversion_cache where id=1),
 'cohorts',coalesce((select jsonb_agg(jsonb_build_object('domain',domain,'context',context,'market',market,'stats',public.icash_shared_learning_stats(domain,context,market)) order by domain,context,market)
  from (select distinct domain,context,market from public.icash_learning_rollups order by domain,context,market limit 200) cohorts),'[]'::jsonb),
 'cohortsTruncated',(select count(distinct (domain,context,market))>200 from public.icash_learning_rollups),
 'recoveryEnabled',(select count(*) from public.icash_seller_recovery_variants where enabled),
 'filterEnabled',coalesce((select enabled from public.icash_discovery_filter_settings where id=1),false));
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('icash_learning_signature_verified','icash_learning_deal_outcomes','icash_shared_learning_stats','icash_learning_lower','icash_shared_learning_winner','icash_learning_changed','icash_learning_usage_variant','icash_assign_shared_learning','icash_refresh_shared_learning','icash_refresh_learning_account','icash_workspace_revision_batch','icash_discovery_shared_evidence','icash_platform_learning_report','icash_opportunity_market_score','icash_opportunity_market_score_local','icash_choose_seller_recovery','icash_assign_seller_opener') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['icash_learning_usage_variant','icash_platform_learning_report']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
