-- Seller work repair: prioritize real contact activity, protect first-outreach
-- capacity, and report verified progress. No sends, credits or receipts are created.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $preflight$ begin
 if md5(pg_get_functiondef('public.icash_prospecting_progress'::regproc))<>'5a1e99c74c26a2bb18d67862b602a008' then raise exception 'Concurrent change to icash_prospecting_progress';end if;
 if md5(pg_get_functiondef('public.icash_workspace_ready_opportunities'::regproc))<>'1b957a993645986a49908f616fbc4918' then raise exception 'Concurrent change to icash_workspace_ready_opportunities';end if;
 if md5(pg_get_functiondef('public.icash_workspace_opportunities'::regproc))<>'661c422f2f38cd2d154d479704b93dcf' then raise exception 'Concurrent change to icash_workspace_opportunities';end if;
 if md5(pg_get_functiondef('public.icash_guard_prospecting_spend'::regproc))<>'06c5cd90e83de3eaa7ae68777646c062' then raise exception 'Concurrent change to icash_guard_prospecting_spend';end if;
 if md5(pg_get_functiondef('public.icash_outbound_search_due'::regproc))<>'a90558251ba339c38c7fdfc056ed8c0a' then raise exception 'Concurrent change to icash_outbound_search_due';end if;
 if md5(pg_get_functiondef('public.icash_enrichment_candidate'::regproc))<>'7b68ffd147c437859f29ac35e98b686a' then raise exception 'Concurrent change to icash_enrichment_candidate';end if;
 if md5(pg_get_functiondef('public.icash_resume_prospecting_ticket'::regproc))<>'f577d15ddedebb7989014bc0efd2ba11' then raise exception 'Concurrent change to icash_resume_prospecting_ticket';end if;
end $preflight$;


create or replace function public.icash_property_contact_priority(p_account uuid,p_screening uuid) returns integer
language sql stable security invoker set search_path='' as $$
 select case when exists(select 1 from public.icash_deal_files d
  join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.account_id=p_account and d.screening_id=p_screening and m.provider_id is not null
   and m.direction='outgoing' and m.state in ('accepted','delivered'))
  or exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets p
   on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
   where j.account_id=p_account and p.screening_id=p_screening and p.party='seller' and j.provider_call_sid is not null) then 2
 when exists(select 1 from public.icash_owner_contacts c
  cross join lateral jsonb_array_elements(coalesce(c.result->'contacts','[]'::jsonb)) person
  where c.account_id=p_account and c.screening_id=p_screening
   and (nullif(trim(person->>'name'),'') is not null or jsonb_array_length(coalesce(person->'phones','[]'::jsonb))>0))
  or exists(select 1 from public.icash_seller_matches m where m.account_id=p_account and m.screening_id=p_screening) then 1 else 0 end;
$$;

