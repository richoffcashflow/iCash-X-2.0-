begin;
create table public.icash_seller_viewing_availability(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),screening_id uuid not null references public.icash_screening_jobs(id),
 thread_id uuid references public.icash_text_threads(id),source text not null check(source in ('call','outbound_call','text','owner')),source_id uuid not null,
 quote text not null check(length(quote) between 1 and 4000),slots jsonb not null default '[]' check(jsonb_typeof(slots)='array' and jsonb_array_length(slots)<=8),
 state text not null check(state in ('available','needs_review','withdrawn')),timezone text not null,
 stated_at timestamptz not null,created_at timestamptz not null default now(),confirmed_by uuid references auth.users(id),unique(source,source_id)
);
create index seller_viewing_latest on public.icash_seller_viewing_availability(account_id,deal_id,stated_at desc,created_at desc);
alter table public.icash_seller_viewing_availability enable row level security;
revoke all on public.icash_seller_viewing_availability from public,anon,authenticated,service_role;
grant select on public.icash_seller_viewing_availability to service_role;

-- Only an entire, unambiguous scheduling statement produces public date fields.
-- Arbitrary seller messages, access codes and financial details stay private.
create function public.icash_parse_viewing_slot(p_quote text,p_at timestamptz) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare parts text[];b text;day date;zone text;start_local timestamp;end_local timestamp;start_at timestamptz;end_at timestamptz;today date;weekday integer;date_parts text[];
begin
 if length(p_quote)>500 or p_at is null then return null;end if;
 b:=lower(btrim(regexp_replace(p_quote,'\s+',' ','g')));
 parts:=regexp_match(b,'^(?:(?:i am available|i can do|viewings? (?:are|work)|you can come|available) (?:on )?)?(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[0-9]{4}-[0-9]{2}-[0-9]{2}|(?:january|february|march|april|may|june|july|august|september|october|november|december) [0-9]{1,2},? [0-9]{4}) (?:at |from )?(1[0-2]|[1-9])(?::([0-5][0-9]))? ?(am|pm)(?: ?(?:to|until|-) ?(1[0-2]|[1-9])(?::([0-5][0-9]))? ?(am|pm))? (central|eastern|mountain|pacific|ct|et|mt|pt|utc)(?: time)?(?: works(?: for me)?)?[.!]?$');
 if parts is null then return null;end if;
 zone:=case parts[8] when 'central' then 'America/Chicago' when 'ct' then 'America/Chicago' when 'eastern' then 'America/New_York' when 'et' then 'America/New_York' when 'mountain' then 'America/Denver' when 'mt' then 'America/Denver' when 'pacific' then 'America/Los_Angeles' when 'pt' then 'America/Los_Angeles' when 'utc' then 'UTC' end;
 today:=(p_at at time zone zone)::date;
 weekday:=array_position(array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'],parts[1]);
 if parts[1]='today' then day:=today;
 elsif parts[1]='tomorrow' then day:=today+1;
 elsif weekday is not null then day:=today+((weekday-1-extract(dow from today)::integer+7)%7);
 elsif parts[1] ~ '^[0-9]' then day:=parts[1]::date;
 else
  date_parts:=regexp_match(parts[1],'^([a-z]+) ([0-9]{1,2}),? ([0-9]{4})$');
  day:=make_date(date_parts[3]::integer,array_position(array['january','february','march','april','may','june','july','august','september','october','november','december'],date_parts[1]),date_parts[2]::integer);
 end if;
 start_local:=day+make_time(parts[2]::integer%12+case when parts[4]='pm' then 12 else 0 end,coalesce(parts[3],'0')::integer,0);
 if parts[5] is not null then end_local:=day+make_time(parts[5]::integer%12+case when parts[7]='pm' then 12 else 0 end,coalesce(parts[6],'0')::integer,0);end if;
 start_at:=start_local at time zone zone;end_at:=end_local at time zone zone;
 if start_at<=p_at or start_at>p_at+interval '90 days' or (end_at is not null and (end_at<=start_at or end_at-start_at>interval '12 hours')) then return null;end if;
 -- Reject DST gaps and repeated local times; require a clarified time instead.
 if start_at at time zone zone<>start_local or (start_at-interval '1 hour') at time zone zone=start_local or (start_at+interval '1 hour') at time zone zone=start_local
 or (end_at is not null and (end_at at time zone zone<>end_local or (end_at-interval '1 hour') at time zone zone=end_local or (end_at+interval '1 hour') at time zone zone=end_local)) then return null;end if;
 return jsonb_build_object('startsAt',start_at,'endsAt',end_at,'timezone',zone);
exception when datetime_field_overflow or invalid_datetime_format then return null;
end $$;

create function public.icash_capture_seller_viewing(p_account uuid,p_deal uuid,p_thread uuid,p_source text,p_id uuid,p_turns jsonb,p_at timestamptz) returns void
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;turn jsonb;previous text:='';answer text;quote text:='';slots jsonb:='[]';slot jsonb;slot_state text:='available';candidate boolean;correction boolean;has_schedule boolean;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and deal_id=p_deal and party='seller' and retired_at is null;if not found then return;end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing');
 if not found or coalesce(d.terms->>'practice','false')='true' or not exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode) then return;end if;
 if jsonb_typeof(p_turns) is distinct from 'array' or jsonb_array_length(p_turns)>80 or p_at>now() or p_at<now()-interval '30 days' then return;end if;
 has_schedule:=exists(select 1 from public.icash_seller_viewing_availability where account_id=p_account and deal_id=p_deal and stated_at<=p_at);
 for turn in select value from jsonb_array_elements(p_turns) loop
  answer:=btrim(turn->>'message');
  if turn->>'role'='agent' then previous:=answer;continue;end if;
  if turn->>'role'<>'user' or length(answer) not between 1 and 1500 then continue;end if;
  correction:=(quote<>'' or has_schedule) and answer ~* '^((actually[, ]+)?make it|change (it|that) to|instead)\M';
  candidate:=correction or (previous ~* '\m(viewing|viewings|showing|showings|visit|tour|access)\M' and previous ~* '\m(day|days|date|dates|time|times|when|available|availability|works|work|window|windows)\M')
   or (answer ~* '\m(viewing|viewings|showing|showings|visit|tour)\M' and answer ~* '\m(available|cancel|cannot|can''t|works|work|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\M');
  if not candidate or answer ~* '^(yes|yeah|yep|correct|that works|those work|ok|okay|thanks|thank you)[.! ]*$' then continue;end if;
  if answer !~ '[[:alnum:]]' then continue;end if;
  quote:=left(case when quote='' then answer else quote||E'\n'||answer end,4000);
  if correction then
   -- Hold a changed time until the complete replacement is clarified. Never
   -- keep advertising the old slot merely because the word viewing was omitted.
   slots:='[]';slot_state:='needs_review';
  elsif answer ~* '\m(cancel|unavailable|cannot|can''t|not|don''t|do not|no longer|never)\M' then
   slots:='[]';slot_state:=case when answer ~* '\m(cancel|no longer|unavailable)\M' then 'withdrawn' else 'needs_review' end;
  else
   slot:=public.icash_parse_viewing_slot(answer,p_at);
   if slot is null then slot_state:='needs_review';slots:='[]';
   else
    if slot_state<>'available' then slots:='[]';end if;
    slot_state:='available';
    if jsonb_array_length(slots)<8 then slots:=slots||jsonb_build_array(slot);end if;
   end if;
  end if;
 end loop;
 if quote='' then return;end if;
 if slot_state<>'available' then slots:='[]';end if;
 insert into public.icash_seller_viewing_availability(account_id,deal_id,screening_id,thread_id,source,source_id,quote,slots,state,timezone,stated_at)
 values(p_account,p_deal,d.screening_id,t.id,p_source,p_id,quote,slots,slot_state,t.timezone,p_at) on conflict do nothing;
