-- Shared aggregate evidence; private records, budgets and permissions stay owned.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table public.icash_learning_rollups(
 account_id uuid not null references public.icash_accounts(id),domain text not null,context text not null,market text not null,variant text not null,
 attempts bigint not null default 0,pending bigint not null default 0,positive bigint not null default 0,opted_out bigint not null default 0,
 contract_trials bigint not null default 0,contracts bigint not null default 0,closing_trials bigint not null default 0,closings bigint not null default 0,
 cost_cents bigint not null default 0,costs_complete boolean not null default false,updated_at timestamptz not null default now(),
 primary key(account_id,domain,context,market,variant),
 check(attempts>=0 and pending between 0 and attempts and positive between 0 and attempts and opted_out between 0 and attempts
  and contracts between 0 and contract_trials and closings between 0 and closing_trials and cost_cents>=0)
);
create index icash_learning_cohorts on public.icash_learning_rollups(domain,context,market,updated_at);
create table public.icash_learning_queue(
 account_id uuid primary key references public.icash_accounts(id),due_at timestamptz not null default now(),last_refreshed_at timestamptz,last_error_at timestamptz
);
create index icash_learning_due on public.icash_learning_queue(due_at);
create table public.icash_learning_assignments(
 account_id uuid not null references public.icash_accounts(id),domain text not null,subject text not null,context text not null,market text not null,
 variant text not null,policy_version text not null default 'shared-v1',mode text not null check(mode in ('explore','shared')),created_at timestamptz not null default now(),
 primary key(account_id,domain,subject)
);
create table public.icash_workspace_revisions(
 account_id uuid primary key references public.icash_accounts(id),revision bigint not null default 1,changed_at timestamptz not null default now()
);
create table public.icash_learning_conversion_cache(id integer primary key check(id=1),report jsonb not null,updated_at timestamptz not null default now());
alter table public.icash_learning_conversion_cache enable row level security;
revoke all on public.icash_learning_conversion_cache from public,anon,authenticated;
grant all on public.icash_learning_conversion_cache to service_role;
alter table public.icash_learning_rollups enable row level security;
alter table public.icash_learning_queue enable row level security;
alter table public.icash_learning_assignments enable row level security;
alter table public.icash_workspace_revisions enable row level security;
revoke all on public.icash_learning_rollups,public.icash_learning_queue,public.icash_learning_assignments,public.icash_workspace_revisions from public,anon,authenticated;
grant all on public.icash_learning_rollups,public.icash_learning_queue,public.icash_learning_assignments,public.icash_workspace_revisions to service_role;

-- Same provider/envelope/terms/recipient binding as verifiedSigningStatus in TS.
create function public.icash_learning_signature_verified(e public.icash_signing_envelopes) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare d jsonb:=e.provider_evidence;r jsonb;match jsonb;ordinal bigint;
begin
 if e.test_mode is distinct from false or e.state is distinct from 'completed' or e.provider_id is null
  or d->>'id' is distinct from e.provider_id or d->'test_mode' is distinct from 'false'::jsonb
  or lower(d->>'status') is distinct from 'completed' or d->'apply_signing_order' is distinct from 'true'::jsonb
  or d->'metadata'->>'icash_envelope' is distinct from e.id::text or d->'metadata'->>'terms_hash' is distinct from e.terms_hash
  or jsonb_typeof(e.recipients) is distinct from 'array' or jsonb_typeof(d->'recipients') is distinct from 'array' then return false;end if;
 if jsonb_array_length(e.recipients)<2 or jsonb_array_length(e.recipients)<>jsonb_array_length(d->'recipients')
  or (select count(distinct value->>'id') from jsonb_array_elements(e.recipients))<>jsonb_array_length(e.recipients)
  or (select count(distinct value->>'id') from jsonb_array_elements(d->'recipients'))<>jsonb_array_length(e.recipients) then return false;end if;
 for r,ordinal in select value,ordinality from jsonb_array_elements(e.recipients) with ordinality loop
  select value into match from jsonb_array_elements(d->'recipients') where value->>'id'=r->>'id';
  if match is null or lower(match->>'status') is distinct from 'signed' or match->'signing_order' is distinct from to_jsonb(ordinal)
   or (case when nullif(r->>'phone','') is not null then match->>'phone' is distinct from r->>'phone'
     else nullif(r->>'email','') is null or lower(match->>'email') is distinct from lower(r->>'email') end) then return false;end if;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.icash_learning_deal_outcomes(p_account uuid)
