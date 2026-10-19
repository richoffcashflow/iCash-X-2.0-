begin;
set local lock_timeout='5s';
-- Apply after seller-response-policy.sql. Reuse existing durable manual controls;
-- a refusal/review hold is not a fabricated permanent contact opt-out.
create function public.icash_seller_email_authored_text(p_text text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare line text;body text:='';
begin
 foreach line in array string_to_array(replace(coalesce(p_text,''),E'\r',''),E'\n') loop
  if btrim(line) ~* '^(>|on .+wrote:|from:|sent:|-----.*(original|forwarded))' then exit;end if;
  if btrim(line)<>'' then body:=body||case when body='' then '' else ' ' end||btrim(line);end if;
  if length(body)>20000 then return null;end if;
 end loop;
 return nullif(body,'');
end $$;

-- The sole capture entry point accepts a stored receipt ID, never a model's
-- disposition, account, recipient, quote or screening ID.
create function public.icash_apply_seller_response(p_source text,p_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare a uuid;screen uuid;phone text;contact text;v_email text;prop text;disposition text;phones text[];stamp timestamptz;d public.icash_deal_files;source_text text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_source='sms' then
  select m.account_id,df.screening_id,t.recipient,m.body,m.created_at into a,screen,phone,source_text,stamp
  from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.party='seller'
  join public.icash_deal_files df on df.id=t.deal_id and df.account_id=t.account_id
  where m.id=p_id and m.direction='incoming' and m.state='received' and (m.event_id is not null or m.provider_id is not null)
   and coalesce(df.terms->>'practice','false')<>'true';
  if not found then return null;end if;
  disposition:=public.icash_seller_response_disposition(source_text);
 elsif p_source='call' then
  select c.account_id,c.screening_id,c.contact_key,c.completed_at,public.icash_seller_call_disposition(c.result)
  into a,screen,contact,stamp,disposition from public.icash_live_conversations c
  where c.id=p_id and c.party='seller' and c.state='complete' and c.completed_at is not null;
  if not found then return null;end if;
 elsif p_source='inbound_call' then
  select h.account_id,h.screening_id,h.contact_key,h.completed_at,public.icash_seller_call_disposition(jsonb_build_object('transcript',h.transcript))
  into a,screen,contact,stamp,disposition from icash_seller_agreement_private.call_history h where h.session_id=p_id;
  if not found then return null;end if;
 elsif p_source='email' then
  select df.* into d from public.icash_deal_emails m
  join public.icash_deal_emails sent on sent.id=m.reply_to_id and sent.account_id=m.account_id and sent.deal_id=m.deal_id
   and sent.contact_key=m.contact_key and lower(sent.recipient)=lower(m.recipient) and sent.direction='outgoing' and sent.state in ('dispatching','accepted','needs_review')
  join public.icash_deal_files df on df.id=m.deal_id and df.account_id=m.account_id
  where m.id=p_id and m.direction='incoming' and m.state='received' and m.provider_id is not null
   and coalesce(df.terms->>'practice','false')<>'true'
   and exists(select 1 from public.icash_deal_email_contacts(m.account_id,m.deal_id) c where c.contact_key=m.contact_key and c.party='seller' and lower(c.email)=lower(m.recipient));
  if not found then return null;end if;
  a:=d.account_id;screen:=d.screening_id;
  select lower(m.recipient),public.icash_seller_email_authored_text(m.body_text),m.created_at into v_email,source_text,stamp from public.icash_deal_emails m where m.id=p_id;
  disposition:=public.icash_seller_response_disposition(source_text);
  -- An email address never guesses a phone. Only the actual assigned lead or
  -- completed purchase recipient can provide that cross-channel association.
  select array_agg(distinct x.phone) into phones from (
   select l.phone from public.icash_seller_intakes l join public.icash_seller_matches sm on sm.lead_id=l.id
    where sm.account_id=a and sm.screening_id=screen and lower(l.email)=v_email
   union select r.value->>'phone' from public.icash_signing_envelopes e cross join lateral jsonb_array_elements(e.recipients) with ordinality r(value,n)
    where e.account_id=a and e.deal_id=d.id and e.kind='purchase' and e.state='completed' and not e.test_mode
     and r.n<jsonb_array_length(e.recipients) and lower(r.value->>'email')=v_email and r.value->>'phone' ~ '^[+][1-9][0-9]{7,14}$'
  ) x;
  if cardinality(phones)=1 then phone:=phones[1];end if;
 else return null;
 end if;
 if disposition is null or disposition not in ('opt_out','declined','review') then return null;end if;
 select s.snapshot->>'propertyId' into prop from public.icash_screening_jobs s where s.id=screen and s.account_id=a and coalesce(s.snapshot->>'practice','false')<>'true';
 if not found or exists(select 1 from public.icash_deal_files df where df.account_id=a and df.screening_id=screen and coalesce(df.terms->>'practice','false')='true') then return null;end if;
 if phone is null and contact is not null then
  select array_agg(distinct x.phone) into phones from (
   select p.phone from public.icash_voice_contact_targets p where p.account_id=a and p.screening_id=screen and p.party='seller' and p.contact_key=contact
   union select t.recipient from public.icash_text_threads t join public.icash_deal_files df on df.id=t.deal_id and df.account_id=t.account_id
    where t.account_id=a and df.screening_id=screen and t.party='seller' and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=contact
  ) x;
  if cardinality(phones)=1 then phone:=phones[1];end if;
 end if;
 if phone is not null then
  perform pg_advisory_xact_lock(hashtextextended(phone,74));
  contact:=encode(sha256(convert_to(phone,'UTF8')),'hex');
 end if;
 -- Existing opt-outs are never removed or downgraded. A soft response only
 -- affects this account/property, even when another account has the same phone.
 if disposition='opt_out' then
  if phone ~ '^[+][1-9][0-9]{7,14}$' then
   insert into public.icash_text_suppressions(phone,reason) values(phone,'Verified seller '||p_source||' opt-out: '||p_id) on conflict do nothing;
  end if;
  if v_email is not null then
   insert into public.icash_email_suppressions(account_id,email,reason) values(a,v_email,'Verified seller email opt-out: '||p_id) on conflict do nothing;
  end if;
 end if;
 if prop is not null then
  insert into public.icash_property_controls(account_id,property_id,manual) values(a,prop,true)
  on conflict(account_id,property_id) do update set manual=true,updated_at=now();
 end if;
 update public.icash_text_threads t set paused=true from public.icash_deal_files df
 where t.account_id=a and t.deal_id=df.id and df.account_id=a and df.screening_id=screen and t.party='seller';
 update public.icash_text_messages m set state='cancelled',updated_at=now() from public.icash_text_threads t,public.icash_deal_files df
 where m.thread_id=t.id and m.account_id=a and t.account_id=a and t.party='seller' and df.id=t.deal_id and df.account_id=a and df.screening_id=screen
  and m.direction='outgoing' and m.state='ready' and m.provider_id is null and m.customer_author_id is null
  and not exists(select 1 from public.icash_operation_spend o where o.account_id=a and o.operation_key='text:'||m.id and (o.dispatched_at is not null or o.state in ('dispatched','settled')));
 update public.icash_text_ai_jobs j set state='superseded',updated_at=now() from public.icash_text_threads t,public.icash_deal_files df
 where j.thread_id=t.id and j.account_id=a and t.account_id=a and t.party='seller' and df.id=t.deal_id and df.account_id=a and df.screening_id=screen and j.state in ('pending','issued','drafted');
 update public.icash_live_callbacks set state='canceled' where account_id=a and screening_id=screen and state in ('pending_dispatch_review','held_for_human','missed');
 -- A reserved/attempted/unknown provider operation is not rewritten or refunded.
 -- Its existing worker and reconciliation path owns the outcome.
 update public.icash_voice_jobs j set state='held',outcome='seller_response_'||disposition,updated_at=now()
 from public.icash_voice_contact_targets p where p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=a and p.screening_id=screen and p.party='seller'
  and j.account_id=a and j.cancellation_notice_id is null and j.state in ('ready','issued') and j.provider_call_sid is null and j.conversation_id is null
  and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||j.id);
 update public.icash_deal_emails m set state='needs_review',updated_at=now() from public.icash_seller_email_openers opener,public.icash_deal_files df
 where opener.email_id=m.id and opener.account_id=a and df.id=m.deal_id and df.account_id=a and df.screening_id=screen
  and m.direction='outgoing' and m.state='ready' and m.provider_id is null
  and not exists(select 1 from public.icash_operation_spend o where o.operation_key='deal-email:'||m.id and (o.dispatched_at is not null or o.state in ('dispatched','settled')));
 update public.icash_meta_leads set paused=true,declined_at=case when disposition in ('declined','opt_out') then coalesce(declined_at,stamp) else declined_at end
 where account_id=a and screening_id=screen;
 return disposition;
end $$;

create function public.icash_capture_seller_negative_response() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='icash_text_messages' then
  if new.direction='incoming' and new.state='received' and (TG_OP='INSERT' or old.thread_id is distinct from new.thread_id or old.state is distinct from new.state) then perform public.icash_apply_seller_response('sms',new.id);end if;
 elsif TG_TABLE_NAME='icash_live_conversations' then
  if new.party='seller' and new.state='complete' and (TG_OP='INSERT' or old.state is distinct from new.state) then perform public.icash_apply_seller_response('call',new.id);end if;
 elsif TG_TABLE_NAME='call_history' then perform public.icash_apply_seller_response('inbound_call',new.session_id);
 elsif TG_TABLE_NAME='icash_deal_emails' and new.direction='incoming' and new.state='received' then perform public.icash_apply_seller_response('email',new.id);
 end if;
 return new;
end $$;
create trigger icash_000_seller_negative_text after insert or update of thread_id,state on public.icash_text_messages for each row execute function public.icash_capture_seller_negative_response();
create trigger icash_000_seller_negative_call after insert or update of state on public.icash_live_conversations for each row execute function public.icash_capture_seller_negative_response();
create trigger icash_000_seller_negative_inbound after insert on icash_seller_agreement_private.call_history for each row execute function public.icash_capture_seller_negative_response();
create trigger icash_000_seller_negative_email after insert on public.icash_deal_emails for each row execute function public.icash_capture_seller_negative_response();

-- Existing global phone opt-outs also stop the known, bound seller email.
-- This is not an email-to-phone guess and does not alter consent records.
create function public.icash_seller_phone_opt_out_email() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.icash_email_suppressions(account_id,email,reason)
 select distinct sm.account_id,lower(l.email),'Seller phone opt-out' from public.icash_seller_intakes l join public.icash_seller_matches sm on sm.lead_id=l.id
 where l.phone=new.phone and nullif(l.email,'') is not null
 on conflict(account_id,email) do nothing;
 insert into public.icash_email_suppressions(account_id,email,reason)
 select distinct e.account_id,lower(r.value->>'email'),'Seller phone opt-out' from public.icash_signing_envelopes e cross join lateral jsonb_array_elements(e.recipients) with ordinality r(value,n)
 where e.kind='purchase' and e.state='completed' and not e.test_mode and r.n<jsonb_array_length(e.recipients)
  and r.value->>'phone'=new.phone and nullif(r.value->>'email','') is not null
 on conflict(account_id,email) do nothing;
 return new;
end $$;
create trigger icash_seller_phone_opt_out_email after insert on public.icash_text_suppressions for each row execute function public.icash_seller_phone_opt_out_email();

-- Final admission covers work already queued before the response. Keep the
-- existing human-authored reply and verified cancellation-notice exceptions.
create function public.icash_seller_response_operation_allowed(p_account uuid,p_operation text) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare scope record;
begin
 if p_operation like 'voice:%' then
  select p.phone,p.contact_key,p.screening_id,j.permission_id,j.cancellation_notice_id into scope
  from public.icash_voice_jobs j join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
  where j.account_id=p_account and 'voice:'||j.id=p_operation and p.party='seller';
  if not found then return true;end if;
  if exists(select 1 from public.icash_text_suppressions where phone=scope.phone) or exists(select 1 from public.icash_contact_suppressions where contact_key=scope.contact_key) then return false;end if;
  -- Explicit channel choices survive network-pool assignments, unlike soft
  -- conversation holds. Read the canonical lead through the bound permission.
  if exists(select 1 from public.icash_contact_permissions p join public.icash_meta_leads m on m.lead_id=p.seller_intake_id
   where p.id=scope.permission_id and p.account_id=p_account and m.voice_paused) then return false;end if;
  if scope.cancellation_notice_id is not null then return true;end if;
  return not exists(select 1 from public.icash_screening_jobs s join public.icash_property_controls c on c.account_id=s.account_id and c.property_id=s.snapshot->>'propertyId'
    where s.account_id=p_account and s.id=scope.screening_id and c.manual)
   and not exists(select 1 from public.icash_meta_leads m where m.account_id=p_account and m.screening_id=scope.screening_id and (m.paused or m.declined_at is not null));
 elsif p_operation like 'text:%' or p_operation like 'sms-ai:%' then
  select t.recipient phone,t.paused,d.screening_id,m.customer_author_id into scope from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  left join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id and 'text:'||m.id=p_operation
  left join public.icash_text_ai_jobs j on j.thread_id=t.id and j.account_id=t.account_id and 'sms-ai:'||j.id=p_operation
  where t.account_id=p_account and t.party='seller' and (m.id is not null or j.id is not null);
  if not found then return true;end if;
  if exists(select 1 from public.icash_text_suppressions where phone=scope.phone) or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(scope.phone,'UTF8')),'hex')) then return false;end if;
  if scope.customer_author_id is not null then return true;end if;
  return not scope.paused and not exists(select 1 from public.icash_screening_jobs s join public.icash_property_controls c on c.account_id=s.account_id and c.property_id=s.snapshot->>'propertyId'
    where s.account_id=p_account and s.id=scope.screening_id and c.manual);
 elsif p_operation like 'deal-email:%' then
  select m.id,m.recipient,d.screening_id,o.email_id into scope from public.icash_deal_emails m join public.icash_deal_files d on d.id=m.deal_id and d.account_id=m.account_id
   left join public.icash_seller_email_openers o on o.email_id=m.id and o.account_id=m.account_id
   where m.account_id=p_account and 'deal-email:'||m.id=p_operation;
  if not found then return true;end if;
  if exists(select 1 from public.icash_email_suppressions e where e.account_id=p_account and e.email=lower(scope.recipient)) then return false;end if;
  -- Honor historical phone opt-outs even when they predate the email bridge.
  if exists(select 1 from public.icash_seller_matches sm join public.icash_seller_intakes l on l.id=sm.lead_id
   where sm.account_id=p_account and sm.screening_id=scope.screening_id and lower(l.email)=lower(scope.recipient)
    and (exists(select 1 from public.icash_text_suppressions x where x.phone=l.phone)
     or exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')))) then return false;end if;
  if scope.email_id is null then return true;end if;
  return not exists(select 1 from public.icash_screening_jobs s join public.icash_property_controls c on c.account_id=s.account_id and c.property_id=s.snapshot->>'propertyId'
    where s.account_id=p_account and s.id=scope.screening_id and c.manual);
 end if;
 return true;
end $$;
alter function public.icash_claim_operation(text) rename to icash_claim_before_seller_response;
create function public.icash_claim_operation(p_operation text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select account_id into a from public.icash_operation_spend where operation_key=p_operation;
 if a is not null and not public.icash_seller_response_operation_allowed(a,p_operation) then return false;end if;
 return public.icash_claim_before_seller_response(p_operation);
end $$;
do $patch$
declare definition text;needle text:='if p_action=''claim_dial'' then';
begin
 definition:=pg_get_functiondef('public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller response final dial boundary changed';end if;
 execute replace(definition,needle,needle||E'\n  if not public.icash_seller_response_operation_allowed(r.account_id,r.operation_key) then return null;end if;');
 -- Keep the existing Meta observation/response counters and text-only choices,
 -- but do not let its old broad STOP regex invent a refusal from quoted speech.
 definition:=pg_get_functiondef('public.icash_meta_observe_text()'::regprocedure);
 needle:=$old$if body ~ '\m(stop|unsubscribe|wrong number|not interested|do not contact|don.t contact)\M' then$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta response classification boundary changed';end if;
 definition:=replace(definition,needle,$new$if public.icash_seller_response_disposition(new.body) in ('opt_out','declined') then$new$);
 needle:=$old$if body ~ '(don.t call|do not call|stop calling|text (me )?only|only text)' then$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta text-only classification boundary changed';end if;
 definition:=replace(definition,needle,$new$if public.icash_seller_response_disposition(new.body)='opt_out'
   or public.icash_seller_direct_response_match(replace(body,'’',chr(39)),'\m(text (me )?only|only text)\M') then$new$);
 needle:=$old$and j.provider_call_sid is null and j.conversation_id is null;$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta text-only untouched job boundary changed';end if;
 definition:=replace(definition,needle,$new$and j.provider_call_sid is null and j.conversation_id is null and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||j.id);$new$);
 -- The network-pool observer can see a matched account's reply. A soft hold
 -- belongs to that account, never the canonical Meta owner's conversation.
 needle:='where lead_id=lead;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>5 then raise exception 'Meta observation tenant boundaries changed';end if;
 definition:=replace(definition,needle,'where lead_id=lead and account_id=new.account_id;');
 -- Preserve the existing global, direct-source text-only channel preference.
 -- Only soft holds and response counters belong to the replying account.
 needle:='update public.icash_meta_leads set voice_paused=true where lead_id=lead and account_id=new.account_id;';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Meta voice preference boundary changed';end if;
 definition:=replace(definition,needle,'update public.icash_meta_leads set voice_paused=true where lead_id=lead;');
 definition:=replace(definition,'where p.id=j.permission_id and p.seller_intake_id=lead','where p.id=j.permission_id and p.seller_intake_id=lead and p.account_id=new.account_id and j.account_id=new.account_id');
 definition:=replace(definition,'where id=lead;','where id=lead and exists(select 1 from public.icash_meta_leads own where own.lead_id=lead and own.account_id=new.account_id);');
 execute definition;
end $patch$;
-- Preserve buyer behavior and all existing callback/human/withdrawal paths.
-- The seller-only decline decision must use the same complete source text.
alter function public.icash_text_signal(text,text) rename to icash_text_signal_before_seller_response;
create function public.icash_text_signal(p_body text,p_party text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare signal text;
begin
 if p_party='seller' and public.icash_seller_response_disposition(p_body) in ('opt_out','declined') then return 'declined';end if;
 if p_party='seller' and public.icash_seller_response_disposition(p_body)='review' then return null;end if;
 signal:=public.icash_text_signal_before_seller_response(p_body,p_party);
 return case when p_party='seller' and signal='declined' then null else signal end;
end $$;
do $patch$
declare definition text;needle text:=$old$if (p_result->>'optedOut')::boolean then$old$;
begin
 definition:=pg_get_functiondef('public.icash_save_live_result(uuid,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller result opt-out boundary changed';end if;
 execute replace(definition,needle,$new$if (case when c.party='seller' then public.icash_seller_call_disposition(p_result)='opt_out' else coalesce((p_result->>'optedOut')::boolean,false) end) then$new$);
end $patch$;
revoke all on function public.icash_text_signal(text,text),public.icash_text_signal_before_seller_response(text,text) from public,anon,authenticated;
grant execute on function public.icash_text_signal(text,text) to service_role;

-- Keep existing Meta no-answer detection, but derive refusal only from actual
-- human seller turns rather than false/absent interest or quoted keywords.
create or replace function public.icash_meta_call_outcome(p_result jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare disposition text;transcript jsonb;
begin
 disposition:=public.icash_seller_call_disposition(p_result);
 if disposition='opt_out' then return 'opted_out';end if;
 if disposition='declined' then return 'declined';end if;
 if disposition='review' then return 'review';end if;
 transcript:=case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end;
 if not public.icash_seller_human_answer(transcript)
 or not exists(select 1 from jsonb_array_elements(transcript) t where t->>'role'='user' and t->>'message' ~ '[[:alnum:]]')
 or exists(select 1 from jsonb_array_elements(transcript) t where t->>'role'='user' and t->>'message' ~* '(buz[oó]n de voz|correo de voz|(graba|grabe|deja|deje).{0,25}mensaje|despu[eé]s.{0,15}(tono|se[nñ]al)|terminado de grabar)') then return 'no_response';end if;
 return 'responded';
end $$;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_seller_gap_reason(jsonb,boolean)'::regprocedure);
 needle:=$old$if b ~* '\m(not interested|wrong number|no thanks|no thank you|not selling)\M' then return 'declined';end if;$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller gap decline boundary changed';end if;
 definition:=replace(definition,needle,$new$if public.icash_seller_response_disposition(b) in ('declined','review') then return 'declined';end if;$new$);
 needle:=$old$if b ~* '\m(not ready|need to think|never agreed|wait|hold off)\M' then return 'declined';end if;$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Seller gap pause boundary changed';end if;
 execute replace(definition,needle,'-- Shared seller response policy owns negative-response classification.');
end $patch$;
revoke all on function public.icash_seller_email_authored_text(text),public.icash_apply_seller_response(text,uuid),public.icash_capture_seller_negative_response(),public.icash_seller_phone_opt_out_email(),public.icash_seller_response_operation_allowed(uuid,text),public.icash_claim_operation(text),public.icash_claim_before_seller_response(text) from public,anon,authenticated;
grant execute on function public.icash_seller_email_authored_text(text),public.icash_apply_seller_response(text,uuid),public.icash_seller_response_operation_allowed(uuid,text),public.icash_claim_operation(text) to service_role;
commit;