end $$;

create function public.icash_current_viewing_slots(p_account uuid,p_deal uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce((select jsonb_agg(slot) from (
  select value slot from jsonb_array_elements(coalesce((select slots from public.icash_seller_viewing_availability where account_id=p_account and deal_id=p_deal order by stated_at desc,created_at desc,id desc limit 1),'[]'))
  where (value->>'startsAt')::timestamptz>now() and (value->>'startsAt')::timestamptz<now()+interval '90 days'
 ) active),'[]')
$$;
alter function public.icash_buyer_package_data(uuid,uuid) rename to icash_buyer_package_before_viewing_slots;
create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select public.icash_buyer_package_before_viewing_slots(p_account,p_deal)||jsonb_build_object('viewingSlots',public.icash_current_viewing_slots(p_account,p_deal))
$$;

-- Owner can normalize an unclear seller statement or withdraw old availability.
-- This records seller availability only, never a confirmed buyer appointment.
create function public.icash_save_viewing_slots(p_account uuid,p_actor uuid,p_deal uuid,p_key uuid,p_quote text,p_slots jsonb,p_timezone text) returns uuid
language plpgsql security definer set search_path='' as $$
declare d public.icash_deal_files;slot jsonb;parsed jsonb;all_slots jsonb:='[]';old public.icash_seller_viewing_availability;n uuid;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Account owner required';end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing') or not exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode) then raise exception 'Signed deal required';end if;
 if p_key is null or p_quote is null or length(btrim(p_quote)) not between 1 and 4000 or jsonb_typeof(p_slots) is distinct from 'array' or jsonb_array_length(p_slots)>8 or p_timezone not in ('America/Chicago','America/New_York','America/Denver','America/Los_Angeles','UTC') then raise exception 'Seller statement and valid viewing times required';end if;
 for slot in select value from jsonb_array_elements(p_slots) loop
  if jsonb_typeof(slot) is distinct from 'string' then raise exception 'Use exact dates, AM/PM and timezone';end if;
  parsed:=public.icash_parse_viewing_slot(slot#>>'{}',now());if parsed is null then raise exception 'A viewing time is invalid, past or ambiguous';end if;
  all_slots:=all_slots||jsonb_build_array(parsed);
 end loop;
 select * into old from public.icash_seller_viewing_availability where source='owner' and source_id=p_key;
 if found then
  if old.account_id<>p_account or old.deal_id<>p_deal or old.quote<>btrim(p_quote) or old.slots<>all_slots then raise exception 'Availability key conflict';end if;
  return old.id;
 end if;
 insert into public.icash_seller_viewing_availability(account_id,deal_id,screening_id,source,source_id,quote,slots,state,timezone,stated_at,confirmed_by)
 values(p_account,p_deal,d.screening_id,'owner',p_key,btrim(p_quote),all_slots,case when jsonb_array_length(all_slots)=0 then 'withdrawn' else 'available' end,p_timezone,now(),p_actor) returning id into n;
 return n;
end $$;

alter function public.icash_save_seller_inbound_history(uuid,text,jsonb) rename to icash_save_seller_history_before_viewings;
create function public.icash_save_seller_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b icash_seller_agreement_private.inbound_bindings;at_time timestamptz;
begin
 if not public.icash_save_seller_history_before_viewings(p_session,p_conversation,p_transcript) then return false;end if;
 select completed_at into at_time from icash_seller_agreement_private.call_history where session_id=p_session and conversation_id=p_conversation and transcript=p_transcript;
 if not found then return false;end if;
 select * into b from icash_seller_agreement_private.inbound_bindings where session_id=p_session;
 perform public.icash_capture_seller_viewing(b.account_id,b.deal_id,b.thread_id,'call',p_session,p_transcript,at_time);
 return true;
end $$;

create function public.icash_capture_seller_viewing_call() returns trigger
language plpgsql security definer set search_path='' as $$
declare ids uuid[];t public.icash_text_threads;
begin
 if new.party<>'seller' or new.state<>'complete' or new.completed_at is null or new.operation_key not like 'voice:%' then return new;end if;
 if tg_op='UPDATE' and old.state='complete' then return new;end if;
 select array_agg(th.id) into ids from public.icash_text_threads th join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id
 where th.account_id=new.account_id and d.screening_id=new.screening_id and th.party='seller' and th.retired_at is null and encode(sha256(convert_to(th.recipient,'UTF8')),'hex')=new.contact_key;
 if cardinality(ids) is distinct from 1 then return new;end if;
 select * into t from public.icash_text_threads where id=ids[1];
 perform public.icash_capture_seller_viewing(t.account_id,t.deal_id,t.id,'outbound_call',new.id,new.result->'transcript',new.completed_at);
 return new;
end $$;
create trigger seller_viewing_completed_call after insert or update of state on public.icash_live_conversations for each row execute function public.icash_capture_seller_viewing_call();

-- Reuse the exact authenticated seller-call scope; no new call admission path.
alter function public.icash_call_offer_context(text,text) rename to icash_call_context_before_seller_viewings;
create function public.icash_call_offer_context(p_hash text,p_conversation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare scope jsonb;d public.icash_deal_files;
begin
 if exists(select 1 from icash_recorded_reception_private.sessions s join icash_recorded_reception_private.buyer_bindings b on b.session_id=s.id and b.account_id=s.account_id where s.stop_token_hash=p_hash and s.conversation_id=p_conversation) then
  return public.icash_call_context_before_seller_viewings(p_hash,p_conversation);
 end if;
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);
 if scope is not null then
  select * into d from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid and stage in ('under_contract','buyer_selected','title_open','closing');
  if found and exists(select 1 from public.icash_signing_envelopes where account_id=d.account_id and deal_id=d.id and kind='purchase' and state='completed' and not test_mode) then
   return scope||jsonb_build_object('party','seller','sellerContractSigned',true,'address',d.terms->>'address','viewingSlots',public.icash_current_viewing_slots(d.account_id,d.id));
  end if;
 end if;
 return public.icash_call_context_before_seller_viewings(p_hash,p_conversation);
end $$;

alter table public.icash_buyer_viewing_requests add column kind text not null default 'viewing' check(kind in ('viewing','reservation','payment_reported'));
create function public.icash_buyer_purchase_intent(p_turns jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;b text;intent jsonb;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  if turn->>'role'<>'user' then continue;end if;b:=btrim(turn->>'message');
  if length(b) not between 1 and 1500 then continue;end if;
  if b ~* '\m(stop|unsubscribe|cancel|not interested|no thanks)\M' then intent:=null;
  elsif b ~* '\m(i|we) (have |already |just )?(paid|sent|wired|zell[ae]d)\M' and b ~* '\m(deposit|emd|money|payment|funds)\M' then intent:=jsonb_build_object('kind','payment_reported','quote',b);
  elsif b !~* '\m(not ready|don''t want to pay|do not want to pay|won''t pay|cannot pay|can''t pay)\M'
   and (b ~* '\m(ready to|want to|would like to|can i|how (can|do) i) (pay|send|wire|reserve|buy|sign)\M' or b ~* '\m(send me|can you send) (the |an? )?(assignment|agreement|payment instructions)\M') then intent:=jsonb_build_object('kind','reservation','quote',b);end if;
 end loop;
 return intent;
end $$;
alter function public.icash_save_buyer_inbound_history(uuid,text,jsonb) rename to icash_save_buyer_history_before_purchase_intent;
create function public.icash_save_buyer_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare b icash_recorded_reception_private.buyer_bindings;t public.icash_text_threads;screen uuid;intent jsonb;
begin
 if not public.icash_save_buyer_history_before_purchase_intent(p_session,p_conversation,p_transcript) then return false;end if;
 intent:=public.icash_buyer_purchase_intent(p_transcript);if intent is null then return true;end if;
 select * into b from icash_recorded_reception_private.buyer_bindings where session_id=p_session;
 select * into t from public.icash_text_threads where id=b.thread_id and account_id=b.account_id and party='buyer';
 select screening_id into screen from public.icash_deal_files where id=b.deal_id and account_id=b.account_id;
 insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,timezone,kind)
 values(b.account_id,b.deal_id,screen,t.id,'call',p_session,intent->>'quote',t.timezone,intent->>'kind')
 on conflict(source,source_id) do update set kind=excluded.kind,quote=excluded.quote where icash_buyer_viewing_requests.state='needs_confirmation';
 return true;
end $$;

alter function public.icash_buyer_reception_calls(uuid,uuid[]) rename to icash_buyer_calls_before_purchase_intent;
create function public.icash_buyer_reception_calls(p_account uuid,p_screenings uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item||jsonb_build_object('summary',case request.kind
  when 'reservation' then 'Buyer requested the assignment agreement and deposit instructions. Viewing is optional.'
  when 'payment_reported' then 'Buyer reported a deposit payment. Receipt needs verification; this report does not reserve the property.'
  else item->>'summary' end) order by item->>'completed_at' desc),'[]')
 from jsonb_array_elements(public.icash_buyer_calls_before_purchase_intent(p_account,p_screenings)) item
 left join public.icash_buyer_viewing_requests request on request.account_id=p_account and request.source='call' and request.source_id=(item->>'id')::uuid