returns table(deal_id uuid,screening_id uuid,purchase_at timestamptz,assignment_at timestamptz,closed_at timestamptz)
language sql stable security invoker set search_path='' as $$
 with signed as materialized (
  select e.deal_id,min(e.updated_at) filter(where e.kind='purchase') purchase_at,min(e.updated_at) filter(where e.kind='assignment') assignment_at
  from public.icash_signing_envelopes e where e.account_id=p_account and e.updated_at<=now() and public.icash_learning_signature_verified(e) group by e.deal_id
 ) select d.id,d.screening_id,s.purchase_at,s.assignment_at,
  (select min(u.created_at) from public.icash_closing_updates u join public.icash_title_replies r
   on r.id=u.reply_id and r.account_id=u.account_id and r.deal_id=u.deal_id and r.sender_verified
   where u.account_id=p_account and u.deal_id=d.id and u.kind='closed' and u.created_at between s.assignment_at and now()
    and r.received_at<=u.created_at and u.effective_date<=(now() at time zone 'America/Chicago')::date
    and (u.confirmed_by is not null or u.confirmation_source='verified_title_format')
    and s.purchase_at is not null and s.assignment_at is not null)
 from public.icash_deal_files d left join signed s on s.deal_id=d.id
 join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=d.account_id
 where d.account_id=p_account and coalesce(d.terms->>'practice','false')<>'true'
 and coalesce(j.snapshot->>'practice','false')<>'true' and coalesce(j.snapshot->>'propertyId','') not like 'practice_%';
$$;

