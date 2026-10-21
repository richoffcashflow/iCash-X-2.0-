-- Reviewed property filters, durable provider cursors and receipt-backed learning.
-- Roll out schema first with the switch off; enable only after the app is deployed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.icash_discovery_filter_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into public.icash_discovery_filter_settings values(1,false);
create table public.icash_discovery_filter_cursors(
 account_id uuid not null references public.icash_accounts(id),revision uuid not null,zip text not null check(zip ~ '^[0-9]{5}$'),
 strategy text not null check(strategy in ('baseline','vacant','absentee','repairs')),
 next_page integer not null default 1 check(next_page>0),exhausted boolean not null default false,pages integer not null default 0 check(pages>=0),
 primary key(account_id,revision,strategy)
);
create table public.icash_discovery_filter_pages(
 operation_key text primary key,account_id uuid not null references public.icash_accounts(id),revision uuid not null,sequence integer not null check(sequence>0),
 zip text not null,plan jsonb not null,state text not null check(state in ('claimed','complete','empty','unavailable')),
 created_at timestamptz not null default now(),completed_at timestamptz,unique(account_id,revision,sequence)
);
create index icash_discovery_filter_pages_market on public.icash_discovery_filter_pages(account_id,zip,created_at);
create table public.icash_discovery_filter_attribution(
 screening_id uuid primary key references public.icash_screening_jobs(id),account_id uuid not null references public.icash_accounts(id),
 operation_key text not null references public.icash_discovery_filter_pages(operation_key)
);
create index icash_discovery_filter_attribution_page on public.icash_discovery_filter_attribution(operation_key,account_id);
create index icash_discovery_filter_attribution_account on public.icash_discovery_filter_attribution(account_id,screening_id);
alter table public.icash_discovery_filter_settings enable row level security;
alter table public.icash_discovery_filter_cursors enable row level security;
alter table public.icash_discovery_filter_pages enable row level security;
alter table public.icash_discovery_filter_attribution enable row level security;
revoke all on public.icash_discovery_filter_settings,public.icash_discovery_filter_cursors,public.icash_discovery_filter_pages,public.icash_discovery_filter_attribution from public,anon,authenticated;
grant select,insert,update on public.icash_discovery_filter_settings,public.icash_discovery_filter_cursors,public.icash_discovery_filter_pages to service_role;
grant select,insert on public.icash_discovery_filter_attribution to service_role;

create function public.icash_discovery_filter_plan_valid(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object' and p->>'version'='seller-filters-v1'
 and p->>'strategy' in ('baseline','vacant','absentee','repairs') and p->>'mode' in ('explore','learned')
 and jsonb_typeof(p->'providerPage')='number' and p->>'providerPage' ~ '^[1-9][0-9]{0,8}$'
 and p=jsonb_build_object('version',p->'version','strategy',p->'strategy','providerPage',p->'providerPage','mode',p->'mode'),false);
$$;

-- A bare ownership confirmation is never selling interest. Only a receipt-backed
-- affirmative reply directly following the saved selling-interest question counts.
create function public.icash_filter_sms_interest(p_account uuid,p_screening uuid) returns boolean language sql stable set search_path='' as $$
 select exists(
 select 1 from public.icash_deal_files d
 join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
 join public.icash_sms_seller_openings opening on opening.thread_id=t.id and opening.account_id=t.account_id
 join public.icash_text_messages question on question.id=opening.interest_message_id and question.thread_id=t.id and question.account_id=t.account_id
 join public.icash_text_messages reply on reply.thread_id=t.id and reply.account_id=t.account_id
 where d.account_id=p_account and d.screening_id=p_screening
 and question.direction='outgoing' and question.state in ('accepted','delivered') and question.provider_id is not null
 and reply.direction='incoming' and reply.state='received' and (reply.provider_id is not null or reply.event_id is not null)
 and reply.created_at>question.created_at
 and lower(trim(reply.body)) ~ '^(yes|yeah|yep|sure|interested|i am interested|i''m interested|yes i am|yes i am interested|yes, i am interested|yes interested|yes, interested)[.! ]*$'
 and not exists(select 1 from public.icash_text_messages between_message where between_message.thread_id=t.id and between_message.account_id=t.account_id
  and between_message.created_at>question.created_at and between_message.created_at<reply.created_at
  and ((between_message.direction='outgoing' and between_message.provider_id is not null and between_message.state in ('accepted','delivered')) or (between_message.direction='incoming' and between_message.state='received')))
 );
