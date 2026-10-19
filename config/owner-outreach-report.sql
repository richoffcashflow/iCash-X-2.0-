-- Owner-only, read-only reporting. Never prepares contacts, queues work, refreshes
-- outcomes, changes a balance, or contacts a provider.
begin;
create function public.icash_owner_outreach_report(
 p_actor uuid,p_days integer default 30,p_include_owner boolean default false,
 p_query text default '',p_page integer default 1,p_status text default 'all'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
 end_at timestamptz:=now();start_at timestamptz;result jsonb;
begin
 if p_actor is distinct from owner_id then raise exception 'Owner required' using errcode='42501';end if;
 if p_days is null or p_days not in (1,7,30) or p_include_owner is null
  or p_query is null or length(p_query)>100 or p_page is null or p_page not between 1 and 100000
  or p_status is null or p_status not in ('all','responded','interested','queued','held')
 then raise exception 'Invalid report filters';end if;
 start_at:=((end_at at time zone 'America/Chicago')::date-(p_days-1))::timestamp at time zone 'America/Chicago';
 with accounts as materialized (
  select a.id,a.bot_paused,coalesce(nullif(a.legal_name,''),nullif(a.assistant_name,''),'Customer account') label
  from public.icash_accounts a
  where (p_include_owner or a.owner_user_id<>owner_id)
   and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
    or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))
 ), screens as materialized (
  select s.id,s.account_id,s.state,s.created_at,s.completed_at,a.label,a.bot_paused,
   coalesce(nullif(s.result->'property'->>'address',''),nullif(s.snapshot->>'address',''),'Address pending') address,
   coalesce(s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
    and s.snapshot->>'propertyType'='house' and s.snapshot->>'propertyId'=s.result->'property'->>'propertyId',false) eligible
  from public.icash_screening_jobs s join accounts a on a.id=s.account_id
  where s.event_key like 'discovery:%' and s.snapshot->'sellerRequest' is null
   and coalesce(s.snapshot->>'practice','false')<>'true'
   and coalesce(s.snapshot->>'propertyId','') not like 'practice_%' and s.created_at<end_at
 ), voice as materialized (
  -- One row per job, even if a historical conversation has multiple projections.
  select distinct on (j.id) j.id,s.id screening_id,j.state,j.created_at,
   (nullif(j.provider_call_sid,'') is not null or nullif(r.call_sid,'') is not null or nullif(c.conversation_id,'') is not null) attempted,
   coalesce(r.dial_claimed_at,sp.dispatched_at,c.created_at) attempt_at,
   c.state='complete' and nullif(c.conversation_id,'') is not null as ai_complete,c.completed_at,
   c.state='complete' and nullif(c.conversation_id,'') is not null and public.icash_call_has_seller_response(c.result) responded,
   c.state='complete' and nullif(c.conversation_id,'') is not null and public.icash_call_has_seller_response(c.result)
    and c.result->'interested'='true'::jsonb and public.icash_seller_call_disposition(c.result) is null interested,
   nullif(c.conversation_id,'') is not null and (c.result->'optedOut'='true'::jsonb or public.icash_seller_call_disposition(c.result)='opt_out') opted_out,
   tr.receipt->>'status' terminal_status
  from public.icash_voice_jobs j
  left join public.icash_operational_contacts oc on oc.id=j.operational_contact_id and oc.account_id=j.account_id and oc.channel='voice'
  left join public.icash_contact_permissions cp on cp.id=j.permission_id and cp.account_id=j.account_id and cp.party='seller'
  join screens s on s.id=coalesce(oc.screening_id,cp.screening_id) and s.account_id=j.account_id
  left join public.icash_operation_spend sp on sp.account_id=j.account_id and sp.operation_key='voice:'||j.id
  left join public.icash_call_recordings r on r.voice_job_id=j.id and r.account_id=j.account_id
   and r.screening_id=s.id and r.operation_key='voice:'||j.id
  left join public.icash_live_conversations c on c.account_id=j.account_id and c.screening_id=s.id
   and c.operation_key='voice:'||j.id and c.party='seller' and c.contact_key=coalesce(oc.contact_key,cp.contact_key)
  left join public.icash_recorded_gate_terminal_receipts tr on tr.recording_id=r.id
   and tr.account_id=r.account_id and tr.call_sid=r.call_sid and tr.receipt->>'sid'=r.call_sid
  where j.created_at<end_at
  order by j.id,c.completed_at desc nulls last,c.id desc
 ), voice_stats as materialized (
  select screening_id,
   count(*) filter(where attempted and attempt_at>=start_at and attempt_at<end_at) calls,
   count(*) filter(where ai_complete and completed_at>=start_at and completed_at<end_at) conversations,
   count(*) filter(where responded and completed_at>=start_at and completed_at<end_at) responses,
   count(*) filter(where attempted and attempt_at>=start_at and attempt_at<end_at and terminal_status='no-answer') unanswered,
   count(*) filter(where attempted and attempt_at>=start_at and attempt_at<end_at and terminal_status='busy') busy,
   count(*) filter(where attempted and attempt_at>=start_at and attempt_at<end_at and terminal_status in ('failed','canceled')) failed,
   count(*) filter(where not attempted and state in ('ready','issued')) queued,
   count(*) filter(where not attempted and state='held') held,
   bool_or(responded and completed_at<end_at) responded,
   bool_or(interested and completed_at<end_at) interested,
   bool_or(opted_out and completed_at<end_at) opted_out,
   bool_or(responded and completed_at>=start_at and completed_at<end_at) response_in_period,
   bool_or(interested and completed_at>=start_at and completed_at<end_at) interest_in_period,
   max(greatest(created_at,case when attempted and attempt_at<end_at then attempt_at end,
    case when completed_at<end_at then completed_at end)) latest_at
  from voice group by screening_id
 ), texts as materialized (
  select m.id,s.id screening_id,m.state,m.direction,m.provider_id,m.event_id,m.created_at,m.last_delivery_at,
   coalesce(sp.dispatched_at,m.last_delivery_at) sent_at,
   m.direction='incoming' and m.state='received' and (nullif(m.provider_id,'') is not null or nullif(m.event_id,'') is not null) replied,
   m.direction='incoming' and m.state='received' and (nullif(m.provider_id,'') is not null or nullif(m.event_id,'') is not null)
    and public.icash_seller_contact_stop(m.body) opted_out
  from screens s join public.icash_deal_files d on d.screening_id=s.id and d.account_id=s.account_id
  join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  left join public.icash_operation_spend sp on sp.account_id=m.account_id and sp.operation_key='text:'||m.id
  where m.created_at<end_at
 ), text_stats as materialized (
  select screening_id,
   count(*) filter(where direction='outgoing' and nullif(provider_id,'') is not null and sent_at>=start_at and sent_at<end_at) accepted,
   count(*) filter(where direction='outgoing' and state='delivered' and nullif(provider_id,'') is not null
    and last_delivery_at>=start_at and last_delivery_at<end_at) delivered,
   count(*) filter(where replied and created_at>=start_at) replies,
   count(*) filter(where direction='outgoing' and provider_id is null and state='ready') queued,
   count(*) filter(where direction='outgoing' and provider_id is null and state='needs_review') held,
   bool_or(replied) responded,bool_or(opted_out) opted_out,
   bool_or(replied and created_at>=start_at) response_in_period,
   max(greatest(created_at,case when sent_at<end_at then sent_at end,case when last_delivery_at<end_at then last_delivery_at end)) latest_at
  from texts group by screening_id
 ), properties as materialized (
  select s.*,
   coalesce(v.calls,0) calls,coalesce(v.conversations,0) conversations,coalesce(v.responses,0) call_responses,
   coalesce(v.unanswered,0) unanswered,coalesce(v.busy,0) busy,coalesce(v.failed,0) failed,
   coalesce(v.queued,0) queued_calls,coalesce(v.held,0) held_calls,
   coalesce(t.accepted,0) texts_accepted,coalesce(t.delivered,0) texts_delivered,coalesce(t.replies,0) text_replies,
   coalesce(t.queued,0) queued_texts,coalesce(t.held,0) held_texts,
   coalesce(v.responded,false) or coalesce(t.responded,false) responded,
   coalesce(v.opted_out,false) or coalesce(t.opted_out,false) opted_out,
   coalesce(v.interested,false) and not(coalesce(v.opted_out,false) or coalesce(t.opted_out,false)) interested,
   coalesce(v.response_in_period,false) or coalesce(t.response_in_period,false) response_in_period,
   coalesce(v.interest_in_period,false) and not(coalesce(v.opted_out,false) or coalesce(t.opted_out,false)) interest_in_period,
   greatest(s.created_at,case when s.completed_at<end_at then s.completed_at end,v.latest_at,t.latest_at) latest_at
  from screens s left join voice_stats v on v.screening_id=s.id left join text_stats t on t.screening_id=s.id
 ), recent as materialized (
  select * from properties where latest_at>=start_at or queued_calls+queued_texts+held_calls+held_texts>0
 ), matching as materialized (
  select * from recent where (trim(p_query)='' or position(lower(trim(p_query)) in lower(address||' '||label||' '||account_id::text))>0)
   and case p_status when 'responded' then responded when 'interested' then interested
    when 'queued' then queued_calls+queued_texts>0 when 'held' then held_calls+held_texts>0 else true end
 ), page_rows as (
  select * from matching order by interested desc,responded desc,latest_at desc,id desc limit 25 offset (p_page-1)*25
 )
 select jsonb_build_object('days',p_days,'includeOwner',p_include_owner,'query',trim(p_query),'page',p_page,'status',p_status,
  'pageSize',25,'timezone','America/Chicago','startAt',start_at,'endAt',end_at,
  'matchedCount',(select count(*) from matching),
  'totals',(select jsonb_build_object(
   'researched',count(*) filter(where state='complete' and completed_at>=start_at and completed_at<end_at),
   'eligible',count(*) filter(where eligible and completed_at>=start_at and completed_at<end_at),
   'accounts',count(distinct account_id) filter(where calls+texts_accepted>0),
   'calls',coalesce(sum(calls),0),'conversations',coalesce(sum(conversations),0),'callResponses',coalesce(sum(call_responses),0),
   'unanswered',coalesce(sum(unanswered),0),'busy',coalesce(sum(busy),0),'failed',coalesce(sum(failed),0),
   'textsAccepted',coalesce(sum(texts_accepted),0),'textsDelivered',coalesce(sum(texts_delivered),0),'textReplies',coalesce(sum(text_replies),0),
   'respondedProperties',count(*) filter(where response_in_period),'interestedProperties',count(*) filter(where interest_in_period),
   'queuedCalls',coalesce(sum(queued_calls),0),'queuedTexts',coalesce(sum(queued_texts),0),
   'heldCalls',coalesce(sum(held_calls),0),'heldTexts',coalesce(sum(held_texts),0)) from properties),
  'leads',coalesce((select jsonb_agg(jsonb_build_object(
   'id',id,'accountId',account_id,'account',label,'address',address,'paused',bot_paused,'eligible',eligible,
   'responded',responded,'interested',interested,'optedOut',opted_out,'latestAt',latest_at,
   'calls',calls,'conversations',conversations,'callResponses',call_responses,'unanswered',unanswered,'busy',busy,'failed',failed,
   'textsAccepted',texts_accepted,'textsDelivered',texts_delivered,'textReplies',text_replies,
   'queuedCalls',queued_calls,'queuedTexts',queued_texts,'heldCalls',held_calls,'heldTexts',held_texts
  ) order by interested desc,responded desc,latest_at desc,id desc) from page_rows),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text) from public,anon,authenticated;
grant execute on function public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text) to service_role;
commit;