-- Rebuild one account atomically. No transcripts, phones, names or addresses
-- enter these rollups. Fixed outcome windows avoid rewarding older variants.
create function public.icash_refresh_learning_account(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare zip_code text;s jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81021));
 perform public.icash_refresh_opportunity_outcomes(p_account);
 delete from public.icash_learning_rollups where account_id=p_account;
 for zip_code in select distinct zip from public.icash_discovery_filter_pages where account_id=p_account and created_at>now()-interval '90 days' loop
  for s in select value from jsonb_array_elements(public.icash_discovery_filter_feedback(p_account,zip_code)) loop
   insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,cost_cents,costs_complete,contract_trials,contracts,closing_trials,closings)
   select p_account,'seller_filters','seller-filters-v1',zip_code,s->>'strategy',(s->>'attempted')::bigint,(s->>'pendingAttempts')::bigint,(s->>'interested')::bigint,(s->>'optedOut')::bigint,(s->>'costCents')::bigint,(s->>'costsComplete')::boolean,
    count(*) filter(where p.created_at<=now()-interval '30 days'),
    count(*) filter(where p.created_at<=now()-interval '30 days' and e.purchase_at between p.created_at and p.created_at+interval '30 days'),
    count(*) filter(where p.created_at<=now()-interval '60 days'),
    count(*) filter(where p.created_at<=now()-interval '60 days' and e.closed_at between p.created_at and p.created_at+interval '60 days')
   from public.icash_discovery_filter_pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
   left join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=a.screening_id
   where p.account_id=p_account and p.zip=zip_code and p.plan->>'version'='seller-filters-v1' and p.plan->>'strategy'=s->>'strategy' and p.created_at between now()-interval '90 days' and now();
  end loop;
 end loop;
 -- Market learning uses verified signatures, never an optimistic deal stage.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,costs_complete)
 select p_account,'market','research-v1',o.zip,'market',count(*),0,count(*) filter(where o.interested and not o.opted_out),count(*) filter(where o.opted_out),
 count(*) filter(where o.discovered_at<=now()-interval '30 days'),count(*) filter(where o.discovered_at<=now()-interval '30 days' and e.purchase_at between o.discovered_at and o.discovered_at+interval '30 days'),
 count(*) filter(where o.discovered_at<=now()-interval '60 days'),count(*) filter(where o.discovered_at<=now()-interval '60 days' and e.closed_at between o.discovered_at and o.discovered_at+interval '60 days'),false
 from public.icash_opportunity_outcomes o left join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=o.screening_id
 where o.account_id=p_account and o.research_source and o.discovered_at between now()-interval '90 days' and now()-interval '72 hours' group by o.zip;
 -- Recovery: one first delivered attempt per deal/context, 30-day contract and
 -- 60-day closing windows. Disabled copy remains disabled.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_recovery',a.reason||':'||a.stage||':'||a.source_channel,'*',a.variant,count(*),count(*) filter(where a.delivered_at>now()-interval '30 days'),
 count(*) filter(where a.delivered_at<=now()-interval '30 days' and a.responded_at between a.delivered_at and a.delivered_at+interval '30 days' and a.opted_out_at is null),count(*) filter(where a.opted_out_at is not null),
 count(*) filter(where a.delivered_at<=now()-interval '30 days'),count(*) filter(where a.delivered_at<=now()-interval '30 days' and e.purchase_at between a.delivered_at and a.delivered_at+interval '30 days'),
 count(*) filter(where a.delivered_at<=now()-interval '60 days'),count(*) filter(where a.delivered_at<=now()-interval '60 days' and e.closed_at between a.delivered_at and a.delivered_at+interval '60 days'),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from (select distinct on (deal_id,reason,stage,source_channel) * from public.icash_seller_recovery_attempts where account_id=p_account and delivered_at between now()-interval '180 days' and now() order by deal_id,reason,stage,source_channel,delivered_at,gap_id) a
 join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=a.deal_id
 left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||a.message_id group by a.reason,a.stage,a.source_channel,a.variant;
 -- Legacy SMS experiments only count a receipt for the assigned exact body.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,cost_cents,costs_complete)
 select p_account,'seller_sms','opener-v1','*',a.variant,count(*),count(*) filter(where a.delivered_at>now()-interval '72 hours'),
 count(*) filter(where a.delivered_at<=now()-interval '72 hours' and a.first_reply_at between a.delivered_at and a.delivered_at+interval '72 hours' and not a.opted_out),count(*) filter(where a.opted_out),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from public.icash_seller_opener_assignments a join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id and m.body=a.body and m.state='delivered' and m.provider_id is not null
 join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=t.deal_id
 left join public.icash_operation_spend o on o.account_id=p_account and o.operation_key='text:'||m.id
 where a.account_id=p_account and a.delivered_at between now()-interval '90 days' and now() group by a.variant;
 -- Only prospective, actually dispatched versioned call assignments count.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'seller_calls',a.context,'*',a.variant,count(*),count(*) filter(where c.created_at>now()-interval '72 hours'),
 count(*) filter(where c.created_at<=now()-interval '72 hours' and c.state='complete' and c.completed_at<=c.created_at+interval '72 hours' and c.result->'interested'='true'::jsonb and coalesce(c.result->>'optedOut','false')<>'true'),
 count(*) filter(where c.result->'optedOut'='true'::jsonb),count(*) filter(where c.created_at<=now()-interval '30 days'),count(*) filter(where c.created_at<=now()-interval '30 days' and e.purchase_at between c.created_at and c.created_at+interval '30 days'),
 count(*) filter(where c.created_at<=now()-interval '60 days'),count(*) filter(where c.created_at<=now()-interval '60 days' and e.closed_at between c.created_at and c.created_at+interval '60 days'),
 coalesce(sum(o.charged_cents) filter(where o.state='settled'),0),bool_and(o.state='settled' and o.charged_cents is not null) is true
 from public.icash_learning_assignments a join lateral(select c.* from public.icash_live_conversations c where c.account_id=a.account_id and c.screening_id::text||':'||c.contact_key=a.subject and c.strategy_key=a.variant and c.party='seller' and c.conversation_id is not null and c.created_at>=a.created_at and exists(select 1 from public.icash_call_recordings r where r.operation_key=c.operation_key and r.account_id=c.account_id and r.call_context->>'strategyKey'=a.variant and position('REVIEWED INTEREST QUESTION (shared-v1/'||a.context||'):' in r.call_context->>'prompt')>0) order by c.created_at,c.id limit 1) c on true
 join public.icash_learning_deal_outcomes(p_account) e on e.screening_id=c.screening_id
 join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=p_account and o.dispatched_at is not null
 where a.account_id=p_account and a.domain='seller_calls' and a.policy_version='shared-v1'
 and not exists(select 1 from public.icash_live_conversations earlier join public.icash_call_recordings er on er.account_id=earlier.account_id and er.operation_key=earlier.operation_key where earlier.account_id=p_account and earlier.screening_id=c.screening_id and earlier.party='seller' and earlier.conversation_id is not null and row(earlier.created_at,earlier.id)<row(c.created_at,c.id) and position('REVIEWED INTEREST QUESTION (shared-v1/' in er.call_context->>'prompt')>0) and c.created_at between now()-interval '180 days' and now() group by a.context,a.variant;
 -- Buyer policies are assigned per deal/revision. Qualification is an explicit
 -- reviewed buyer match; an owner lookup or an email click is not qualification.
 insert into public.icash_learning_rollups(account_id,domain,context,market,variant,attempts,pending,positive,opted_out,contract_trials,contracts,closing_trials,closings,cost_cents,costs_complete)
 select p_account,'buyer_search','order-v1',a.market,a.variant,count(*),count(*) filter(where first_receipt.at>now()-interval '30 days'),
 count(*) filter(where first_receipt.at<=now()-interval '30 days' and exists(select 1 from public.icash_buyer_matches m where m.deal_id=d.id and m.ready and m.qualification_request_id is not null and m.created_at between first_receipt.at and first_receipt.at+interval '30 days')),0,
 count(*) filter(where first_receipt.at<=now()-interval '30 days'),count(*) filter(where first_receipt.at<=now()-interval '30 days' and e.assignment_at between first_receipt.at and first_receipt.at+interval '30 days'),
 count(*) filter(where first_receipt.at<=now()-interval '60 days'),count(*) filter(where first_receipt.at<=now()-interval '60 days' and e.closed_at between first_receipt.at and first_receipt.at+interval '60 days'),coalesce(sum(cost.cents),0),bool_and(cost.complete) is true
 from public.icash_learning_assignments a join public.icash_deal_files d on d.account_id=a.account_id and a.subject like d.id::text||':%'
 join public.icash_learning_deal_outcomes(p_account) e on e.deal_id=d.id
 join lateral(select min(r.created_at) at from public.icash_buyer_search_receipts r where r.deal_id=d.id and a.subject=d.id::text||':'||r.revision and r.created_at>=a.created_at) first_receipt on first_receipt.at is not null
 cross join lateral(select coalesce(sum(o.charged_cents) filter(where o.state='settled'),0) cents,bool_and(case when r.operation_key is null then r.receipt->'emptyEstimate'='true'::jsonb else o.state='settled' and o.charged_cents is not null end) complete from public.icash_buyer_search_receipts r left join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=p_account where r.deal_id=d.id and a.subject=d.id::text||':'||r.revision) cost
 where a.account_id=p_account and a.domain='buyer_search' and a.policy_version='shared-v1' and a.context='order-v1' and first_receipt.at between now()-interval '180 days' and now() group by a.market,a.variant;
