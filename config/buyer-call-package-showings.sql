begin;
set local lock_timeout='3s';
-- A buyer's initial property match must survive registration. The old price
-- tool incorrectly called the pre-registration-only context function again.
create table icash_recorded_reception_private.buyer_bindings(
 session_id uuid primary key references icash_recorded_reception_private.sessions(id),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 thread_id uuid not null references public.icash_text_threads(id),created_at timestamptz not null default now()
);
create table icash_recorded_reception_private.buyer_history(
 session_id uuid primary key references icash_recorded_reception_private.buyer_bindings(session_id),
 account_id uuid not null,screening_id uuid not null,conversation_id text not null,
 completed_at timestamptz not null,transcript jsonb not null
);
alter table icash_recorded_reception_private.buyer_bindings enable row level security;
alter table icash_recorded_reception_private.buyer_history enable row level security;
revoke all on icash_recorded_reception_private.buyer_bindings,icash_recorded_reception_private.buyer_history from public,anon,authenticated,service_role;
create trigger buyer_binding_immutable before update or delete on icash_recorded_reception_private.buyer_bindings for each row execute function icash_recorded_reception_private.immutable();
create trigger buyer_binding_no_truncate before truncate on icash_recorded_reception_private.buyer_bindings for each statement execute function icash_recorded_reception_private.immutable();
create index buyer_history_account_screen on icash_recorded_reception_private.buyer_history(account_id,screening_id,completed_at desc);

-- Correct the escaped literal plus without changing any other admission rule.
do $patch$ declare definition text; begin
 definition:=pg_get_functiondef('public.icash_reception_context_before_agreement(uuid,text)'::regprocedure);
 execute replace(definition,$bad$'^\\+[1-9][0-9]{7,14}$'$bad$,$good$'^[+][1-9][0-9]{7,14}$'$good$);
end $patch$;

alter function public.icash_recorded_reception_property_context(uuid,text) rename to icash_reception_context_before_buyer_binding;
create function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare context jsonb;s icash_recorded_reception_private.sessions;ids uuid[];t public.icash_text_threads;focus uuid;package jsonb;
begin
 context:=public.icash_reception_context_before_buyer_binding(p_id,p_nonce_hash);
 if context is null or context->>'status'<>'buyer' then return context;end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_id and nonce_hash=p_nonce_hash
 and state='recording' and register_claimed_at is null and conversation_id is null and call_ended_at is null and end_requested_at is null and call_deadline_at>now();
 if not found then return null;end if;
 focus:=icash_recorded_reception_private.return_call_focus(s.account_id,s.from_phone,now());
 select array_agg(th.id) into ids from public.icash_text_threads th join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id
 where th.account_id=s.account_id and th.party='buyer' and th.recipient=s.from_phone and th.retired_at is null and not th.paused and not th.manual_only
 and (focus is null or th.id=focus) and (th.owner_buyer_test_id is null or public.icash_owner_buyer_test_current(th.owner_buyer_test_id))
 and d.terms->>'address'=context->>'address'
 and exists(select 1 from public.icash_text_messages m where m.thread_id=th.id and m.account_id=th.account_id and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at between now()-interval '30 days' and now());
 if cardinality(ids) is distinct from 1 then return null;end if;
 select * into t from public.icash_text_threads where id=ids[1];
 package:=public.icash_buyer_package_data(s.account_id,t.deal_id);
 if package is null then return null;end if;
 insert into icash_recorded_reception_private.buyer_bindings(session_id,account_id,deal_id,thread_id) values(s.id,s.account_id,t.deal_id,t.id) on conflict do nothing;
 if not exists(select 1 from icash_recorded_reception_private.buyer_bindings where session_id=s.id and account_id=s.account_id and deal_id=t.deal_id and thread_id=t.id) then return null;end if;
 return context||jsonb_build_object('closingDate',package->'closingDate','viewingStatus','request_confirmation');
end $$;