$$;

-- Private, aggregate report: settled customer cents, never a rate-card estimate.
-- Costs include unsuccessful research and duplicate search results. No property can
-- be attributed twice. Use 90 days in the same account/ZIP and allow 72 hours after
-- the first actual call/text attempt before treating its outcome as mature.
create function public.icash_discovery_filter_stats(p_account uuid,p_zip text) returns jsonb language sql stable set search_path='' as $$
 with pages as (
  select p.*,o.charged_cents,o.state spend_state from public.icash_discovery_filter_pages p
  left join public.icash_operation_spend o on o.operation_key=p.operation_key and o.account_id=p.account_id
  where p.account_id=p_account and p.zip=p_zip and p.plan->>'version'='seller-filters-v1'
  and p.created_at between now()-interval '90 days' and now()-interval '72 hours'
 ), prospects as (
  select a.screening_id,p.operation_key,p.plan->>'strategy' strategy,o.attempted,o.responded,o.opted_out,
   (o.interested or public.icash_filter_sms_interest(p_account,a.screening_id)) and not o.opted_out interested,
   first_attempt.at<now()-interval '72 hours' mature
  from pages p join public.icash_discovery_filter_attribution a on a.operation_key=p.operation_key and a.account_id=p.account_id
  left join public.icash_opportunity_outcomes o on o.screening_id=a.screening_id and o.account_id=a.account_id
  left join lateral (
   select min(at) at from (
    select c.created_at at from public.icash_live_conversations c where c.account_id=a.account_id and c.screening_id=a.screening_id and c.party='seller' and c.conversation_id is not null
    union all select m.created_at from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
    join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where d.account_id=a.account_id and d.screening_id=a.screening_id and m.direction='outgoing' and m.provider_id is not null and m.state in ('accepted','delivered')
   ) attempts
  ) first_attempt on true
 ), operation_keys as (
  select p.plan->>'strategy' strategy,p.operation_key from pages p where p.state not in ('empty','unavailable')
  union select p.strategy,'owners:'||p_account||':'||p.screening_id from prospects p
  union select p.strategy,c.operation_key from prospects p join public.icash_live_conversations c on c.screening_id=p.screening_id and c.account_id=p_account
  union select p.strategy,'text:'||m.id from prospects p join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where m.direction='outgoing'
  union select p.strategy,'deal-email:'||e.id from prospects p join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p_account
   join public.icash_deal_emails e on e.deal_id=d.id and e.account_id=d.account_id where e.direction='outgoing'
 ), costs as (
  select k.strategy,coalesce(sum(o.charged_cents) filter(where o.state='settled'),0)::bigint cents,
   coalesce(bool_and(o.state='cancelled' or (o.state='settled' and o.charged_cents is not null and o.charged_cents>=0)),true) complete
  from operation_keys k join public.icash_operation_spend o on o.operation_key=k.operation_key and o.account_id=p_account group by k.strategy
 )
 select jsonb_agg(jsonb_build_object('strategy',arms.strategy,'matureAttempts',coalesce(f.mature_attempts,0),'interested',coalesce(f.interested,0),
  'optedOut',coalesce(f.opted_out,0),'responded',coalesce(f.responded,0),'attempted',coalesce(f.attempted,0),'properties',coalesce(f.properties,0),
  'costCents',coalesce(c.cents,0),'costsComplete',coalesce(c.complete,true) and not exists(select 1 from pages p where p.plan->>'strategy'=arms.strategy and (p.state='claimed' or (p.state='complete' and p.spend_state is distinct from 'settled')))))
 from unnest(array['baseline','vacant','absentee','repairs']) arms(strategy)
 left join lateral(select count(*) properties,count(*) filter(where attempted) attempted,count(*) filter(where attempted and mature) mature_attempts,
  count(*) filter(where attempted and mature and responded and not opted_out) responded,count(*) filter(where attempted and mature and interested) interested,
  count(*) filter(where attempted and mature and opted_out) opted_out from prospects p where p.strategy=arms.strategy) f on true
 left join costs c on c.strategy=arms.strategy;
$$;