end $$;

-- Cap each contributor's decision weight. Display totals remain actual counts.
create function public.icash_shared_learning_stats(p_domain text,p_context text,p_market text) returns jsonb
language sql stable security invoker set search_path='' as $$
 with samples as (select *,least(1,200.0/greatest(attempts,contract_trials,closing_trials,1)) weight from public.icash_learning_rollups
 where domain=p_domain and context=p_context and market=p_market and updated_at>now()-interval '6 hours'),
 stats as (select variant,count(*) filter(where attempts>0) contributors,sum(attempts) attempts,sum(pending) pending,sum(positive) positive,sum(opted_out) opted_out,
 sum(contract_trials) contract_trials,sum(contracts) contracts,sum(closing_trials) closing_trials,sum(closings) closings,sum(cost_cents) cost_cents,bool_and(costs_complete) costs_complete,min(updated_at) updated_at,
 sum(attempts*weight) effective_attempts,sum(pending*weight) effective_pending,sum(positive*weight) effective_positive,sum(opted_out*weight) effective_opted_out,
 sum(contract_trials*weight) effective_contract_trials,sum(contracts*weight) effective_contracts,sum(closing_trials*weight) effective_closing_trials,sum(closings*weight) effective_closings,sum(cost_cents*weight) effective_cost_cents from samples group by variant)
 select coalesce(jsonb_agg(to_jsonb(stats) order by variant),'[]') from stats;
$$;
create function public.icash_learning_lower(p_wins numeric,p_trials numeric) returns numeric
language sql immutable security invoker set search_path='' as $$
 select case when p_trials<=0 or p_wins<0 or p_wins>p_trials then 0 else greatest(0,
 (p_wins/p_trials+2.706025/(2*p_trials)-1.645*sqrt((p_wins/p_trials)*(1-p_wins/p_trials)/p_trials+2.706025/(4*p_trials*p_trials)))/(1+2.706025/p_trials)) end;
