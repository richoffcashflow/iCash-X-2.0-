begin;

-- Separate measurement from immutable submission evidence so cookies changing
-- between retries cannot invalidate a successfully saved seller request.
alter table public.icash_seller_intakes add column if not exists meta_measurement jsonb
 check(meta_measurement is null or (jsonb_typeof(meta_measurement)='object' and octet_length(meta_measurement::text)<=2000));

create or replace function public.icash_record_seller_measurement(p_lead uuid,p_guest text,p_measurement jsonb,p_opted_out boolean)
returns text language plpgsql set search_path='' as $$
declare l public.icash_seller_intakes;event_id uuid;
begin
 select * into l from public.icash_seller_intakes where id=p_lead and guest_hash=p_guest for update;
 if not found or l.state='duplicate' or coalesce(l.attribution->>'source','') not in ('meta','google','tiktok','youtube','other','direct') then return null;end if;
 if p_opted_out is distinct from false or l.attribution->>'measurementOptOut'='true' or l.meta_measurement->>'optedOut'='true' then
  update public.icash_seller_intakes set meta_measurement='{"optedOut":true}' where id=l.id;
  return null;
 end if;
 if jsonb_typeof(p_measurement) is distinct from 'object' or octet_length(p_measurement::text)>2000
 or p_measurement-array['fbp','fbc','client_user_agent','event_source_url']<>'{}'::jsonb
 or exists(select 1 from jsonb_each(p_measurement) where jsonb_typeof(value)<>'string') then return null;end if;
 update public.icash_seller_intakes set meta_measurement=p_measurement where id=l.id and meta_measurement is null;
 select id into event_id from public.icash_seller_events where lead_id=l.id and event_name='CompleteRegistration';
 return case when event_id is not null then 'keypath:'||event_id end;
end $$;

-- Duration or a carrier's "completed" status alone can mean voicemail. Require
-- a saved seller utterance and reject recognizable automated greetings.
create or replace function public.icash_seller_human_answer(p_transcript jsonb)
returns boolean language sql immutable set search_path='' as $$
 with turns as (
  select trim(t->>'message') as message from jsonb_array_elements(case when jsonb_typeof(p_transcript)='array' then p_transcript else '[]'::jsonb end) t
  where t->>'role'='user' and jsonb_typeof(t->'message')='string'
 ) select exists(select 1 from turns where length(message)>0)
 and not exists(select 1 from turns where message ~* '(voice[ -]?mail|mailbox|leave.{0,25}(message|name|number)|after.{0,12}(tone|beep)|you.{0,8}(have reached|ve reached)|call.{0,20}(forwarded|not available)|automated.{0,20}(system|assistant)|not available.{0,25}(call|message)|press [0-9]|disconnected|number.{0,20}not in service)');
$$;

create or replace function public.icash_collect_seller_milestones()
returns void language plpgsql set search_path='' as $$
begin
 -- Contact is a real seller phone conversation, never a text reply or dial.
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select distinct on (l.id) l.id,'Contact',c.completed_at,'conversation:'||c.id
 from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id
 join public.icash_live_conversations c on c.account_id=m.account_id and c.screening_id=m.screening_id
 where l.state<>'duplicate' and l.attribution->>'source'<>'icash_x_demo'
 and c.party='seller' and c.state='complete' and c.conversation_id is not null
 and c.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')
 and c.completed_at between l.created_at and now()
 and case when jsonb_typeof(c.result->'durationSeconds')='number' then (c.result->>'durationSeconds')::numeric>0 else false end
 and public.icash_seller_human_answer(c.result->'transcript')
 order by l.id,c.completed_at on conflict do nothing;

 -- Both required purchase signatures must be verified by the live provider.
 insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
 select distinct on (l.id) l.id,'SubmitApplication',d.seller_signed_at,'executed-purchase:'||e.id
 from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id
 join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
 join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase'
 and not e.test_mode and e.state='completed' and e.provider_id is not null
 where l.state<>'duplicate' and l.attribution->>'source'<>'icash_x_demo'
 and d.seller_signed_at between l.created_at and now()
 order by l.id,d.seller_signed_at on conflict do nothing;