$$;

create function public.icash_capture_viewing_and_purchase_text() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;previous text;turns jsonb;intent jsonb;screen uuid;
begin
 if new.direction<>'incoming' or new.state<>'received' or new.thread_id is null then return new;end if;
 if tg_op='UPDATE' and old.thread_id is not distinct from new.thread_id then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and retired_at is null;if not found then return new;end if;
 select body into previous from public.icash_text_messages where thread_id=t.id and account_id=t.account_id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at<=new.created_at order by created_at desc,id desc limit 1;
 turns:=jsonb_build_array(jsonb_build_object('role','agent','message',coalesce(previous,'')),jsonb_build_object('role','user','message',new.body));
 if t.party='seller' then perform public.icash_capture_seller_viewing(t.account_id,t.deal_id,t.id,'text',new.id,turns,new.created_at);
 elsif t.party='buyer' and public.icash_buyer_package_data(t.account_id,t.deal_id) is not null then
  intent:=public.icash_buyer_purchase_intent(turns);
  if intent is not null then
   select screening_id into screen from public.icash_deal_files where account_id=t.account_id and id=t.deal_id;
   insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,timezone,kind)
   values(t.account_id,t.deal_id,screen,t.id,'text',new.id,intent->>'quote',t.timezone,intent->>'kind')
   on conflict(source,source_id) do update set kind=excluded.kind,quote=excluded.quote where icash_buyer_viewing_requests.state='needs_confirmation';
  end if;
 end if;
 return new;
