CREATE OR REPLACE FUNCTION public.icash_support_outreach_diagnostics(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$
;
