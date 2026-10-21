-- Staged shared-learning rollout: private helpers before policy activation.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Cap each contributor's decision weight. Display totals remain actual counts.
create or replace function public.icash_shared_learning_stats(p_domain text,p_context text,p_market text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with samples as (select *,least(1,200.0/greatest(attempts,contract_trials,closing_trials,1)) weight from public.icash_learning_rollups
 where domain=p_domain and context=p_context and market=p_market and updated_at>now()-interval '6 hours'),
 stats as (select variant,count(*) filter(where attempts>0) contributors,sum(attempts) attempts,sum(pending) pending,sum(positive) positive,sum(opted_out) opted_out,
 sum(contract_trials) contract_trials,sum(contracts) contracts,sum(closing_trials) closing_trials,sum(closings) closings,sum(cost_cents) cost_cents,bool_and(costs_complete) costs_complete,min(updated_at) updated_at,
 sum(attempts*weight) effective_attempts,sum(pending*weight) effective_pending,sum(positive*weight) effective_positive,sum(opted_out*weight) effective_opted_out,
 sum(contract_trials*weight) effective_contract_trials,sum(contracts*weight) effective_contracts,sum(closing_trials*weight) effective_closing_trials,sum(closings*weight) effective_closings,sum(cost_cents*weight) effective_cost_cents from samples group by variant)
 select coalesce(jsonb_agg(to_jsonb(stats) order by variant),'[]') from stats;
$$;
create or replace function public.icash_learning_lower(p_wins numeric,p_trials numeric) returns numeric
language sql immutable security invoker set search_path='' as $$
 select case when p_trials<=0 or p_wins<0 or p_wins>p_trials then 0 else greatest(0,
 (p_wins/p_trials+2.706025/(2*p_trials)-1.645*sqrt((p_wins/p_trials)*(1-p_wins/p_trials)/p_trials+2.706025/(4*p_trials*p_trials)))/(1+2.706025/p_trials)) end;
$$;
create or replace function public.icash_shared_learning_winner(p_domain text,p_context text,p_market text,p_choices text[]) returns text
language plpgsql stable security invoker set search_path='' as $$
declare s jsonb;all_stats jsonb;winner text;score numeric;best numeric:=-1;objective text:='positive';
begin
 if cardinality(p_choices)<2 then return null;end if;
 all_stats:=public.icash_shared_learning_stats(p_domain,p_context,p_market);
 if (select count(*) from jsonb_array_elements(all_stats) r where r->>'variant'=any(p_choices) and (r->>'contributors')::int>=3
  and (r->>'effective_attempts')::numeric-(r->>'effective_pending')::numeric>=100 and (r->>'effective_opted_out')::numeric/greatest(1,(r->>'effective_attempts')::numeric)<=0.05)<>cardinality(p_choices) then return null;end if;
 if (select bool_and((r->>'effective_closing_trials')::numeric>=100 and (r->>'effective_closings')::numeric>=5) from jsonb_array_elements(all_stats) r where r->>'variant'=any(p_choices)) then objective:='closings';
 elsif (select bool_and((r->>'effective_contract_trials')::numeric>=100 and (r->>'effective_contracts')::numeric>=5) from jsonb_array_elements(all_stats) r where r->>'variant'=any(p_choices)) then objective:='contracts';
 elsif p_domain='seller_recovery' then return null;end if;
 for s in select value from jsonb_array_elements(all_stats) where value->>'variant'=any(p_choices) loop
  score:=public.icash_learning_lower((s->>('effective_'||objective))::numeric,
   case objective when 'closings' then (s->>'effective_closing_trials')::numeric when 'contracts' then (s->>'effective_contract_trials')::numeric else (s->>'effective_attempts')::numeric-(s->>'effective_pending')::numeric end);
  if score>best then best:=score;winner:=s->>'variant';end if;
 end loop;
 return case when best>0 then winner end;
end $$;

create or replace function public.icash_assign_shared_learning(p_account uuid,p_domain text,p_subject text,p_context text,p_market text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare existing public.icash_learning_assignments;choices text[];winner text;bucket bigint;chosen text;mode text:='explore';
begin
 if not exists(select 1 from public.icash_accounts where id=p_account) or length(p_subject) not between 1 and 200 then return null;end if;
 if p_domain='seller_calls' and p_context in ('reviewed','limited') and p_market='*' then choices:=array['cash_interest','flexible_timing'];
 elsif p_domain='buyer_search' and p_context='order-v1' and p_market ~ '^[0-9]{5}$' then choices:=array['recent_corporate','corporate_owners'];
 else raise exception 'Unreviewed learning policy';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||p_domain||p_subject,81022));
 select * into existing from public.icash_learning_assignments where account_id=p_account and domain=p_domain and subject=p_subject;
 if found then
  if existing.context<>p_context or existing.market<>p_market then return null;end if;
  return jsonb_build_object('variant',existing.variant,'version',existing.policy_version,'mode',existing.mode);end if;
 -- Old conversations/cursors retain their existing behavior and are not
 -- relabelled as exposure to the prospective shared policy.
 if p_domain='seller_calls' and exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id::text=split_part(p_subject,':',1)) then return null;end if;
 if p_domain='buyer_search' and exists(select 1 from public.icash_buyer_search_receipts r join public.icash_deal_files d on d.id=r.deal_id where d.account_id=p_account and d.id::text||':'||r.revision=p_subject) then return null;end if;
 bucket:=('x'||substr(md5(p_account::text||p_domain||p_subject||'shared-v1'),1,8))::bit(32)::bigint%10000;
 winner:=public.icash_shared_learning_winner(p_domain,p_context,p_market,choices);
 chosen:=choices[1+(bucket%cardinality(choices))];
 if winner is not null and bucket>=8000 then chosen:=winner;mode:='shared';end if;
 insert into public.icash_learning_assignments(account_id,domain,subject,context,market,variant,mode) values(p_account,p_domain,p_subject,p_context,p_market,chosen,mode);
 return jsonb_build_object('variant',chosen,'version','shared-v1','mode',mode);
end $$;
do $$ declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array['icash_shared_learning_stats','icash_learning_lower','icash_shared_learning_winner','icash_assign_shared_learning']) loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;end $$;
commit;