end $$;
create trigger zz_viewing_and_purchase_text after insert or update of thread_id on public.icash_text_messages for each row execute function public.icash_capture_viewing_and_purchase_text();

-- Ask in the existing verified fully-signed notification, never resend a receipt.
create or replace function public.icash_signature_confirmation_body(p_kind text,p_address text) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare body text;street text:=public.icash_conversation_street(p_address);
begin
 if p_kind='seller_signed' then
  body:='Thanks, your signature for '||street||' is in. We will text you when everyone has signed.';
  if not public.icash_sms_single_segment(body) then body:='Thanks, your signature is in. We will text you when everyone has signed.';end if;
 elsif p_kind='fully_signed' then
  body:='All signatures are in for '||street||'. What dates, times with AM/PM, and time zone work for property viewings?';
  if not public.icash_sms_single_segment(body) then body:='All signatures are in. What dates, times with AM/PM, and time zone work for property viewings?';end if;
 end if;return body;
end $$;
update public.icash_text_messages m set body=public.icash_signature_confirmation_body(n.kind,e.terms->>'address')
from public.icash_signature_confirmation_texts n join public.icash_signing_envelopes e on e.id=n.envelope_id and e.account_id=n.account_id
where m.id=n.message_id and m.account_id=n.account_id and n.kind='fully_signed' and m.state='ready' and m.provider_id is null and m.last_delivery_at is null;