-- Queue priority only; this does not authorize a call or change any contact gate.
-- A single actual call attempt releases this research priority for that property.
create or replace function public.icash_research_waiting_on_outreach(p_account uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select (public.icash_outreach_voice_current(p_account) and exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
  join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id
  where j.account_id=p_account and p.party='seller' and s.state='complete'
   and s.snapshot->'sellerRequest' is null and s.result->'financialCheck'->>'status'='eligible'
   and (j.state in ('ready','issued') or (j.state='held' and j.outcome='prospecting_budget_held'))
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null
   and j.provider_call_sid is null and j.conversation_id is null and j.operation_key is null
   and p.revoked_at is null and p.permission_until>now() and p.dnc_clear
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=p.phone)
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=p.contact_key)
   and not exists(select 1 from public.icash_property_controls x where x.account_id=s.account_id and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and not exists(select 1 from public.icash_voice_jobs prior join public.icash_voice_contact_targets pp
    on pp.id=coalesce(prior.permission_id,prior.operational_contact_id) and pp.account_id=prior.account_id
    where prior.account_id=j.account_id and pp.screening_id=p.screening_id and pp.party='seller'
     and (prior.provider_call_sid is not null or prior.conversation_id is not null))
 )) or (public.icash_outreach_sms_current(p_account) and exists(
  select 1 from public.icash_text_threads t
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where t.account_id=p_account and t.party='seller' and not t.paused and not t.manual_only and t.retired_at is null
   and s.state='complete' and s.snapshot->'sellerRequest' is null and s.result->'financialCheck'->>'status'='eligible'
   and coalesce(t.eligibility_until,t.permission_until)>now() and m.direction='outgoing' and m.state='ready'
   and m.customer_author_id is null and m.provider_id is null and m.last_delivery_at is null
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
   and not exists(select 1 from public.icash_property_controls x where x.account_id=s.account_id and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and not exists(select 1 from public.icash_text_messages prior where prior.account_id=t.account_id and prior.thread_id=t.id and prior.provider_id is not null)
 ));
$$;

-- Match the existing two-minute first-call quote, including its current VIP
-- discount and buffer. This is capacity left unspent, never a wallet debit.
create or replace function public.icash_prospecting_outreach_floor(p_account uuid) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare r public.icash_operation_rates;b public.icash_operating_budget;parts jsonb;total numeric;
begin
 if not public.icash_outreach_voice_current(p_account) then return 0;end if;
 select rate.* into r from public.icash_voice_configs c join public.icash_operation_rates rate on rate.id=c.seller_rate_id
  where c.account_id=p_account and c.enabled and c.reviewed_until>now() and rate.enabled
   and rate.verified_at<=now() and rate.expires_at>now() and rate.operation='seller_call'
   and rate.voice_max_duration_seconds=600 and rate.charge_cents=977 and rate.version like 'required-audio-30d-speech-v1:%';
 if not found then return 0;end if;
 select * into b from public.icash_operating_budget where id=1;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.7;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.7;end if;
 parts:=public.icash_voice_bounded_costs(r.costs_micros,120);
 select sum(value::numeric) into total from jsonb_each_text(parts);
 return greatest(0,ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000))::bigint;
end $$;

create or replace function public.icash_research_admission_quote(p_account uuid,p_kind text,p_price bigint) returns bigint
language sql stable security invoker set search_path='' as $$
 select p_price+public.icash_prospecting_outreach_floor(p_account)
  +case when p_kind='property_search' then coalesce((select r.charge_cents from public.icash_discovery_configs c
   join public.icash_operation_rates r on r.id=c.contact_rate_id where c.account_id=p_account and c.contacts_enabled
    and r.enabled and r.expires_at>now() and r.operation='owner_enrichment'),0) else 0 end;
$$;

