-- Private outcome facts are rebuilt from saved provider receipts, messages and
-- signatures. No generated lead labels, fabricated interest or shared contact data.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.icash_opportunity_outcomes(
 screening_id uuid primary key references public.icash_screening_jobs(id),
 account_id uuid not null references public.icash_accounts(id),
 zip text, eligible boolean not null, discovered_at timestamptz not null,
 attempted boolean not null default false, responded boolean not null default false,
 interested boolean not null default false, opted_out boolean not null default false,
 purchase_signed boolean not null default false, response_at timestamptz,
 provider_cost_micros bigint not null default 0, costs_complete boolean not null default false,
 research_source boolean not null, refreshed_at timestamptz not null default now()
);
create index icash_opportunity_outcomes_account on public.icash_opportunity_outcomes(account_id,responded desc,response_at desc);
create index icash_opportunity_outcomes_market on public.icash_opportunity_outcomes(account_id,zip,discovered_at);
create table public.icash_opportunity_refreshes(account_id uuid primary key references public.icash_accounts(id),refreshed_at timestamptz not null);
alter table public.icash_opportunity_outcomes enable row level security;
alter table public.icash_opportunity_refreshes enable row level security;
revoke all on public.icash_opportunity_outcomes,public.icash_opportunity_refreshes from public,anon,authenticated;
grant all on public.icash_opportunity_outcomes,public.icash_opportunity_refreshes to service_role;

create function public.icash_call_has_seller_response(p_result jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
  where t->>'role'='user' and length(trim(coalesce(t->>'message','')))>0
  and t->>'message' !~* '(leave (a |your )?message|after the (beep|tone)|mailbox|not available|voicemail|has been disconnected|number you (have )?dialed|press [0-9]|automated (voice|system))');
$$;