-- Continue only the signed seller's existing permitted, correctly routed thread.
-- Viewing availability does not restart acquisition or authorize a callback.
create function public.icash_seller_viewing_context(p_account uuid,p_thread uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) or public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing') and coalesce(terms->>'practice','false')<>'true';
 if not found or not exists(select 1 from public.icash_signing_envelopes e cross join lateral jsonb_array_elements(e.recipients) with ordinality r(value,n)
  where e.deal_id=d.id and e.account_id=p_account and e.kind='purchase' and e.state='completed' and not e.test_mode and e.provider_id is not null
  and e.terms->'address'=d.terms->'address' and e.terms->'priceCents'=d.terms->'priceCents' and r.n<jsonb_array_length(e.recipients) and r.value->>'phone'=t.recipient) then return null;end if;
 if not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and not needs_review)
 or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
 or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex'))
 or exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=d.screening_id and pc.account_id=p_account and pc.manual)
 or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=d.screening_id and state<>'resolved') then return null;end if;
 return jsonb_build_object('sellerConversation',true,'sellerViewingAvailability',true,'address',d.terms->>'address','timezone',t.timezone,'offerAuthorized',false);
end $$;
alter function public.icash_seller_conversation_context(uuid,uuid) rename to icash_seller_context_before_viewings;
create function public.icash_seller_conversation_context(p_account uuid,p_thread uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare ctx jsonb;
begin
 ctx:=public.icash_seller_viewing_context(p_account,p_thread);
 if ctx is not null then return ctx;end if;
 return public.icash_seller_context_before_viewings(p_account,p_thread);
end $$;
alter function public.icash_seller_conversation_reply(uuid,uuid) rename to icash_seller_reply_before_viewings;
create function public.icash_seller_conversation_reply(p_account uuid,p_job uuid) returns text
language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;v public.icash_seller_viewing_availability;
begin
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account and state in ('drafted','queued');
 if not found then return null;end if;
 if public.icash_seller_viewing_context(p_account,j.thread_id) is null then return public.icash_seller_reply_before_viewings(p_account,p_job);end if;
 if j.analysis->'humanRequested'='true'::jsonb or j.analysis->'callbackRequested'='true'::jsonb or j.analysis->'callRequested'='true'::jsonb or j.analysis->'optedOut'='true'::jsonb or j.analysis->'declined'='true'::jsonb then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 select * into m from public.icash_text_messages where id=j.message_id and thread_id=t.id and account_id=p_account and direction='incoming' and state='received';
 if not found or m.created_at>now() or length(m.body)>=1000 or m.body ~* '\m(stop|unsubscribe|human|real person|call me|callback|call back|phone call|talk to|speak to)\M' then return null;end if;
 if not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and not needs_review and revision=m.route_revision)
 or exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.id<>m.id and x.id is distinct from j.outgoing_id and x.created_at>=m.created_at) then return null;end if;
 select * into v from public.icash_seller_viewing_availability where account_id=p_account and thread_id=t.id and source='text' and source_id=m.id;
 if not found then return null;end if;
 if v.state='available' then return 'Thanks. I saved those seller viewing times. We will confirm a specific visit with you before anyone comes.';
 elsif v.state='withdrawn' then return 'Those seller viewing times are withdrawn. We will confirm new availability with you before arranging a visit.';
 else return 'What exact calendar date, start and end times with AM or PM, and time zone work for a property viewing?';end if;
