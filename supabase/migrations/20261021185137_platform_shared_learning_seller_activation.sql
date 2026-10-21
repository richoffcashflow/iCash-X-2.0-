-- Staged shared-learning rollout: private helpers before policy activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Preserve account-owned cursors/exhaustion and all existing admission checks.
create function public.icash_discovery_shared_evidence(p_account uuid,p_zip text) returns jsonb
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.icash_discovery_configs where account_id=p_account and zip=p_zip)
 then public.icash_shared_learning_stats('seller_filters','seller-filters-v1',p_zip) else '[]'::jsonb end;
$$;
alter function public.icash_opportunity_market_score(uuid,text) rename to icash_opportunity_market_score_local;
create function public.icash_opportunity_market_score(p_account uuid,p_zip text) returns numeric
language plpgsql stable security invoker set search_path='' as $$
declare s jsonb;
begin
 s:=public.icash_shared_learning_stats('market','research-v1',p_zip)->0;
 if coalesce((s->>'contributors')::integer,0)<3 or coalesce((s->>'effective_attempts')::numeric,0)<60 then return public.icash_opportunity_market_score_local(p_account,p_zip);end if;
 return greatest(-0.5,least(1,0.7*public.icash_learning_lower((s->>'effective_positive')::numeric,(s->>'effective_attempts')::numeric)
  +0.3*public.icash_learning_lower((s->>'effective_contracts')::numeric,(s->>'effective_contract_trials')::numeric)
  -least(0.5,(s->>'effective_opted_out')::numeric/greatest(1,(s->>'effective_attempts')::numeric))));
end $$;

create or replace function public.icash_choose_seller_recovery(p_account uuid,p_reason text,p_stage text,p_channel text,p_bucket integer) returns text
language plpgsql stable security invoker set search_path='' as $$
declare choices text[];winner text;
begin
 if p_bucket not between 0 and 9999 then raise exception 'Invalid recovery bucket';end if;
 select array_agg(v.key order by v.key) into choices from public.icash_seller_recovery_variants v where v.reason=p_reason and v.enabled
 and not exists(select 1 from public.icash_seller_recovery_attempts a where a.account_id=p_account and a.variant=v.key and a.reason=p_reason and a.stage=p_stage and a.source_channel=p_channel and a.delivered_at>now()-interval '180 days'
  group by a.variant having count(distinct a.deal_id)>=100 and count(distinct a.deal_id) filter(where a.opted_out_at is not null)::numeric/count(distinct a.deal_id)>0.05)
 and not exists(select 1 from jsonb_array_elements(public.icash_shared_learning_stats('seller_recovery',p_reason||':'||p_stage||':'||p_channel,'*')) s
  where s->>'variant'=v.key and (s->>'contributors')::int>=3 and (s->>'effective_attempts')::numeric>=100 and (s->>'effective_opted_out')::numeric/(s->>'effective_attempts')::numeric>0.05);
 if cardinality(choices) is null then return null;end if;
 winner:=public.icash_shared_learning_winner('seller_recovery',p_reason||':'||p_stage||':'||p_channel,'*',choices);
 if winner is not null and p_bucket>=8000 then return winner;end if;
 return choices[1+(p_bucket%cardinality(choices))];
end $$;
create or replace function public.icash_assign_seller_opener(p_account uuid,p_thread uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare existing public.icash_seller_opener_assignments;chosen public.icash_seller_opener_variants;choices text[];winner text;bucket bigint;
begin
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' for update;if not found then return null;end if;
 select * into existing from public.icash_seller_opener_assignments where thread_id=p_thread and account_id=p_account;
 if found then return jsonb_build_object('variant',existing.variant,'body',existing.body);end if;
 select array_agg(key order by key) into choices from public.icash_seller_opener_variants where enabled;
 if cardinality(choices) is null then return null;end if;
 bucket:=('x'||substr(md5(p_account::text||p_thread::text),1,8))::bit(32)::bigint%10000;
 winner:=public.icash_shared_learning_winner('seller_sms','opener-v1','*',choices);
 select * into chosen from public.icash_seller_opener_variants where key=case when winner is not null and bucket>=8000 then winner else choices[1+bucket%cardinality(choices)] end;
 insert into public.icash_seller_opener_assignments(thread_id,account_id,variant,body) values(p_thread,p_account,chosen.key,chosen.body);
 return jsonb_build_object('variant',chosen.key,'body',chosen.body);
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['icash_discovery_shared_evidence','icash_opportunity_market_score','icash_choose_seller_recovery','icash_assign_seller_opener']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