create or replace function public.icash_outbound_search_due(p_account uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select public.icash_prospecting_available(p_account)>=public.icash_research_admission_quote(p_account,'property_search',r.charge_cents)
  and not public.icash_research_waiting_on_outreach(p_account)
  and (not c.contacts_enabled or public.icash_enrichment_before_prospecting_budget(p_account) is null)
  and public.icash_search_due_before_prospecting_budget(p_account)
 from public.icash_discovery_configs c join public.icash_operation_rates r on r.id=c.rate_id where c.account_id=p_account;
$$;

create or replace function public.icash_enrichment_candidate(p_account uuid) returns uuid
language sql stable security invoker set search_path='' as $$
 select public.icash_enrichment_before_prospecting_budget(p_account) from public.icash_discovery_configs c
 join public.icash_operation_rates r on r.id=c.contact_rate_id where c.account_id=p_account
  and not public.icash_research_waiting_on_outreach(p_account)
  and public.icash_prospecting_available(p_account)>=public.icash_research_admission_quote(p_account,'owner_enrichment',r.charge_cents);
$$;

create or replace function public.icash_guard_prospecting_spend() returns trigger
language plpgsql set search_path='' as $$
declare kind text;required bigint;
begin
 if not public.icash_new_prospect_operation(new.account_id,new.operation_key,new.rate_id) then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select operation into kind from public.icash_operation_rates where id=new.rate_id;
 required:=new.charge_cap_cents;
 if kind in ('property_search','owner_enrichment') then
  required:=public.icash_research_admission_quote(new.account_id,kind,required);
  if public.icash_research_waiting_on_outreach(new.account_id) then
   raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;
  end if;
 elsif kind in ('sms_send','mms_send') and public.icash_research_waiting_on_outreach(new.account_id) then
  required:=required+public.icash_prospecting_outreach_floor(new.account_id);
 end if;
 if public.icash_prospecting_available(new.account_id)<required then
  raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;
 end if;
 select id into new.prospecting_budget_id from public.icash_prospecting_budgets where account_id=new.account_id order by id desc limit 1;
 if new.prospecting_budget_id is null then raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',required)::text;end if;
 return new;
end $$;

create or replace function public.icash_support_outreach_diagnostics(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with properties as (select s.* from public.icash_screening_jobs s where s.account_id=p_account and s.state<>'archived'
  and coalesce(s.snapshot->>'practice','false')<>'true'),
 contacts as (select c.* from public.icash_owner_contacts c join properties s on s.id=c.screening_id and s.account_id=c.account_id where s.state='complete'),
 messages as (select m.* from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.party='seller'
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join properties s on s.id=d.screening_id and s.account_id=d.account_id where m.account_id=p_account),
 calls as (select j.* from public.icash_voice_jobs j join public.icash_voice_contact_targets p
  on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id and p.party='seller'
  join properties s on s.id=p.screening_id and s.account_id=p.account_id where j.account_id=p_account)
 select jsonb_build_object(
  'screened',(select count(*) from properties where state='complete'),
  'outboundProperties',(select count(*) from properties where state='complete' and snapshot->'sellerRequest' is null),
  'inboundProperties',(select count(*) from properties where state='complete' and snapshot->'sellerRequest' is not null),
  'contactProperties',(select count(*) from contacts where jsonb_array_length(coalesce(result->'contacts','[]'::jsonb))>0),
  'textsSent',(select count(*) from messages where direction='outgoing' and provider_id is not null and state in ('accepted','delivered')),
  'textsDelivered',(select count(*) from messages where direction='outgoing' and provider_id is not null and state='delivered'),
  'textReplies',(select count(*) from messages where direction='incoming' and state='received' and (provider_id is not null or event_id is not null)),
  'callsStarted',(select count(*) from calls where provider_call_sid is not null),
  'callsBudgetHeld',(select count(*) from calls where state='held' and outcome='prospecting_budget_held' and provider_call_sid is null and conversation_id is null),
  'progress',public.icash_prospecting_progress(p_account));
$$;

-- Resume only proven-unstarted work; contact lookup waits behind queued outreach.
CREATE OR REPLACE FUNCTION public.icash_resume_prospecting_ticket()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_automation_tickets;op text;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 for t in select x.* from public.icash_automation_tickets x join public.icash_accounts a on a.id=x.account_id
  where x.state='held' and x.outcome='prospecting_budget_held' and x.expires_at<=now() and not a.bot_paused
  and public.icash_membership_work_allowed(a.id) and public.icash_prospecting_available(a.id)>=x.prospecting_quote_cents
  and (x.kind not in ('contacts','discovery') or not public.icash_research_waiting_on_outreach(x.account_id))
  order by x.created_at limit 20 for update of x skip locked loop
  op:=null;
  if t.kind='contacts' then op:='owners:'||t.account_id||':'||t.screening_id;
  elsif t.kind='voice_dispatch' then
   op:='voice:'||t.voice_job_id;
   if not exists(select 1 from public.icash_voice_jobs where id=t.voice_job_id and account_id=t.account_id and state='held' and outcome='prospecting_budget_held' and operation_key is null and conversation_id is null and provider_call_sid is null) then continue;end if;
  elsif t.kind in ('seller_opener','seller_recovery') then
   op:='text:'||t.opener_message_id;
   if not exists(select 1 from public.icash_text_messages where id=t.opener_message_id and account_id=t.account_id and state='ready' and provider_id is null and last_delivery_at is null) then continue;end if;
  elsif t.kind='discovery' then
   -- A discovery page can move independently. Its scheduler handles the current
   -- revision; do not replay a stale page capability.
   update public.icash_automation_tickets set outcome='prospecting_budget_released' where id=t.id;
   perform public.icash_wake_funded_outreach(t.account_id);continue;
  end if;
  if op is null or exists(select 1 from public.icash_operation_spend where operation_key=op) or exists(select 1 from public.icash_live_conversations where operation_key=op) then continue;end if;
  if exists(select 1 from public.icash_automation_tickets x where x.id<>t.id and x.account_id=t.account_id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes'))) then continue;end if;
  if t.kind='voice_dispatch' then update public.icash_voice_jobs set state='issued',outcome=null,updated_at=now() where id=t.voice_job_id;end if;
  update public.icash_automation_tickets set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=now()+interval '2 minutes' where id=t.id returning * into t;
  return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$
;



-- BEGIN icash_prospecting_progress
CREATE OR REPLACE FUNCTION public.icash_prospecting_progress(p_account uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare b public.icash_prospecting_budgets;remaining bigint;total_remaining bigint;minimum bigint;spent bigint;pending bigint;queued bigint;screened bigint;eligible bigint;attempted bigint;responded bigint;active boolean;paused boolean;
begin
 select * into b from public.icash_prospecting_budgets where account_id=p_account order by id desc limit 1;
 if not found then return null;end if;
 remaining:=public.icash_prospecting_available(p_account);
 total_remaining:=public.icash_prospecting_total_available(p_account);
 select least(search.charge_cents,contacts.charge_cents) into minimum from public.icash_discovery_configs c join public.icash_operation_rates search on search.id=c.rate_id left join public.icash_operation_rates contacts on contacts.id=c.contact_rate_id where c.account_id=p_account;
 select coalesce(sum(charged_cents) filter(where state='settled'),0),coalesce(sum(charge_cap_cents) filter(where state in ('reserved','dispatched')),0) into spent,pending from public.icash_operation_spend where account_id=p_account and prospecting_budget_id=b.id;
 select bot_paused into paused from public.icash_accounts where id=p_account;
 select count(*) filter(where s.state in ('queued','running')),count(*) filter(where s.state='complete'),count(*) filter(where s.state='complete' and s.result->'financialCheck'->>'status'='eligible')
  into queued,screened,eligible from public.icash_screening_jobs s where s.account_id=p_account and s.created_at>=b.created_at and s.state<>'archived';
 select count(*) filter(where o.attempted),count(*) filter(where o.responded and not o.opted_out) into attempted,responded
  from public.icash_opportunity_outcomes o where o.account_id=p_account and o.discovered_at>=b.created_at;
 active:=exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind in ('discovery','contacts','voice_dispatch','seller_opener') and state='consumed' and created_at>now()-interval '2 minutes') or queued>0;
 return jsonb_build_object('budgetId',b.id,'startedAt',b.created_at,'limitCents',b.limit_cents,'pacingHours',12,'dailyPercent',50,'dailyLimitCents',b.limit_cents,'batchHours',1,'hourlyLimitCents',least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0))),'releasedCents',public.icash_prospecting_released(b.baseline_cents,b.created_at),'spentCents',spent,'pendingCents',pending,'remainingCents',remaining,
  'callsBudgetHeld',(select count(*) from public.icash_voice_jobs where account_id=p_account and state='held' and outcome='prospecting_budget_held' and provider_call_sid is null and conversation_id is null),'queued',queued,'screened',screened,'eligible',eligible,'contacted',attempted,'responded',responded,
  'status',case when paused then 'paused' when not public.icash_membership_work_allowed(p_account) then 'membership_required'
   when remaining<coalesce(minimum,1) and pending>0 then 'settling' when remaining<coalesce(minimum,1) and total_remaining>=coalesce(minimum,1) then 'paced' when remaining<coalesce(minimum,1) then 'budget_reached' when active then 'working'
   when exists(select 1 from public.icash_discovery_configs where account_id=p_account and enabled and auto_enabled and data_rights_until>now()) then 'ready' else 'waiting' end);