create function public.icash_discovery_filter_state(p_account uuid,p_revision uuid,p_page integer) returns jsonb language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;stats jsonb;result jsonb;
begin
 if not exists(select 1 from public.icash_discovery_filter_settings where id=1 and enabled) then return null;end if;
 perform public.icash_refresh_opportunity_outcomes(p_account);
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision<>p_revision or c.next_page<>p_page then raise exception 'Filter configuration changed';end if;
 insert into public.icash_discovery_filter_cursors(account_id,revision,zip,strategy,next_page)
 select p_account,p_revision,c.zip,strategy,case when strategy='baseline' then c.next_page else 1 end
 from unnest(array['baseline','vacant','absentee','repairs']) strategy on conflict do nothing;
 stats:=public.icash_discovery_filter_stats(p_account,c.zip);
 select jsonb_agg(s.value||jsonb_build_object('nextPage',cur.next_page,'exhausted',cur.exhausted,'pages',cur.pages)) into result
 from jsonb_array_elements(stats) s join public.icash_discovery_filter_cursors cur on cur.strategy=s.value->>'strategy'
 where cur.account_id=p_account and cur.revision=p_revision and cur.zip=c.zip;
 return result;
end $$;

create function public.icash_reserve_and_claim_filtered_discovery(
 p_account uuid,p_zip text,p_revision uuid,p_page integer,p_per_page integer,p_rate uuid,p_unit bigint,p_permission_until timestamptz,
 p_setup_revision integer,p_market_mode text,p_market text,p_plan jsonb)
returns boolean language plpgsql set search_path='' as $$
declare op text:='discovery:'||p_account||':'||p_revision||':'||p_page;
begin
 if not public.icash_discovery_filter_plan_valid(p_plan) then return false;end if;
 -- The original admission function retains every budget, permission and scope gate.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_discovery_configs where account_id=p_account for update;
 if not exists(select 1 from public.icash_discovery_filter_settings where id=1 and enabled)
 or exists(select 1 from public.icash_discovery_filter_pages where operation_key=op) then return false;end if;
 perform 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=p_revision and zip=p_zip
 and strategy=p_plan->>'strategy' and next_page=(p_plan->>'providerPage')::integer and not exhausted for update;
 if not found then return false;end if;
 if not public.icash_reserve_and_claim_property_discovery(p_account,p_zip,p_revision,p_page,p_per_page,p_rate,p_unit,p_permission_until,p_setup_revision,p_market_mode,p_market) then return false;end if;
 insert into public.icash_discovery_filter_pages(operation_key,account_id,revision,sequence,zip,plan,state) values(op,p_account,p_revision,p_page,p_zip,p_plan,'claimed');
 return true;
end $$;

create function public.icash_save_filtered_discovery(p_account uuid,p_operation text,p_revision uuid,p_page integer,p_result jsonb)
returns integer language plpgsql set search_path='' as $$
declare page public.icash_discovery_filter_pages;n integer;saved jsonb;
begin
 perform 1 from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update;
 if not found then raise exception 'Filter operation required';end if;
 select * into page from public.icash_discovery_filter_pages where operation_key=p_operation and account_id=p_account for update;
 if not found or page.revision<>p_revision or page.sequence<>p_page or page.plan is distinct from p_result->'filterPlan' then raise exception 'Filter receipt scope changed';end if;
 if page.state='complete' then
  select result into saved from public.icash_discovery_results where operation_key=p_operation and account_id=p_account;
  if saved is distinct from p_result then raise exception 'Filter result conflict';end if;
  return (select count(*)::integer from public.icash_discovery_filter_attribution where operation_key=p_operation and account_id=p_account);
 end if;
 if page.state<>'claimed' then raise exception 'Filter claim required';end if;
 n:=public.icash_save_discovery(p_account,p_operation,p_revision,p_page,p_result);
 insert into public.icash_discovery_filter_attribution(screening_id,account_id,operation_key)
 select s.id,s.account_id,p_operation from public.icash_screening_jobs s
 where s.account_id=p_account and s.event_key=p_operation||':'||(s.snapshot->>'propertyId') on conflict do nothing;
 update public.icash_discovery_filter_cursors set next_page=next_page+1,pages=pages+1,exhausted=not coalesce((p_result->>'hasNextPage')::boolean,false)
 where account_id=p_account and revision=p_revision and strategy=page.plan->>'strategy';
 update public.icash_discovery_filter_pages set state='complete',completed_at=now() where operation_key=p_operation;
 update public.icash_discovery_configs set exhausted=not exists(select 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=p_revision and not exhausted)
 where account_id=p_account and revision=p_revision;
 return n;
