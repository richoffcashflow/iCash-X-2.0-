-- A carrier intercept identifies a temporarily unusable phone, not a seller refusal.
create or replace function public.icash_call_reported_disconnection(p_result jsonb)
returns boolean language sql immutable set search_path='' as $fn$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array'
  then p_result->'transcript' else '[]'::jsonb end) t where t->>'role'='user' and t->>'message' ~* $prompt$^\s*[. ]*(?:[0-9][0-9 -]{3,17}|the number you (?:have )?dialed) is not in service at this time[.! ]+please check the number and dial again(?:,? or call your operator for assistance)?[.! ]*$$prompt$)
  and not public.icash_call_has_seller_response(p_result);
$fn$;

create index if not exists icash_completed_seller_contact_time
 on public.icash_live_conversations(account_id,contact_key,completed_at desc) where party='seller' and state='complete';

-- Amend only the inspected predicates, retaining concurrent admission, receipt and billing checks.
do $migration$
declare r record; src text;
begin
 for r in select * from (values
 ('public.icash_call_has_seller_response(jsonb)','b9a9b197e6780d0a7711097352e201d9',$old$not public.icash_call_is_automated_menu(t->>'message') and ($old$,$new$not public.icash_call_is_automated_menu(t->>'message') and coalesce(t->>'message','') !~* $prompt$^\s*[. ]*(?:[0-9][0-9 -]{3,17}|the number you (?:have )?dialed) is not in service at this time[.! ]+please check the number and dial again(?:,? or call your operator for assistance)?[.! ]*$|^\s*(?:see if this person is available|revisar[eé] si esta persona est[aá] disponible)[.! ]*$$prompt$ and ($new$),
 ('public.icash_seller_call_answer_disposition(text,text)','a0cdb02df75eabe8550f2172e378a967',$old$want to sell|open to.{0,15}cash offer)$old$,$new$want to sell|are you (?:currently )?looking to sell(?: (?:the|this|your) (?:property|house|home))?\s*$|open to.{0,15}cash offer)$new$),
 ('public.icash_seller_sms_disposition(uuid,uuid)','6fb4820a37aca6e7f516e54bf2415d24',$old$ if answer !~$old$,$new$ -- Preserve the preceding delivered seller question as the authority for a short no.
 if answer ~ '^no[.! ,]*👎[🏻🏼🏽🏾🏿]?[️]?[.! ,]*$' then answer:='no';end if;
 if answer !~$new$),
 ('public.icash_seller_phone_call_current(uuid,uuid)','560274e114c3d792f32dc484ac008832',$old$ if exists(select 1 from public.icash_call_recordings r where r.voice_job_id=p_job$old$,$new$ if exists(select 1 from public.icash_live_conversations c
  where c.account_id=p_account and c.contact_key=p.contact_key and c.party='seller' and c.state='complete'
   and c.completed_at between now()-interval '30 days' and now()
   and public.icash_call_reported_disconnection(c.result)) then return false;end if;
 if exists(select 1 from public.icash_call_recordings r where r.voice_job_id=p_job$new$),
 ('public.icash_unanswered_seller_call_current(uuid,uuid,uuid)','61ec5e2634746d4c18e2045ec5d0004c',$old$ if cutover is null then return false;end if;$old$,$new$ if cutover is null then return false;end if;
 if exists(select 1 from public.icash_live_conversations c where c.account_id=p_account
  and c.operation_key='voice:'||p_original and c.party='seller' and c.state='complete'
  and public.icash_call_reported_disconnection(c.result)) then return false;end if;$new$)
 ) changes(signature,expected,prior,replacement) loop
  src:=pg_get_functiondef(r.signature::regprocedure);
  if strpos(src,r.replacement)>0 then continue;end if;
  if md5(src)<>r.expected or strpos(src,r.prior)=0 then raise exception 'Unexpected source for %',r.signature;end if;
  execute replace(src,r.prior,r.replacement);
 end loop;
end
$migration$;

-- Repair the reviewed Nov 20 window from original receipts, without replaying messages.
do $repair$
declare r record; window_start constant timestamptz:='2026-11-20 08:00 America/Chicago';window_end constant timestamptz:='2026-11-20 20:04 America/Chicago';
begin
 for r in select m.id from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where t.party='seller' and not t.paused and m.direction='incoming' and m.created_at between window_start and window_end
   and m.body ~* '^\s*no[.! ,]*👎[🏻🏼🏽🏾🏿]?[️]?[.! ,]*$' and public.icash_seller_sms_disposition(m.account_id,m.id)='declined'
   and not exists(select 1 from public.icash_text_messages later where later.thread_id=m.thread_id and later.created_at>m.created_at)
 loop perform public.icash_apply_seller_response('sms',r.id);end loop;

 for r in select c.id from public.icash_live_conversations c where c.party='seller' and c.state='complete'
   and c.created_at between window_start and window_end and c.result->>'responseDisposition' is null
   and public.icash_seller_call_disposition(c.result)='declined'
   and not exists(select 1 from public.icash_live_conversations later where later.account_id=c.account_id and later.screening_id=c.screening_id and later.created_at>c.created_at)
   and not exists(select 1 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id
    join public.icash_deal_files df on df.id=t.deal_id where df.account_id=c.account_id and df.screening_id=c.screening_id and m.created_at>c.completed_at and m.direction='incoming')
 loop
  if public.icash_apply_seller_response('call',r.id)='declined' then
   update public.icash_live_conversations set result=result||jsonb_build_object('responseDisposition','declined','interested',false,'interestQuote',null,
    'callbackStatus','held_for_seller_response','callbackDueAt',null,'callbackTimezone',null,
    'nextAction','Automatic follow-up stopped after the seller response; review the original conversation.') where id=r.id;
  end if;
 end loop;

 update public.icash_live_conversations c set result=result||jsonb_build_object('contactEvidence','automated_answer',
  'summary','Automated answering or call-screening audio; no verified seller response.',
  'nextAction',case when public.icash_call_reported_disconnection(c.result)
   then 'Carrier reported this number out of service. Hold automatic calls to this number.'
   else 'No seller response. Continue only through the existing eligible unanswered-contact workflow.' end)
 where c.party='seller' and c.state='complete' and c.created_at between window_start and window_end
  and c.result->>'contactEvidence'='human_response' and c.result->>'responseDisposition' is null
  and c.result->>'callbackStatus'='not_requested' and c.result->>'interested'='false' and c.result->>'humanRequested'='false'
  and c.result->>'optedOut'='false' and not public.icash_call_has_seller_response(c.result)
  and exists(select 1 from jsonb_array_elements(c.result->'transcript') t where t->>'role'='user' and t->>'message' ~* $prompt$^\s*[. ]*(?:[0-9][0-9 -]{3,17}|the number you (?:have )?dialed) is not in service at this time[.! ]+please check the number and dial again(?:,? or call your operator for assistance)?[.! ]*$|^\s*(?:see if this person is available|revisar[eé] si esta persona est[aá] disponible)[.! ]*$$prompt$);

 -- Restore only the still-current, previously processed seller price. The
 -- immutable delivered ownership question remains the original conversation.
 update icash_call_offer_private.offers o set state=jsonb_set(o.state,'{proposedPriceCents}',
  to_jsonb(replace(substring(m.body from '([0-9][0-9,]*)'),',','')::bigint*100)),version=o.version+1,updated_at=clock_timestamp()
 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
 join public.icash_text_ai_jobs j on j.message_id=m.id and j.thread_id=m.thread_id and j.account_id=m.account_id
 join lateral(select earlier.* from public.icash_text_messages earlier where earlier.thread_id=m.thread_id and earlier.created_at<m.created_at
  order by earlier.created_at desc,earlier.id desc limit 1) prior on true
 where o.account_id=t.account_id and o.deal_id=t.deal_id and t.party='seller' and m.direction='incoming' and m.state='received'
  and (m.event_id is not null or m.provider_id is not null) and m.created_at between window_start and window_end
  and m.body ~* '^yes[, ]+[0-9]{1,3}(,[0-9]{3}){1,2} cash[.! ]*$'
  and o.state->>'processedSource'=m.id::text and o.state->>'textThreadId'=m.thread_id::text
  and o.state->>'acceptedPriceCents' is null and o.state->>'proposedPriceCents' is null and o.state->>'quotedPriceCents' is null
  and j.analysis->>'offerAction'='qualify_ownership' and prior.direction='outgoing' and prior.state='delivered' and prior.provider_id is not null
  and prior.body ~* 'would you consider selling .+ for all cash\?' and prior.customer_author_id is null
  and exists(select 1 from public.icash_sms_seller_openings op where op.account_id=m.account_id and op.thread_id=m.thread_id and prior.id in(op.interest_message_id,op.owner_question_id))
  and not exists(select 1 from public.icash_text_messages later where later.thread_id=m.thread_id and later.direction='incoming' and later.created_at>m.created_at);
end
$repair$;