end $function$
;
-- END icash_prospecting_progress

-- BEGIN icash_workspace_ready_opportunities
CREATE OR REPLACE FUNCTION public.icash_workspace_ready_opportunities(p_account uuid, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7)
 RETURNS TABLE(id uuid, state text, result jsonb, completed_at timestamp with time zone, engagement jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id,s.state,s.result,s.completed_at,
  jsonb_build_object('responded',coalesce(o.responded,false),'interested',coalesce(o.interested,false),'optedOut',coalesce(o.opted_out,false))
 from public.icash_screening_jobs s
 left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state='complete' and coalesce(s.snapshot->>'practice','false')<>'true'
  and (coalesce(o.responded,false) or coalesce(o.purchase_signed,false) or (
   s.result->'financialCheck'->>'status'='eligible' and s.snapshot->>'propertyType'='house'
   and not coalesce(o.opted_out,false)
   and s.snapshot->>'propertyId'=s.result->'property'->>'propertyId'
   and (public.icash_property_contact_priority(p_account,s.id)>0 or (s.completed_at between now()-interval '24 hours' and now()
   and case when pg_catalog.pg_input_is_valid(s.snapshot->>'fetchedAt','timestamp with time zone')
    then (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '24 hours' and now() else false end))))
  and (p_query='' or position(lower(p_query) in lower(s.result->'property'->>'address'))>0)
 order by coalesce(o.purchase_signed,false) desc,coalesce(o.interested and not o.opted_out,false) desc,
  coalesce(o.responded,false) desc,o.response_at desc nulls last,public.icash_property_contact_priority(p_account,s.id) desc,s.created_at desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$function$
;
-- END icash_workspace_ready_opportunities

-- BEGIN icash_workspace_opportunities
CREATE OR REPLACE FUNCTION public.icash_workspace_opportunities(p_account uuid, p_query text DEFAULT ''::text, p_offset integer DEFAULT 0, p_limit integer DEFAULT 7, p_responses_only boolean DEFAULT false)
 RETURNS TABLE(id uuid, state text, result jsonb, completed_at timestamp with time zone, engagement jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id,s.state,s.result,s.completed_at,jsonb_build_object('responded',coalesce(o.responded,false),'interested',coalesce(o.interested,false),'optedOut',coalesce(o.opted_out,false)) from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.state='complete'
  and (not p_responses_only or coalesce(o.responded,false) or coalesce(o.purchase_signed,false))
  and (p_query='' or position(lower(p_query) in lower(s.result->'property'->>'address'))>0)
 order by coalesce(o.purchase_signed,false) desc,coalesce(o.interested and not o.opted_out,false) desc,coalesce(o.responded,false) desc,o.response_at desc nulls last,public.icash_property_contact_priority(p_account,s.id) desc,s.created_at desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$function$
;
-- END icash_workspace_opportunities



revoke all on function public.icash_property_contact_priority(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_property_contact_priority(uuid,uuid) to service_role;

revoke all on function public.icash_research_waiting_on_outreach(uuid) from public,anon,authenticated;
grant execute on function public.icash_research_waiting_on_outreach(uuid) to service_role;

revoke all on function public.icash_prospecting_outreach_floor(uuid) from public,anon,authenticated;
grant execute on function public.icash_prospecting_outreach_floor(uuid) to service_role;

revoke all on function public.icash_research_admission_quote(uuid,text,bigint) from public,anon,authenticated;
grant execute on function public.icash_research_admission_quote(uuid,text,bigint) to service_role;

revoke all on function public.icash_support_outreach_diagnostics(uuid) from public,anon,authenticated;
grant execute on function public.icash_support_outreach_diagnostics(uuid) to service_role;

revoke all on function public.icash_outbound_search_due(uuid) from public,anon,authenticated;
grant execute on function public.icash_outbound_search_due(uuid) to service_role;

revoke all on function public.icash_enrichment_candidate(uuid) from public,anon,authenticated;
grant execute on function public.icash_enrichment_candidate(uuid) to service_role;

revoke all on function public.icash_guard_prospecting_spend() from public,anon,authenticated;
grant execute on function public.icash_guard_prospecting_spend() to service_role;

revoke all on function public.icash_workspace_ready_opportunities(uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.icash_workspace_ready_opportunities(uuid,text,integer,integer) to service_role;

revoke all on function public.icash_workspace_opportunities(uuid,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.icash_workspace_opportunities(uuid,text,integer,integer,boolean) to service_role;



revoke all on function public.icash_prospecting_progress(uuid) from public,anon,authenticated;
grant execute on function public.icash_prospecting_progress(uuid) to service_role;

commit;
