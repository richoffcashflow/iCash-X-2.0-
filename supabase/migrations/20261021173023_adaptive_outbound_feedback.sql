-- Additive rollout: legacy feedback and in-flight plans remain valid.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_discovery_filter_feedback(p_account uuid,p_zip text)
returns jsonb language sql stable security invoker set search_path='' as $$
 with pages as (
  select p.*,o.charged_cents,o.state spend_state from public.icash_discovery_filter_pages p
  left join public.icash_operation_spend o on o.operation_key=p.operation_key and o.account_id=p.account_id
  where p.account_id=p_account and p.zip=p_zip and p.plan->>'version'='seller-filters-v1'
  and p.created_at between now()-interval '90 days' and now()
 ), prospects as (
  select a.screening_id,p.operation_key,p.plan->>'strategy' strategy,
   first_attempt.at is not null attempted,coalesce(first_attempt.at<=now()-interval '72 hours',false) mature,
   coalesce(o.responded,false) responded,coalesce(o.opted_out,false) opted_out,
   (coalesce(o.interested,false) or public.icash_filter_sms_interest(p_account,a.screening_id)) and not coalesce(o.opted_out,false) interested,
   s.state='complete' and exists(select 1 from public.icash_automation_tickets t
    where t.account_id=a.account_id and t.screening_id=a.screening_id and t.kind='contacts' and t.state='complete' and t.outcome='empty') no_owner
  from pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
  join public.icash_screening_jobs s on s.id=a.screening_id and s.account_id=a.account_id
  left join public.icash_opportunity_outcomes o on o.screening_id=a.screening_id and o.account_id=a.account_id
  left join lateral (
   select min(at) at from (
    select c.created_at at from public.icash_live_conversations c where c.account_id=a.account_id and c.screening_id=a.screening_id and c.party='seller' and c.conversation_id is not null
    union all select m.created_at from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
    where d.account_id=a.account_id and d.screening_id=a.screening_id and m.direction='outgoing' and m.provider_id is not null and m.state in ('accepted','delivered')
   ) attempts where at<=now()
  ) first_attempt on true
 ), operation_keys as (
  select p.plan->>'strategy' strategy,p.operation_key,true required from pages p where p.state not in ('empty','unavailable')
  union select p.strategy,'owners:'||p_account||':'||p.screening_id,
   exists(select 1 from public.icash_owner_contacts c where c.account_id=p_account and c.screening_id=p.screening_id) from prospects p
  union select p.strategy,c.operation_key,c.conversation_id is not null from prospects p
   join public.icash_live_conversations c on c.screening_id=p.screening_id and c.account_id=p_account
  union select p.strategy,'text:'||m.id,m.provider_id is not null from prospects p
   join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where m.direction='outgoing'
  union select p.strategy,'deal-email:'||e.id,false from prospects p
   join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_deal_emails e on e.deal_id=d.id and e.account_id=d.account_id where e.direction='outgoing'
 ), costs as (
  select k.strategy,coalesce(sum(o.charged_cents) filter(where o.state='settled'),0)::bigint cents,
   bool_and(case when o.operation_key is null then not k.required
    else o.state='cancelled' or (o.state='settled' and o.charged_cents is not null and o.charged_cents>=0) end) complete
  from operation_keys k left join public.icash_operation_spend o on o.operation_key=k.operation_key and o.account_id=p_account group by k.strategy
 ), recent_pages as (
  select p.plan->>'strategy' strategy,row_number() over(partition by p.plan->>'strategy' order by p.created_at desc,p.operation_key desc) position,
   p.state='complete' and p.spend_state='settled' and p.charged_cents>=0
   and not exists(select 1 from prospects f where f.operation_key=p.operation_key and (not f.no_owner or f.attempted)) unproductive
  from pages p
 )
 select jsonb_agg(jsonb_build_object('strategy',arms.strategy,'attempted',f.attempted,'matureAttempts',f.mature_attempts,
  'pendingAttempts',f.pending_attempts,'interested',f.interested,'optedOut',f.opted_out,'responded',f.responded,'properties',f.properties,
  'costCents',coalesce(c.cents,0),'costsComplete',coalesce(c.complete,true) and not exists(select 1 from pages p
   where p.plan->>'strategy'=arms.strategy and (p.state='claimed' or (p.state='complete' and (p.spend_state is distinct from 'settled' or p.charged_cents is null or p.charged_cents<0)))),
  -- Only three consecutive known empty/no-owner pages permit cooling. Queued,
  -- held, uncertain, financially-held or merely unanswered work breaks the run.
  'recentUnproductivePages',coalesce((select min(r.position)-1 from recent_pages r
   where r.strategy=arms.strategy and r.position<=3 and r.unproductive is distinct from true),
   (select count(*) from recent_pages r where r.strategy=arms.strategy and r.position<=3))))
 from unnest(array['baseline','vacant','absentee','repairs']) arms(strategy)
 cross join lateral(select count(*) properties,count(*) filter(where attempted) attempted,
  count(*) filter(where attempted and mature) mature_attempts,
  count(*) filter(where attempted and not mature and not interested and not opted_out) pending_attempts,
  count(*) filter(where attempted and responded and not opted_out) responded,
  count(*) filter(where attempted and interested) interested,count(*) filter(where attempted and opted_out) opted_out
  from prospects p where p.strategy=arms.strategy) f
 left join costs c on c.strategy=arms.strategy;
$$;

create function public.icash_discovery_filter_state_v2(p_account uuid,p_revision uuid,p_page integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_discovery_configs;stats jsonb;result jsonb;
begin
 if not exists(select 1 from public.icash_discovery_filter_settings where id=1 and enabled) then return null;end if;
 perform public.icash_refresh_opportunity_outcomes(p_account);
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision<>p_revision or c.next_page<>p_page then raise exception 'Filter configuration changed';end if;
 insert into public.icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page)
 select p_account,p_revision,c.zip,strategy,case when strategy='baseline' then c.next_page else 1 end
 from unnest(array['baseline','vacant','absentee','repairs']) strategy on conflict do nothing;
 stats:=public.icash_discovery_filter_feedback(p_account,c.zip);
 select jsonb_agg(s.value||jsonb_build_object('nextPage',cur.next_page,'exhausted',cur.exhausted,'pages',cur.pages)) into result
 from jsonb_array_elements(stats) s join public.icash_discovery_filter_cursors cur on cur.strategy=s.value->>'strategy'
 where cur.account_id=p_account and cur.revision=p_revision and cur.zip=c.zip;
 return result;
end $$;

revoke all on function public.icash_discovery_filter_feedback(uuid,text),public.icash_discovery_filter_state_v2(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_discovery_filter_feedback(uuid,text),public.icash_discovery_filter_state_v2(uuid,uuid,integer) to service_role;
commit;