alter function public.icash_call_offer_context(text,text) rename to icash_call_offer_context_before_buyer_binding;
create function public.icash_call_offer_context(p_hash text,p_conversation text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare s icash_recorded_reception_private.sessions;b icash_recorded_reception_private.buyer_bindings;t public.icash_text_threads;package jsonb;
begin
 if coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_conversation,'') !~ '^conv_[A-Za-z0-9]+$' then return null;end if;
 select r.* into s from icash_recorded_reception_private.sessions r join icash_recorded_reception_private.buyer_bindings x on x.session_id=r.id and x.account_id=r.account_id
 where r.stop_token_hash=p_hash and r.conversation_id=p_conversation;
 if not found then return public.icash_call_offer_context_before_buyer_binding(p_hash,p_conversation);end if;
 if not exists(select 1 from public.icash_accounts where id=s.account_id and not bot_paused) or not public.icash_membership_work_allowed(s.account_id) or s.state<>'recording' or s.call_ended_at is not null or s.end_requested_at is not null or s.call_deadline_at<=now() or public.icash_seller_agreement_recording(p_hash) is null then return null;end if;
 select * into b from icash_recorded_reception_private.buyer_bindings where session_id=s.id;
 select * into t from public.icash_text_threads where id=b.thread_id and account_id=s.account_id and deal_id=b.deal_id and recipient=s.from_phone and party='buyer' and retired_at is null and not paused and not manual_only;
 if not found or (t.owner_buyer_test_id is not null and not public.icash_owner_buyer_test_current(t.owner_buyer_test_id)) then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=s.from_phone)
 or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(s.from_phone,'UTF8')),'hex'))
 or exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id join public.icash_property_controls pc on pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual where d.id=b.deal_id and d.account_id=b.account_id) then return null;end if;
 package:=public.icash_buyer_package_data(s.account_id,b.deal_id);
 if package is null then return null;end if;
 return jsonb_build_object('party','buyer','accountId',s.account_id,'dealId',b.deal_id,'buyer',package||jsonb_build_object('buyerPaysClosingCosts',true,'viewingStatus','request_confirmation'));
end $$;

-- Package media comes only from this deal's ID-bound property research and
-- incoming messages on its seller threads. The renderer validates CDN/MIME.
alter function public.icash_buyer_package_data(uuid,uuid) rename to icash_buyer_package_before_photos;
create function public.icash_buyer_package_data(p_account uuid,p_deal uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare package jsonb;media jsonb;
begin
 package:=public.icash_buyer_package_before_photos(p_account,p_deal);if package is null then return null;end if;
 select jsonb_build_object('propertyImages',sc.snapshot->'raw'->'data'->'images','latitude',sc.snapshot->'raw'->'data'->'latitude','longitude',sc.snapshot->'raw'->'data'->'longitude') into media
 from public.icash_deal_files d join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and sc.snapshot->>'propertyId'=sc.snapshot->'raw'->'data'->>'dm_property_id';
 return package||coalesce(media,'{}'::jsonb)||jsonb_build_object('sellerPhotos',coalesce((
  select jsonb_agg(attachment order by created_at,mid,position) from (
   select a.value attachment,m.created_at,m.id mid,a.ordinality position from public.icash_text_messages m
   join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   cross join lateral jsonb_array_elements(case when jsonb_typeof(m.attachments)='array' then m.attachments else '[]'::jsonb end) with ordinality a
   where t.account_id=p_account and t.deal_id=p_deal and t.party='seller' and m.direction='incoming' and m.state='received'
  ) photos
 ),'[]'::jsonb));
end $$;

create table public.icash_buyer_viewing_requests(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),screening_id uuid not null references public.icash_screening_jobs(id),
 thread_id uuid not null references public.icash_text_threads(id),source text not null check(source in ('call','text')),
 source_id uuid not null,quote text not null check(length(quote) between 1 and 4000),
 timezone text not null,state text not null default 'needs_confirmation' check(state in ('needs_confirmation','reviewed')),
 created_at timestamptz not null default now(),reviewed_at timestamptz,unique(source,source_id)
);
alter table public.icash_buyer_viewing_requests enable row level security;
revoke all on public.icash_buyer_viewing_requests from public,anon,authenticated;
grant select,update on public.icash_buyer_viewing_requests to service_role;
create index buyer_viewing_attention on public.icash_buyer_viewing_requests(account_id,state,created_at);

