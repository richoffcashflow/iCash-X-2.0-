-- Reporting must survive funding, use the selected calendar period, and never
-- refresh outcomes or start work. Provider-backed actions on older properties
-- belong to their action date, not the original discovery or funding date.
begin;
set local lock_timeout='3s';
create or replace function public.icash_opportunity_progress_report(
 p_account uuid,p_days integer default 1,p_timezone text default 'UTC'
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare starts timestamptz;ends timestamptz:=now();report jsonb;
begin
 if p_days is null or p_days not in (1,7,30) then raise exception 'Invalid reporting period';end if;
 if p_timezone is null or length(p_timezone)>100 or not exists(select 1 from public.icash_timezone_names where name=p_timezone) then raise exception 'Invalid reporting timezone';end if;
 if not exists(select 1 from public.icash_accounts where id=p_account) then return null;end if;
 starts:=(((ends at time zone p_timezone)::date-(p_days-1))::timestamp at time zone p_timezone);
 with screens as materialized (
  select s.id,s.completed_at,s.result,
   coalesce(nullif(s.result->'property'->>'propertyId',''),nullif(s.snapshot->>'propertyId','')) property_id
  from public.icash_screening_jobs s
  where s.account_id=p_account and s.state='complete' and s.completed_at<=ends
   and coalesce(s.snapshot->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_'
 ), real_properties as materialized (
  select * from screens where property_id is not null
 ), first_screens as (
  select property_id,min(completed_at) completed_at,
   bool_or(result->'financialCheck'->>'status'='eligible') eligible
  from real_properties group by property_id
 ), voice as materialized (
  select s.property_id,coalesce(sp.dispatched_at,c.created_at) attempted_at,
   c.completed_at,
   case when c.state='complete' and c.completed_at between starts and ends
    then public.icash_call_has_seller_response(c.result) else false end responded,
   coalesce(c.result->'optedOut'='true'::jsonb,false) opted_out
  from public.icash_live_conversations c join real_properties s on s.id=c.screening_id
  left join public.icash_operation_spend sp on sp.account_id=c.account_id and sp.operation_key=c.operation_key
  where c.account_id=p_account and c.party='seller' and nullif(c.conversation_id,'') is not null
 ), texts as materialized (
  select s.property_id,m.direction,m.state,m.provider_id,m.event_id,m.body,m.created_at,
   coalesce(sp.dispatched_at,m.created_at) sent_at
  from public.icash_deal_files d join real_properties s on s.id=d.screening_id
  join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  left join public.icash_operation_spend sp on sp.account_id=m.account_id and sp.operation_key='text:'||m.id
  where d.account_id=p_account and coalesce(d.terms->>'practice','false')<>'true' and m.created_at<=ends
 ), emails as materialized (
  select s.property_id,m.id=a.email_id and m.direction='outgoing' and m.state='accepted' attempted,
   m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' responded,
   m.body_text,m.created_at,coalesce(sp.dispatched_at,m.created_at) sent_at
  from public.icash_deal_files d join real_properties s on s.id=d.screening_id
  join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id
  join public.icash_deal_emails m on m.account_id=a.account_id and m.deal_id=a.deal_id
   and lower(m.recipient)=a.recipient and (m.id=a.email_id or m.reply_to_id=a.email_id)
  left join public.icash_operation_spend sp on sp.account_id=m.account_id and sp.operation_key='deal-email:'||m.id
  where d.account_id=p_account and coalesce(d.terms->>'practice','false')<>'true'
   and m.provider_id is not null and m.created_at<=ends
 ), attempts as (
  select property_id from voice where attempted_at between starts and ends
  union
  -- Carrier-start receipts count a real attempt even if the AI transcript is late.
  select s.property_id from public.icash_call_recordings r join real_properties s on s.id=r.screening_id
   where r.account_id=p_account and r.party='seller' and nullif(r.call_sid,'') is not null
    and r.provider_started_at between starts and ends
  union
  -- Admission can save the carrier ID before callback/recording projections.
  select s.property_id from public.icash_voice_jobs j
   left join public.icash_operational_contacts oc on oc.id=j.operational_contact_id and oc.account_id=j.account_id and oc.channel='voice'
   left join public.icash_contact_permissions cp on cp.id=j.permission_id and cp.account_id=j.account_id and cp.party='seller'
   join real_properties s on s.id=coalesce(oc.screening_id,cp.screening_id)
   left join public.icash_operation_spend sp on sp.account_id=j.account_id and sp.operation_key=j.operation_key
   where j.account_id=p_account and (nullif(j.provider_call_sid,'') is not null or nullif(j.conversation_id,'') is not null)
    and coalesce(sp.dispatched_at,j.created_at) between starts and ends
  union
  select property_id from texts where direction='outgoing' and state in ('accepted','delivered')
   and nullif(provider_id,'') is not null and sent_at between starts and ends
  union
  select property_id from emails where attempted and sent_at between starts and ends
 ), responses as (
  select property_id from voice where responded and completed_at between starts and ends
  union
  select property_id from texts where direction='incoming' and state='received'
   and (nullif(provider_id,'') is not null or nullif(event_id,'') is not null) and created_at>=starts
  union
  select property_id from emails where responded and created_at>=starts
 ), opted_out as (
  select property_id from voice where opted_out and coalesce(completed_at,attempted_at)<=ends
  union
  select property_id from texts where direction='incoming' and state='received'
   and (nullif(provider_id,'') is not null or nullif(event_id,'') is not null) and public.icash_seller_contact_stop(body)
  union
  select property_id from emails where responded
   and lower(trim(split_part(body_text,E'\n',1))) ~ '^(unsubscribe|stop|remove me|please unsubscribe|please stop)[.! ]*$'
 )
 select jsonb_build_object('days',p_days,'timezone',p_timezone,'startAt',starts,'endAt',ends,
  'screened',(select count(*) from first_screens where completed_at>=starts),
  'eligible',(select count(*) from first_screens where completed_at>=starts and eligible),
  'contacted',(select count(*) from attempts),
  'responded',(select count(*) from responses r where not exists(select 1 from opted_out o where o.property_id=r.property_id)),
  'queued',(select count(*) from public.icash_screening_jobs s where s.account_id=p_account and s.state in ('queued','running')
   and s.created_at<=ends and coalesce(s.snapshot->>'practice','false')<>'true'
   and left(coalesce(s.snapshot->>'propertyId',''),9)<>'practice_'
   and left(coalesce(s.result->'property'->>'propertyId',''),9)<>'practice_')
 ) into report;
 return report;
end $$;
revoke all on function public.icash_opportunity_progress_report(uuid,integer,text) from public,anon,authenticated;
grant execute on function public.icash_opportunity_progress_report(uuid,integer,text) to service_role;
commit;