end $$;

create function public.icash_finish_empty_filter(p_account uuid,p_revision uuid,p_page integer,p_plan jsonb,p_reason text) returns boolean language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;op text:='discovery:'||p_account||':'||p_revision||':'||p_page;
begin
 if not public.icash_discovery_filter_plan_valid(p_plan) or p_reason not in ('empty','unavailable') or p_reason is null
 or (p_reason='unavailable' and p_plan->>'strategy'='baseline') then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision<>p_revision or c.next_page<>p_page
 or exists(select 1 from public.icash_operation_spend where operation_key=op)
 or exists(select 1 from public.icash_discovery_filter_pages where operation_key=op) then return false;end if;
 perform 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=p_revision and zip=c.zip
 and strategy=p_plan->>'strategy' and next_page=(p_plan->>'providerPage')::integer and not exhausted for update;
 if not found then return false;end if;
 insert into public.icash_discovery_filter_pages(operation_key,account_id,revision,sequence,zip,plan,state,completed_at) values(op,p_account,p_revision,p_page,c.zip,p_plan,p_reason,now());
 update public.icash_discovery_filter_cursors set exhausted=true,pages=pages+1 where account_id=p_account and revision=p_revision and strategy=p_plan->>'strategy';
 if not exists(select 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=p_revision and not exhausted) then
  perform public.icash_mark_inventory_empty(p_account,p_revision,p_page);
 else update public.icash_discovery_configs set next_page=next_page+1 where account_id=p_account and revision=p_revision;
 end if;
 return true;
end $$;

-- A completed free preview with no likely owner must free research capacity.
-- It is neither a seller response nor a paid enrichment receipt.
create or replace function public.icash_pending_opportunity_count(p_account uuid) returns integer language sql stable set search_path='' as $$
 select count(*)::integer from public.icash_screening_jobs s
 left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.created_at>now()-interval '24 hours'
 and (s.state in ('queued','running') or (s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
  and not coalesce(o.attempted,false) and not coalesce(o.responded,false) and not coalesce(o.opted_out,false)
  and not exists(select 1 from public.icash_automation_tickets t where t.account_id=s.account_id and t.screening_id=s.id and t.kind='contacts' and t.state='complete' and t.outcome='empty')
  and not exists(select 1 from public.icash_property_controls c where c.account_id=s.account_id and c.property_id=s.snapshot->>'propertyId' and c.manual)
  and not exists(select 1 from public.icash_owner_contacts c where c.account_id=s.account_id and c.screening_id=s.id and not exists(select 1 from jsonb_array_elements(coalesce(c.result->'contacts','[]'::jsonb)) person
  cross join lateral jsonb_array_elements(coalesce(person->'phones','[]'::jsonb)) phone
  where person->'likelyOwner'='true'::jsonb and phone->'doNotCall' is distinct from 'true'::jsonb and length(coalesce(phone->>'number',''))>0))
  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in ('closed','cancelled','cancellation_pending','under_contract','purchase_signed','buyer_selected','assigned','title_open','closing'))));
$$;

revoke all on function public.icash_discovery_filter_plan_valid(jsonb),public.icash_filter_sms_interest(uuid,uuid),public.icash_discovery_filter_stats(uuid,text),public.icash_discovery_filter_state(uuid,uuid,integer),public.icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb),public.icash_save_filtered_discovery(uuid,text,uuid,integer,jsonb),public.icash_finish_empty_filter(uuid,uuid,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_discovery_filter_plan_valid(jsonb),public.icash_filter_sms_interest(uuid,uuid),public.icash_discovery_filter_stats(uuid,text),public.icash_discovery_filter_state(uuid,uuid,integer),public.icash_reserve_and_claim_filtered_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text,jsonb),public.icash_save_filtered_discovery(uuid,text,uuid,integer,jsonb),public.icash_finish_empty_filter(uuid,uuid,integer,jsonb,text) to service_role;
commit;