-- Returns an exact caller quote, never a model-generated appointment or date.
create function public.icash_buyer_viewing_quote(p_transcript jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare t jsonb;previous text:='';request text;answer text;
begin
 if jsonb_typeof(p_transcript) is distinct from 'array' then return null;end if;
 for t in select value from jsonb_array_elements(p_transcript) loop
  answer:=btrim(t->>'message');
  if t->>'role'='user' and length(answer) between 1 and 1500 then
   if answer ~* '\m(no|not|never|don''t|do not|cancel|cannot|can''t)\M' then
    if answer ~* '\m(see|view|visit|tour|showing|interested|cancel)\M' or lower(answer) ~ '^no[.! ]*$' then request:=null;
    elsif request is not null and previous ~* '\m(day|time|when|timezone|date)\M' then request:=left(request||E'\n'||answer,4000);end if;
   elsif answer ~* '\m(see|view|visit|tour|showing|walk through)\M' and answer ~* '\m(property|house|home|it|this|showing|tour|walk through)\M'
    or (previous ~* '\m(see|view|visit|tour|showing)\M' and previous ~* '\m(when|day|time|like|want|schedule)\M' and answer !~* '^(thanks|thank you|okay|ok)[.! ]*$') then
    request:=case when request is null then answer else left(request||E'\n'||answer,4000) end;
   elsif request is not null and previous ~* '\m(day|time|when|timezone|date)\M' then
    request:=left(request||E'\n'||answer,4000);
   end if;
  end if;
  if t->>'role'='agent' then previous:=answer;end if;
 end loop;
 return request;
end $$;

create function public.icash_save_buyer_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare s icash_recorded_reception_private.sessions;b icash_recorded_reception_private.buyer_bindings;screen uuid;t public.icash_text_threads;quote text;
begin
 if jsonb_typeof(p_transcript) is distinct from 'array' or jsonb_array_length(p_transcript) not between 1 and 80
 or exists(select 1 from jsonb_array_elements(p_transcript) turn where jsonb_typeof(turn) is distinct from 'object' or coalesce(turn->>'role','') not in ('agent','user') or jsonb_typeof(turn->'message') is distinct from 'string' or length(turn->>'message')>12000 or turn-array['role','message']<>'{}'::jsonb) then return false;end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation and call_ended_at between now()-interval '30 days' and now();if not found then return false;end if;
 select * into b from icash_recorded_reception_private.buyer_bindings where session_id=s.id and account_id=s.account_id;if not found then return false;end if;
 select * into t from public.icash_text_threads where id=b.thread_id and account_id=b.account_id and deal_id=b.deal_id and party='buyer' and recipient=s.from_phone;if not found then return false;end if;
 select screening_id into screen from public.icash_deal_files where id=b.deal_id and account_id=b.account_id;if screen is null then return false;end if;
 insert into icash_recorded_reception_private.buyer_history values(s.id,s.account_id,screen,s.conversation_id,s.call_ended_at,p_transcript) on conflict do nothing;
 -- Replayed callbacks cannot replace evidence or reopen a reviewed request.
 if not exists(select 1 from icash_recorded_reception_private.buyer_history where session_id=s.id and transcript=p_transcript) then return false;end if;
 quote:=public.icash_buyer_viewing_quote(p_transcript);
 if quote is not null then insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,timezone)
 values(s.account_id,b.deal_id,screen,t.id,'call',s.id,quote,t.timezone) on conflict do nothing;end if;
 return true;
end $$;

create function public.icash_buyer_reception_calls(p_account uuid,p_screenings uuid[]) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by completed_at desc),'[]'::jsonb) from (
  select h.completed_at,jsonb_build_object('id',s.id,'screening_id',h.screening_id,'source','reception','party','buyer','completed_at',h.completed_at,'durationSeconds',s.duration_seconds,
  'summary',case when exists(select 1 from public.icash_buyer_viewing_requests v where v.source='call' and v.source_id=s.id) then 'Buyer asked to view the property. Review their requested time and confirm access.' else 'Incoming buyer call about this property. Open the transcript for details.' end) item
  from icash_recorded_reception_private.buyer_history h join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id and s.conversation_id=h.conversation_id
  where h.account_id=p_account and h.screening_id=any(p_screenings) order by h.completed_at desc limit 24
 ) calls;
$$;
alter function public.icash_reception_conversation(uuid,uuid,integer) rename to icash_reception_conversation_before_buyer;
create function public.icash_reception_conversation(p_account uuid,p_session uuid,p_before integer default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare turns jsonb;finish integer;
begin
 if p_before is not null and p_before not between 0 and 100000 then return null;end if;
 select transcript into turns from icash_recorded_reception_private.buyer_history where account_id=p_account and session_id=p_session;
 if not found then return public.icash_reception_conversation_before_buyer(p_account,p_session,p_before);end if;
 finish:=least(coalesce(p_before,jsonb_array_length(turns)),jsonb_array_length(turns));
 return jsonb_build_object('party','buyer','transcript',coalesce((select jsonb_agg(t.value order by t.position) from jsonb_array_elements(turns) with ordinality t(value,position) where position>greatest(0,finish-60) and position<=finish),'[]'::jsonb),'next',case when finish>60 then finish-60 else null end);
end $$;
alter function public.icash_thread_calls(uuid,uuid,timestamptz,timestamptz) rename to icash_thread_calls_before_buyer;
create function public.icash_thread_calls(p_account uuid,p_thread uuid,p_before timestamptz default null,p_after timestamptz default null) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by item->>'completedAt' desc),'[]'::jsonb) from (
  select item from (
   select value item from jsonb_array_elements(public.icash_thread_calls_before_buyer(p_account,p_thread,p_before,p_after))
   union all
   select jsonb_build_object('id',h.session_id,'source','reception','party','buyer','completedAt',h.completed_at,'durationSeconds',s.duration_seconds,'summary','Incoming buyer call about this property.')
   from icash_recorded_reception_private.buyer_history h join icash_recorded_reception_private.buyer_bindings b on b.session_id=h.session_id and b.account_id=h.account_id
   join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id and s.conversation_id=h.conversation_id
   where h.account_id=p_account and b.thread_id=p_thread and (p_before is null or h.completed_at<p_before) and (p_after is null or h.completed_at>=p_after)
  ) all_calls order by item->>'completedAt' desc limit 20
 ) recent;