end $$;
alter function public.icash_queue_seller_conversation_reply(uuid,uuid) rename to icash_queue_seller_reply_before_viewings;
create function public.icash_queue_seller_conversation_reply(p_account uuid,p_job uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 if found and j.state='drafted' and j.outgoing_id is null and public.icash_seller_viewing_context(p_account,j.thread_id) is not null then
  if public.icash_seller_conversation_reply(p_account,p_job) is null then return null;end if;
  update public.icash_text_ai_jobs set analysis=jsonb_set(analysis,'{action}','"review"') where id=j.id;
 end if;
 return public.icash_queue_seller_reply_before_viewings(p_account,p_job);
end $$;

alter function public.icash_buyer_factual_text(uuid,uuid,text) rename to icash_buyer_factual_before_purchase_terms;
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;p jsonb;b text;amount bigint;intent jsonb;slots jsonb;slot jsonb;availability text:='';answer text;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer';if not found or length(p_incoming)>400 then return null;end if;
 p:=public.icash_buyer_package_data(p_account,t.deal_id);if p is null then return null;end if;
 if p->'reserved'='true'::jsonb then return 'This property is reserved. We are not accepting another deposit. Contact the team about an existing agreement.';end if;
 b:=lower(btrim(regexp_replace(p_incoming,'[?!.]+\s*$','','g')));amount:=(p->>'depositCents')::bigint;
 intent:=public.icash_buyer_purchase_intent(jsonb_build_array(jsonb_build_object('role','user','message',p_incoming)));
 if intent->>'kind'='payment_reported' then return 'Your payment report is saved for verification. The property is reserved only after the signed assignment and cleared deposit are confirmed.';end if;
 if intent->>'kind'='reservation' or b ~ '^(what is|what''s|whats|how much is) (the )?(non.refundable )?(deposit|emd)$|^(deposit|emd)$' then
  if amount is null or amount not between 1 and 500000 then return 'The team needs to confirm the deposit amount in the assignment agreement before payment.';end if;
  return 'The non-refundable deposit is $'||to_char(amount::numeric/100,'FM999,990.00')||' under the assignment agreement, credited toward the included assignment fee. Viewing is optional. Sign the assignment and request verified payment details. Cleared funds must be confirmed to reserve the property.';
 elsif b ~ '^(how (can|do) i pay|what payment methods( do you accept)?|can i pay (by |with )?(check|wire|cash ?app|zelle))$' then
  return 'Payment choices are check, wire, Cash App or Zelle. Request verified receiving details from the deal contact after agreement review. A payment claim alone does not reserve the property.';
 elsif b ~ '^(do i (have|need) to (see|view|visit) (the property|it)|can i (skip (the )?(viewing|visit)|buy without (a )?viewing)|i (don''t|do not) (want|need) to (see|view|visit) (the property|it))$' then
  return 'Viewing is optional. You can proceed with the assignment agreement and deposit. Would you like the agreement and verified payment instructions?';
 elsif b ~ '^(when (can i|is it possible to) (see|view|visit) (the property|it)|what (times|days|viewing times) are available|can i (see|view|visit) (the property|it))$' then
  slots:=p->'viewingSlots';
  for slot in select value from jsonb_array_elements(coalesce(slots,'[]')) limit 2 loop
   availability:=availability||case when availability='' then '' else '; ' end||to_char((slot->>'startsAt')::timestamptz at time zone (slot->>'timezone'),'FMMon FMDD, YYYY FMHH12:MI AM')||case when slot->>'endsAt' is null then '' else ' to '||to_char((slot->>'endsAt')::timestamptz at time zone (slot->>'timezone'),'FMHH12:MI AM') end||' '||(slot->>'timezone');
  end loop;
  if availability<>'' then return 'Seller viewing options: '||availability||'. Which works for you? The specific visit still needs confirmation.';end if;
  return 'We can coordinate a viewing. What date, time with AM/PM, and timezone work for you? Access still needs seller confirmation. Viewing is optional.';
 end if;
 return public.icash_buyer_factual_before_purchase_terms(p_account,p_thread,p_incoming);
end $$;

revoke all on function public.icash_capture_seller_viewing(uuid,uuid,uuid,text,uuid,jsonb,timestamptz),public.icash_capture_viewing_and_purchase_text(),public.icash_capture_seller_viewing_call(),public.icash_call_context_before_seller_viewings(text,text),public.icash_save_seller_history_before_viewings(uuid,text,jsonb),public.icash_save_buyer_history_before_purchase_intent(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.icash_call_offer_context(text,text) from public,anon,authenticated;
grant execute on function public.icash_call_offer_context(text,text) to service_role;
revoke all on function public.icash_buyer_reception_calls(uuid,uuid[]),public.icash_buyer_calls_before_purchase_intent(uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.icash_buyer_reception_calls(uuid,uuid[]) to service_role;
revoke all on function public.icash_seller_viewing_context(uuid,uuid),public.icash_seller_conversation_context(uuid,uuid),public.icash_seller_context_before_viewings(uuid,uuid),public.icash_seller_conversation_reply(uuid,uuid),public.icash_seller_reply_before_viewings(uuid,uuid),public.icash_queue_seller_conversation_reply(uuid,uuid),public.icash_queue_seller_reply_before_viewings(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_viewing_context(uuid,uuid),public.icash_seller_conversation_context(uuid,uuid),public.icash_seller_conversation_reply(uuid,uuid),public.icash_queue_seller_conversation_reply(uuid,uuid) to service_role;
revoke all on function public.icash_parse_viewing_slot(text,timestamptz),public.icash_current_viewing_slots(uuid,uuid),public.icash_save_viewing_slots(uuid,uuid,uuid,uuid,text,jsonb,text),public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_package_before_viewing_slots(uuid,uuid),public.icash_save_seller_inbound_history(uuid,text,jsonb),public.icash_buyer_purchase_intent(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb),public.icash_buyer_factual_text(uuid,uuid,text),public.icash_buyer_factual_before_purchase_terms(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_parse_viewing_slot(text,timestamptz),public.icash_current_viewing_slots(uuid,uuid),public.icash_save_viewing_slots(uuid,uuid,uuid,uuid,text,jsonb,text),public.icash_buyer_package_data(uuid,uuid),public.icash_save_seller_inbound_history(uuid,text,jsonb),public.icash_buyer_purchase_intent(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb),public.icash_buyer_factual_text(uuid,uuid,text) to service_role;
commit;