$$;
create function public.icash_shared_learning_winner(p_domain text,p_context text,p_market text,p_choices text[]) returns text
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

create function public.icash_assign_shared_learning(p_account uuid,p_domain text,p_subject text,p_context text,p_market text) returns jsonb
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

-- Cheap revisions wake readers; expensive aggregate work runs in bounded batches.
create function public.icash_learning_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare item jsonb;account uuid;
begin
 if tg_op='UPDATE' and (to_jsonb(new)-array['updated_at','next_poll_at','poll_attempts','next_attempt_at','attempts','lease_until','lease_token'])
  is not distinct from (to_jsonb(old)-array['updated_at','next_poll_at','poll_attempts','next_attempt_at','attempts','lease_until','lease_token']) then return new;end if;
 item:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 account:=case when tg_table_name='icash_accounts' then (item->>'id')::uuid else (item->>'account_id')::uuid end;
 if account is null and item->>'deal_id' is not null then select account_id into account from public.icash_deal_files where id=(item->>'deal_id')::uuid;end if;
 if account is not null and exists(select 1 from public.icash_accounts where id=account) then
  insert into public.icash_workspace_revisions(account_id) values(account) on conflict(account_id) do update set revision=public.icash_workspace_revisions.revision+1,changed_at=now();
  insert into public.icash_learning_queue(account_id) values(account) on conflict(account_id) do update set due_at=least(public.icash_learning_queue.due_at,now()+interval '1 minute');
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
do $$ declare t text;begin
 foreach t in array array['icash_accounts','icash_wallets','icash_screening_jobs','icash_deal_files','icash_live_conversations','icash_text_messages','icash_text_threads','icash_operation_spend','icash_signing_envelopes','icash_closing_updates','icash_title_replies','icash_proceeds_receipts','icash_discovery_configs','icash_discovery_filter_pages','icash_seller_recovery_attempts','icash_buyer_search_receipts','icash_buyer_matches'] loop
  execute format('create trigger icash_learning_change after insert or update or delete on public.%I for each row execute function public.icash_learning_changed()',t);
 end loop;
end $$;
insert into public.icash_learning_queue(account_id) select id from public.icash_accounts;

create function public.icash_refresh_shared_learning(p_limit integer default 2) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record;refreshed integer:=0;failed integer:=0;
begin
 if p_limit not between 1 and 5 then raise exception 'Invalid learning batch';end if;
 if not exists(select 1 from public.icash_learning_conversion_cache where id=1 and updated_at>now()-interval '5 minutes') and pg_try_advisory_xact_lock(810211) then
  begin
   insert into public.icash_learning_conversion_cache(id,report) values(1,public.icash_usage_loop_report('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',false))
   on conflict(id) do update set report=excluded.report,updated_at=now();
  exception when others then failed:=failed+1;end;
 end if;
 for item in select account_id from public.icash_learning_queue where due_at<=now() order by due_at,account_id for update skip locked limit p_limit loop
  begin
   perform public.icash_refresh_learning_account(item.account_id);
   update public.icash_learning_queue set due_at=now()+interval '1 hour',last_refreshed_at=now(),last_error_at=null where account_id=item.account_id;
   refreshed:=refreshed+1;
  exception when others then
   update public.icash_learning_queue set due_at=now()+interval '5 minutes',last_error_at=now() where account_id=item.account_id;failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('refreshed',refreshed,'failed',failed,'due',(select count(*) from public.icash_learning_queue where due_at<=now()));
end $$;
create function public.icash_workspace_revision_batch(p_accounts uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_object_agg(account_id::text,revision::text),'{}') from public.icash_workspace_revisions where cardinality(p_accounts)<=100 and account_id=any(p_accounts);
$$;

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
 where n.nspname='public' and (p.proname like 'icash_learning_%' or p.proname like 'icash_shared_learning_%' or p.proname in ('icash_assign_shared_learning','icash_refresh_shared_learning','icash_refresh_learning_account','icash_workspace_revision_batch','icash_discovery_shared_evidence','icash_platform_learning_report','icash_opportunity_market_score','icash_opportunity_market_score_local','icash_choose_seller_recovery','icash_assign_seller_opener')) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
