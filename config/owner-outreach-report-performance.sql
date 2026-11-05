-- Preserve all report receipts and classification rules; avoid repeated
-- transcript scans and defer expensive classification until after deduplication.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old_part text;new_part text;
begin
 d:=pg_get_functiondef('public.icash_call_has_seller_response(jsonb)'::regprocedure);
 old_part:=$old$ select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
 where t->>'role'='user' and (
  public.icash_seller_response_disposition(t->>'message')='opt_out'
  or (t->>'message' ~ '[[:alpha:]]'
   and t->>'message' !~* '^\s*[\[(*]?\s*(music|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$'
   and t->>'message' !~* 'leave (a |an |your )?(additional )?message|record (a |your )?message|(at|after) the (beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call'
  )));
$old$;
 new_part:=$new$ select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
 where t->>'role'='user' and (
  case when t->>'message' ~ '[[:alpha:]]'
   and t->>'message' !~* '^\s*[\[(*]?\s*(music|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$'
   and t->>'message' !~* 'leave (a |an |your )?(additional )?message|record (a |your )?message|(at|after) the (beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call' then true
   else public.icash_seller_response_disposition(t->>'message')='opt_out' end));
$new$;
 if (length(d)-length(replace(d,old_part,'')))/length(old_part)<>1 then raise exception 'Seller response definition changed';end if;
 execute replace(d,old_part,new_part);
 d:=pg_get_functiondef('public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'::regprocedure);
 old_part:=$old$ ), voice as materialized (
  -- One row per job, even if a historical conversation has multiple projections.
  select distinct on (j.id) j.id,s.id screening_id,j.state,j.created_at,
   (nullif(j.provider_call_sid,'') is not null or nullif(r.call_sid,'') is not null or nullif(c.conversation_id,'') is not null) attempted,
   coalesce(r.dial_claimed_at,sp.dispatched_at,c.created_at) attempt_at,
   c.state='complete' and nullif(c.conversation_id,'') is not null as ai_complete,c.completed_at,
   c.state='complete' and nullif(c.conversation_id,'') is not null and public.icash_call_has_seller_response(c.result) responded,
   c.state='complete' and nullif(c.conversation_id,'') is not null and public.icash_call_has_seller_response(c.result)
    and public.icash_call_selling_interest(c.result) and public.icash_seller_call_disposition(c.result) is null interested,
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
$old$;
 new_part:=$new$ ), voice_source as materialized (
  -- One row per job, even if a historical conversation has multiple projections.
  select distinct on (j.id) j.id,s.id screening_id,j.state,j.created_at,
   (nullif(j.provider_call_sid,'') is not null or nullif(r.call_sid,'') is not null or nullif(c.conversation_id,'') is not null) attempted,
   coalesce(r.dial_claimed_at,sp.dispatched_at,c.created_at) attempt_at,
   c.state='complete' and nullif(c.conversation_id,'') is not null as ai_complete,c.completed_at,
   nullif(c.conversation_id,'') is not null has_conversation,c.result,
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
 ), voice_evidence as materialized (
  -- Classify only the selected conversation, once per report.
  select v.*,
   case when ai_complete then public.icash_call_has_seller_response(v.result) else false end responded,
   case when has_conversation then public.icash_seller_call_disposition(v.result) end disposition
  from voice_source v
 ), voice as materialized (
  select v.*,
   case when responded and v.result->'optedOut' is distinct from 'true'::jsonb and disposition is null
    then public.icash_seller_interest_quote(v.result) is not null else false end interested,
   has_conversation and (v.result->'optedOut'='true'::jsonb or disposition='opt_out') opted_out
  from voice_evidence v
$new$;
 if (length(d)-length(replace(d,old_part,'')))/length(old_part)<>1 then raise exception 'Owner outreach voice definition changed';end if;
 execute replace(d,old_part,new_part);
end $patch$;
-- CREATE OR REPLACE preserves security invoker, stability, search_path and ACL.
commit;