create function public.icash_refresh_opportunity_outcomes(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare last_refresh timestamptz;
begin
 if p_account is null or not pg_try_advisory_xact_lock(hashtextextended(p_account::text,7319)) then return;end if;
 select refreshed_at into last_refresh from public.icash_opportunity_refreshes where account_id=p_account;
 if last_refresh>now()-interval '20 seconds' then return;end if;
 last_refresh:=coalesce(last_refresh,'-infinity'::timestamptz);
 -- Recompute changed properties only. A growing history must not make every
 -- workspace refresh rescan all transcripts and messages.
 with changed as (
  select s.id from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
   where s.account_id=p_account and s.state='complete' and (o.screening_id is null or s.completed_at>=last_refresh)
  union select c.screening_id from public.icash_live_conversations c left join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
   where c.account_id=p_account and (c.created_at>=last_refresh or c.completed_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id
   join public.icash_text_messages m on m.account_id=t.account_id and m.thread_id=t.id
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
   where d.account_id=p_account and (m.updated_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id
   where d.account_id=p_account and e.updated_at>=last_refresh
  union select c.screening_id from public.icash_owner_contacts c join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
   where c.account_id=p_account and (c.created_at>=last_refresh or o.settled_at>=last_refresh)
 )
 insert into public.icash_opportunity_outcomes(screening_id,account_id,zip,eligible,discovered_at,attempted,responded,interested,opted_out,purchase_signed,response_at,provider_cost_micros,costs_complete,research_source)
 select s.id,s.account_id,left(s.snapshot->'raw'->'data'->>'zip',5),coalesce(s.result->'financialCheck'->>'status'='eligible',false),s.created_at,
  coalesce(v.attempted,false) or coalesce(t.attempted,false),coalesce(v.responded,false) or coalesce(t.responded,false),coalesce(v.interested,false),coalesce(v.opted_out,false) or coalesce(t.opted_out,false),coalesce(sig.signed,false),greatest(v.response_at,t.response_at),coalesce(cost.total,0),coalesce(cost.complete,false),s.event_key like 'discovery:%'
 from public.icash_screening_jobs s join changed on changed.id=s.id
 left join lateral (
  select count(*)>0 attempted,bool_or(c.state='complete' and public.icash_call_has_seller_response(c.result)) responded,
   bool_or(c.state='complete' and c.result->'interested'='true'::jsonb and public.icash_call_has_seller_response(c.result)) interested,
   bool_or(c.result->'optedOut'='true'::jsonb) opted_out,
   max(c.completed_at) filter(where c.state='complete' and public.icash_call_has_seller_response(c.result)) response_at
  from public.icash_live_conversations c where c.account_id=s.account_id and c.screening_id=s.id and c.party='seller' and c.conversation_id is not null
 ) v on true
 left join lateral (
  select bool_or(m.direction='outgoing' and m.provider_id is not null and m.state in ('accepted','delivered')) attempted,
   bool_or(m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) responded,
   bool_or(m.direction='incoming' and m.state='received' and public.icash_seller_contact_stop(m.body)) opted_out,
   max(m.created_at) filter(where m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) response_at
  from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.screening_id=s.id and d.account_id=s.account_id
 ) t on true
 left join lateral (
  select bool_or(e.state='completed' and not e.test_mode) signed from public.icash_deal_files d
  join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id and e.kind='purchase'
  where d.screening_id=s.id and d.account_id=s.account_id
 ) sig on true
 left join lateral (
  select sum(o.actual_micros) filter(where o.state='settled')::bigint total,bool_and(o.state='settled') complete
  from public.icash_operation_spend o where o.account_id=s.account_id and (
   o.operation_key='owners:'||s.account_id||':'||s.id or o.operation_key in
   (select c.operation_key from public.icash_live_conversations c where c.account_id=s.account_id and c.screening_id=s.id)
   or o.operation_key in (select 'text:'||m.id from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where d.account_id=s.account_id and d.screening_id=s.id))
 ) cost on true
 where s.account_id=p_account and s.state='complete'
  and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
 on conflict(screening_id) do update set eligible=excluded.eligible,attempted=excluded.attempted,responded=excluded.responded,interested=excluded.interested,opted_out=excluded.opted_out,purchase_signed=excluded.purchase_signed,response_at=excluded.response_at,provider_cost_micros=excluded.provider_cost_micros,costs_complete=excluded.costs_complete,refreshed_at=now();
 insert into public.icash_opportunity_refreshes values(p_account,now()) on conflict(account_id) do update set refreshed_at=excluded.refreshed_at;
end $$;

-- Bayesian smoothing and a small maximum influence avoid treating a handful
-- of replies as proof of a winning market. Only this account's facts are used.
create function public.icash_opportunity_market_score(p_account uuid,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select case when count(*)<20 then 0 else
  0.25*(count(*) filter(where eligible)+2.0)/(count(*)+4.0)
  +0.25*(count(*) filter(where responded and not opted_out)+1.0)/(count(*) filter(where attempted)+5.0)
  +0.35*(count(*) filter(where interested and not opted_out)+0.5)/(count(*) filter(where attempted)+5.0)
  +0.15*(count(*) filter(where purchase_signed)+0.25)/(count(*) filter(where attempted)+5.0)
  -least(0.5,count(*) filter(where opted_out)::numeric/greatest(1,count(*) filter(where attempted))) end
 from public.icash_opportunity_outcomes where account_id=p_account and zip=p_zip and research_source and discovered_at between now()-interval '90 days' and now()-interval '1 day';
$$;
create function public.icash_opportunity_score(p_account uuid,p_result jsonb,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select case when p_result->'financialCheck'->>'status'='eligible' then
  0.75*greatest(0,least(1,(coalesce((p_result->>'preliminarySellerCeilingCents')::numeric,0)-coalesce((p_result->'property'->'financialScreening'->>'estimatedLoanBalanceCents')::numeric,0))/greatest(1,coalesce((p_result->>'preliminarySellerCeilingCents')::numeric,0))))
  +0.25*public.icash_opportunity_market_score(p_account,p_zip) else -1 end;
$$;

-- Apply response ordering before pagination so replies never get buried by volume.
create function public.icash_workspace_opportunities(p_account uuid,p_query text default '',p_offset integer default 0,p_limit integer default 7,p_responses_only boolean default false)
returns table(id uuid,state text,result jsonb,completed_at timestamptz,engagement jsonb) language sql stable security invoker set search_path='' as $$
 select s.id,s.state,s.result,s.completed_at,jsonb_build_object('responded',coalesce(o.responded,false),'interested',coalesce(o.interested,false),'optedOut',coalesce(o.opted_out,false)) from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state='complete'
  and (not p_responses_only or coalesce(o.responded,false) or coalesce(o.purchase_signed,false))
  and (p_query='' or position(lower(p_query) in lower(s.result->'property'->>'address'))>0)
 order by coalesce(o.purchase_signed,false) desc,coalesce(o.interested and not o.opted_out,false) desc,coalesce(o.responded,false) desc,o.response_at desc nulls last,s.created_at desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$$;
create function public.icash_workspace_response_counts(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('responded',count(*) filter(where coalesce(o.responded,false) or coalesce(o.purchase_signed,false) or exists(select 1 from public.icash_meta_leads m where m.screening_id=s.id and m.account_id=s.account_id and m.response_at is not null)),'total',count(*))
 from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state in ('complete','awaiting_address');
$$;

create function public.icash_wake_funded_outreach(p_account uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id where a.id=p_account and not a.bot_paused and w.balance_cents>0)
  or not public.icash_membership_work_allowed(p_account) then return false;end if;
 update public.icash_discovery_configs set next_run_at=least(next_run_at,now()-interval '1 minute') where account_id=p_account and enabled and auto_enabled;
 return found;
end $$;
create function public.icash_wake_on_credit_increase() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.balance_cents>old.balance_cents and new.balance_cents>0 then perform public.icash_wake_funded_outreach(new.account_id);end if;
 return new;
end $$;
create trigger icash_wake_outreach_on_funding after update of balance_cents on public.icash_wallets for each row execute function public.icash_wake_on_credit_increase();

revoke all on function public.icash_call_has_seller_response(jsonb),public.icash_refresh_opportunity_outcomes(uuid),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_workspace_opportunities(uuid,text,integer,integer,boolean),public.icash_workspace_response_counts(uuid),public.icash_wake_funded_outreach(uuid),public.icash_wake_on_credit_increase() from public,anon,authenticated;
grant execute on function public.icash_call_has_seller_response(jsonb),public.icash_refresh_opportunity_outcomes(uuid),public.icash_opportunity_market_score(uuid,text),public.icash_opportunity_score(uuid,jsonb,text),public.icash_workspace_opportunities(uuid,text,integer,integer,boolean),public.icash_workspace_response_counts(uuid),public.icash_wake_funded_outreach(uuid),public.icash_wake_on_credit_increase() to service_role;
commit;
