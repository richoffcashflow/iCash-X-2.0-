begin;
-- Expose only calls bound to this account, property, party and exact contact.
-- Private reception tables remain inaccessible to API clients.
create function public.icash_thread_calls(p_account uuid,p_thread uuid,p_before timestamptz default null,p_after timestamptz default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with contact as (
  select t.party,t.recipient,d.screening_id,encode(sha256(convert_to(t.recipient,'UTF8')),'hex') contact_key
  from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.id=p_thread and t.account_id=p_account and t.retired_at is null
 ), calls as (
  select c.id,'outbound'::text source,c.party,c.completed_at,c.result
  from public.icash_live_conversations c join contact t on t.screening_id=c.screening_id and t.contact_key=c.contact_key and t.party=c.party
  where c.account_id=p_account and c.state='complete' and c.completed_at is not null
  union all
  select h.session_id,'reception','seller',h.completed_at,jsonb_build_object('durationSeconds',s.duration_seconds)
  from icash_seller_agreement_private.call_history h
  join contact t on t.screening_id=h.screening_id and t.contact_key=h.contact_key and t.party='seller'
  join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id and s.conversation_id=h.conversation_id and s.from_phone=t.recipient
  where h.account_id=p_account
 ), selected as (
  select * from calls where (p_before is null or completed_at<p_before) and (p_after is null or completed_at>=p_after)
  order by completed_at desc,id desc limit 20
 ) select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
   'id',id,'source',source,'party',party,'completedAt',completed_at,'summary',result->>'summary',
   'durationSeconds',result->'durationSeconds','nextAction',result->>'nextAction',
   'interested',result->'interested','optedOut',result->'optedOut','humanRequested',result->'humanRequested'
 )) order by completed_at desc,id desc),'[]'::jsonb) from selected;
$$;
create function public.icash_reception_conversation(p_account uuid,p_session uuid,p_before integer default null)
returns jsonb language sql stable security definer set search_path='' as $$
 with history as (
  select h.transcript from icash_seller_agreement_private.call_history h
  join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id and s.conversation_id=h.conversation_id
  where h.session_id=p_session and h.account_id=p_account and (p_before is null or p_before between 0 and 100000)
 ), bounds as (
  select transcript,least(coalesce(p_before,jsonb_array_length(transcript)),jsonb_array_length(transcript)) finish from history
 ) select jsonb_build_object('party','seller','transcript',coalesce((
  select jsonb_agg(t.value order by t.position) from jsonb_array_elements(transcript) with ordinality t(value,position)
  where position>greatest(0,finish-60) and position<=finish
 ),'[]'::jsonb),'next',case when finish>60 then finish-60 else null end) from bounds;
$$;
revoke all on function public.icash_thread_calls(uuid,uuid,timestamptz,timestamptz),public.icash_reception_conversation(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_thread_calls(uuid,uuid,timestamptz,timestamptz),public.icash_reception_conversation(uuid,uuid,integer) to service_role;
commit;
