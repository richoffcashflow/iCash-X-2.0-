begin;
set local lock_timeout='3s';

-- Evidence only: never issue a ticket, reserve credits, retry a message or call a
-- provider. Work counts describe the next bounded batch, not promised outcomes.
-- Completed state alone is not research evidence: require a real result and
-- exclude practice markers from both the input snapshot and stored analysis.
create function public.icash_usage_loop_context(p_account uuid,p_user uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare progress jsonb;work jsonb;history boolean;review boolean;deal boolean;can_work boolean;candidate uuid;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user)
 then raise exception 'Account ownership required';end if;

 with properties as materialized (
  select s.id,s.completed_at from public.icash_screening_jobs s where s.account_id=p_account and s.state='complete'
   and jsonb_typeof(s.result)='object' and jsonb_typeof(s.result->'property')='object'
   and jsonb_typeof(s.result->'financialCheck')='object' and nullif(btrim(s.result->'property'->>'propertyId'),'') is not null
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
  
 ), deals as materialized (
  select d.* from public.icash_deal_files d join properties p on p.id=d.screening_id
  where d.account_id=p_account and d.stage not in ('cancelled','canceled','cancellation_pending')
   and coalesce(d.terms->>'practice','false')<>'true'
 ), evidence as (
  select 'research_complete' kind,p.id evidence_id,p.completed_at at,1 priority from properties p
  where p.completed_at between now()-interval '30 days' and now()
  union all
  select t.party||'_reply',m.id,m.created_at,case when t.party='buyer' then 3 else 2 end
  from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join deals d on d.id=t.deal_id join public.icash_text_events e on e.id=m.event_id
  where m.account_id=p_account and m.direction='incoming' and m.state='received' and t.party in ('seller','buyer')
   and e.type in ('text.incoming.sms','text.incoming.mms') and m.created_at between now()-interval '30 days' and now()
   and not exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  union all
  select 'contract_signed',e.id,e.updated_at,4 from public.icash_signing_envelopes e join deals d on d.id=e.deal_id
  where e.account_id=p_account and e.kind='purchase' and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null
   and e.updated_at between now()-interval '30 days' and now()
  union all
  select 'closed',d.id,max(u.created_at),5 from deals d join public.icash_closing_updates u on u.deal_id=d.id and u.account_id=d.account_id
  join public.icash_title_replies r on r.id=u.reply_id and r.account_id=u.account_id and r.deal_id=u.deal_id and r.sender_verified
  where d.stage='closed' and u.kind='closed' and (u.confirmed_by is not null or u.confirmation_source='verified_title_format')
   and u.effective_date<=(now() at time zone 'America/Chicago')::date and u.created_at between now()-interval '30 days' and now()
  group by d.id
 )
 select jsonb_build_object('kind',kind,'count',count(distinct evidence_id),'lastAt',max(at)) into progress
 from evidence group by kind,priority order by priority desc,max(at) desc limit 1;

 select exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null)
  or exists(select 1 from public.icash_operation_spend where account_id=p_account and state='settled')
  or progress is not null or exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state='complete'
   and s.completed_at<=now() and jsonb_typeof(s.result)='object' and jsonb_typeof(s.result->'property')='object'
   and jsonb_typeof(s.result->'financialCheck')='object' and nullif(btrim(s.result->'property'->>'propertyId'),'') is not null
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_') into history;
 select exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  where d.account_id=p_account and s.state='complete' and jsonb_typeof(s.result)='object' and jsonb_typeof(s.result->'property')='object'
   and jsonb_typeof(s.result->'financialCheck')='object' and nullif(btrim(s.result->'property'->>'propertyId'),'') is not null
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
   and d.stage in ('under_contract','buyer_selected','title_open','closing') and coalesce(d.terms->>'practice','false')<>'true'
   and exists(select 1 from public.icash_signing_envelopes e where e.deal_id=d.id and e.account_id=p_account and e.kind='purchase'
    and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null)) into deal;

 with active as materialized (
  select d.id,s.id screening_id,s.snapshot->>'propertyId' property_id from public.icash_deal_files d
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  where d.account_id=p_account and s.state='complete' and jsonb_typeof(s.result)='object' and jsonb_typeof(s.result->'property')='object'
   and jsonb_typeof(s.result->'financialCheck')='object' and nullif(btrim(s.result->'property'->>'propertyId'),'') is not null
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
   and d.stage not in ('closed','cancelled','canceled','cancellation_pending') and coalesce(d.terms->>'practice','false')<>'true'
 )
 select exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from active a join public.icash_property_controls c on c.property_id=a.property_id and c.account_id=p_account and c.manual)
  or exists(select 1 from active a join public.icash_handoffs h on h.screening_id=a.screening_id and h.account_id=p_account and h.state<>'resolved')
  or exists(select 1 from active a join public.icash_text_threads t on t.deal_id=a.id and t.account_id=p_account and t.retired_at is null
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=p_account
   where m.direction='outgoing' and (m.state='needs_review' or m.state='dispatching' and m.updated_at<now()-interval '5 minutes'))
  or exists(select 1 from active a join public.icash_signing_envelopes e on e.deal_id=a.id and e.account_id=p_account and not e.test_mode
   where e.state='needs_review' or e.state='creating' and e.updated_at<now()-interval '5 minutes') into review;

 -- Ready SMS must still match a current automation message or the exact public
 -- package. Unknown/edited drafts and already-attempted work cannot sell a refill.
 with candidates as materialized (
  select m.id,m.body,m.customer_price_micros,t.id thread_id,t.party,t.deal_id,t.sms_rate_id
  from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  where m.account_id=p_account and m.direction='outgoing' and m.state='ready' and m.provider_id is null
   and cardinality(m.asset_ids)=0 and public.icash_sms_single_segment(m.body)
   and t.party in ('seller','buyer') and not t.paused and not t.manual_only and t.ai_mode='auto' and t.retired_at is null
   and s.state='complete' and jsonb_typeof(s.result)='object' and jsonb_typeof(s.result->'property')='object'
   and jsonb_typeof(s.result->'financialCheck')='object' and nullif(btrim(s.result->'property'->>'propertyId'),'') is not null
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
   and d.stage not in ('closed','cancelled','canceled','cancellation_pending') and coalesce(d.terms->>'practice','false')<>'true'
   and not exists(select 1 from public.icash_property_controls c where c.account_id=p_account and c.property_id=s.snapshot->>'propertyId' and c.manual)
   and not exists(select 1 from public.icash_handoffs h where h.account_id=p_account and h.screening_id=s.id and h.state<>'resolved')
   and not exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
   and not exists(select 1 from public.icash_operation_spend where account_id=p_account and operation_key='text:'||m.id)
  order by m.created_at,m.id limit 100
 ), eligible as (
  select c.* from candidates c where public.icash_sms_thread_review_current(p_account,c.thread_id,true)
   and public.icash_sms_intake_rate_current(c.sms_rate_id)
   and (c.party<>'buyer' or not public.icash_buyer_outreach_held(p_account,c.deal_id))
   and (exists(select 1 from public.icash_journey_messages j where j.account_id=p_account and j.message_id=c.id
     and j.thread_id=c.thread_id and j.body=c.body and j.state='ready' and public.icash_journey_message_current(j.id))
    or (c.party='buyer' and exists(select 1 from public.icash_buyer_package_texts b where b.message_id=c.id and b.thread_id=c.thread_id)
     and not public.icash_buyer_is_reserved(p_account,c.deal_id)
     and public.icash_buyer_package_brand(c.body)=public.icash_buyer_package_brand(public.icash_buyer_outreach_content(p_account,c.deal_id)->>'sms')))
 )
 select jsonb_build_object('kind',case when party='seller' then 'seller_followup' else 'buyer_outreach' end,'count',count(*),
  'estimateCents',case when bool_and(customer_price_micros is not null and customer_price_micros>0)
   then ceil(sum(case when public.icash_vip_active(p_account) then ceil(customer_price_micros::numeric*0.8) else customer_price_micros end)/10000) else null end)
 into work from eligible group by party order by case when party='seller' then 0 else 1 end limit 1;

 if work is null then
  candidate:=public.icash_enrichment_candidate(p_account);
  if candidate is not null and exists(select 1 from public.icash_discovery_configs c
   join public.icash_operation_rates r on r.id=c.contact_rate_id and r.operation='owner_enrichment' and r.enabled and r.verified_at<=now() and r.expires_at>now()
   join public.icash_screening_jobs s on s.id=candidate and s.account_id=c.account_id and s.state='complete'
   where c.account_id=p_account and c.enabled and c.auto_enabled and c.contacts_enabled and c.data_rights_until>now()
    and jsonb_typeof(s.result)='object' and jsonb_typeof(s.result->'property')='object'
   and jsonb_typeof(s.result->'financialCheck')='object' and nullif(btrim(s.result->'property'->>'propertyId'),'') is not null
   and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
    and not exists(select 1 from public.icash_property_controls pc where pc.account_id=p_account and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
    and not exists(select 1 from public.icash_handoffs h where h.account_id=p_account and h.screening_id=s.id and h.state<>'resolved')
    and not exists(select 1 from public.icash_operation_spend where account_id=p_account and operation_key='owners:'||p_account||':'||candidate)
    and not exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=candidate
     and d.stage in ('closed','cancelled','canceled','cancellation_pending')))
  then work:=jsonb_build_object('kind','research','count',1,'estimateCents',null);end if;
 end if;
 -- Balance and account pause are deliberately not authority for this read-only
 -- readiness result. Callers separately suppress prompts for paused returners.
 can_work:=(work is not null or (public.icash_outreach_sms_current(p_account)
   and exists(select 1 from public.icash_text_senders where enabled)
   and exists(select 1 from public.icash_operation_rates r where r.operation='sms_send' and public.icash_sms_intake_rate_current(r.id))))
  and public.icash_membership_work_allowed(p_account)
  and exists(select 1 from public.icash_customer_identities where account_id=p_account and length(btrim(principal))>0)
  and exists(select 1 from public.icash_operating_budget where id=1 and enabled)
  and not exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null);
 return jsonb_build_object('checkedAt',now(),'progress',progress,'work',work,'hasHistory',history,'needsReview',review,'ready',can_work,'hasDeal',deal);
end $$;
revoke all on function public.icash_usage_loop_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_usage_loop_context(uuid,uuid) to service_role;
commit;