$$;

revoke all on function public.icash_reception_context_before_buyer_binding(uuid,text),public.icash_call_offer_context_before_buyer_binding(text,text),public.icash_reception_conversation_before_buyer(uuid,uuid,integer),public.icash_thread_calls_before_buyer(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.icash_buyer_package_before_photos(uuid,uuid) from public,anon,authenticated;
revoke all on function public.icash_recorded_reception_property_context(uuid,text),public.icash_call_offer_context(text,text),public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_viewing_quote(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb),public.icash_buyer_reception_calls(uuid,uuid[]),public.icash_reception_conversation(uuid,uuid,integer),public.icash_thread_calls(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_recorded_reception_property_context(uuid,text),public.icash_call_offer_context(text,text),public.icash_buyer_package_data(uuid,uuid),public.icash_buyer_viewing_quote(jsonb),public.icash_save_buyer_inbound_history(uuid,text,jsonb),public.icash_buyer_reception_calls(uuid,uuid[]),public.icash_reception_conversation(uuid,uuid,integer),public.icash_thread_calls(uuid,uuid,timestamptz,timestamptz) to service_role;

create function public.icash_capture_buyer_viewing_text() returns trigger
language plpgsql security definer set search_path='' as $$
declare t public.icash_text_threads;screen uuid;quote text;previous text;request public.icash_buyer_viewing_requests;
begin
 if new.direction<>'incoming' or new.state<>'received' or new.thread_id is null then return new;end if;
 if tg_op='UPDATE' and old.thread_id is not distinct from new.thread_id then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and party='buyer' and retired_at is null;if not found then return new;end if;
 if public.icash_buyer_package_data(t.account_id,t.deal_id) is null then return new;end if;
 select screening_id into screen from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;
 select body into previous from public.icash_text_messages where thread_id=t.id and account_id=t.account_id and direction='outgoing' and state in ('accepted','delivered') and created_at<=new.created_at order by created_at desc,id desc limit 1;
 quote:=public.icash_buyer_viewing_quote(jsonb_build_array(jsonb_build_object('role','agent','message',coalesce(previous,'')),jsonb_build_object('role','user','message',new.body)));
 if quote is null then return new;end if;
 insert into public.icash_buyer_viewing_requests(account_id,deal_id,screening_id,thread_id,source,source_id,quote,timezone)
 values(t.account_id,t.deal_id,screen,t.id,'text',new.id,quote,t.timezone) on conflict do nothing;
 return new;
end $$;
create trigger buyer_viewing_text after insert or update of thread_id on public.icash_text_messages for each row execute function public.icash_capture_buyer_viewing_text();
revoke all on function public.icash_capture_buyer_viewing_text() from public,anon,authenticated,service_role;

alter function public.icash_buyer_factual_text(uuid,uuid,text) rename to icash_buyer_factual_text_before_showing;
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text
language plpgsql stable security invoker set search_path='' as $$
declare request public.icash_buyer_viewing_requests;previous text;
begin
 select v.* into request from public.icash_buyer_viewing_requests v join public.icash_text_messages m on m.id=v.source_id and m.thread_id=v.thread_id and m.account_id=v.account_id
 where v.account_id=p_account and v.thread_id=p_thread and v.source='text' and m.body=p_incoming and m.created_at>now()-interval '24 hours' order by m.created_at desc limit 1;
 if found then
  if p_incoming ~* '\m(am|pm|morning|afternoon|evening|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\M|[0-9]' then
   return 'Your viewing request is saved for coordination. Seller or occupant confirmation is still needed before the visit is booked.';
  end if;
  return 'We can help coordinate a viewing. What day, time and timezone work for you? The visit needs seller or occupant confirmation.';
 end if;
 return public.icash_buyer_factual_text_before_showing(p_account,p_thread,p_incoming);
end $$;
revoke all on function public.icash_buyer_factual_text_before_showing(uuid,uuid,text),public.icash_buyer_factual_text(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_buyer_factual_text(uuid,uuid,text) to service_role;
commit;