end $$;

-- Preserve the verified inbound identity checks. A seller calling back counts
-- as Contact too, only after the bound provider conversation has been saved.
create or replace function public.icash_save_seller_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b icash_seller_agreement_private.inbound_bindings;at_time timestamptz;
begin
 if not public.icash_save_seller_history_before_viewings(p_session,p_conversation,p_transcript) then return false;end if;
 select completed_at into at_time from icash_seller_agreement_private.call_history where session_id=p_session and conversation_id=p_conversation and transcript=p_transcript;
 if not found then return false;end if;
 select * into b from icash_seller_agreement_private.inbound_bindings where session_id=p_session;
 perform public.icash_capture_seller_viewing(b.account_id,b.deal_id,b.thread_id,'call',p_session,p_transcript,at_time);
 if public.icash_seller_human_answer(p_transcript) then
  insert into public.icash_seller_events(lead_id,event_name,occurred_at,evidence_ref)
  select l.id,'Contact',h.completed_at,'seller-inbound:'||h.session_id from public.icash_seller_intakes l
  join public.icash_seller_matches m on m.lead_id=l.id
  join icash_seller_agreement_private.call_history h on h.account_id=m.account_id and h.screening_id=m.screening_id
  and h.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')
  where h.session_id=p_session and l.state<>'duplicate' and l.attribution->>'source'<>'icash_x_demo' and l.created_at<=h.completed_at
  on conflict do nothing;
 end if;
 return true;
end $$;

create or replace function public.icash_claim_seller_event()
returns jsonb language plpgsql set search_path='' as $$
declare e public.icash_seller_events;l public.icash_seller_intakes;token uuid:=gen_random_uuid();
begin
 update public.icash_seller_events set delivery_state=case when attempts>=3 or occurred_at<now()-interval '7 days' then 'review' else 'pending' end where delivery_state='sending' and attempted_at<now()-interval '2 minutes';
 update public.icash_seller_events set delivery_state='review' where delivery_state='pending' and occurred_at<now()-interval '7 days';
 select ev.* into e from public.icash_seller_events ev join public.icash_seller_intakes i on i.id=ev.lead_id
 where ev.delivery_state='pending' and (ev.attempted_at is null or ev.attempted_at<now()-interval '2 minutes')
 and i.state<>'duplicate' and i.attribution->>'source' in ('meta','google','tiktok','youtube','other','direct')
 -- No historical/demo backfill: only requests measured by this public form.
 and i.meta_measurement is not null and coalesce(i.meta_measurement->>'optedOut','false')='false'
 and coalesce(i.attribution->>'measurementOptOut','false')='false'
 and (ev.event_name<>'Contact' or ev.evidence_ref like 'conversation:%' or ev.evidence_ref like 'seller-inbound:%')
 order by ev.occurred_at limit 1 for update of ev skip locked;
 if not found then return null;end if;
 select * into l from public.icash_seller_intakes where id=e.lead_id;
 update public.icash_seller_events set delivery_state='sending',delivery_token=token,attempted_at=now(),attempts=attempts+1 where id=e.id;
 return jsonb_build_object('id',e.id,'leadId',l.id,'token',token,'name',e.event_name,'occurredAt',e.occurred_at,'phone',l.phone,
 'actionSource',case when e.event_name='Contact' then 'phone_call' when e.event_name='CompleteRegistration' then 'website' else 'system_generated' end,'measurement',l.meta_measurement);
end $$;

revoke all on function public.icash_record_seller_measurement(uuid,text,jsonb,boolean),public.icash_seller_human_answer(jsonb),public.icash_collect_seller_milestones(),public.icash_save_seller_inbound_history(uuid,text,jsonb),public.icash_claim_seller_event() from public,anon,authenticated;
grant execute on function public.icash_record_seller_measurement(uuid,text,jsonb,boolean),public.icash_seller_human_answer(jsonb),public.icash_collect_seller_milestones(),public.icash_save_seller_inbound_history(uuid,text,jsonb),public.icash_claim_seller_event() to service_role;
commit;
