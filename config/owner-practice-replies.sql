-- Explicit, short owner-only diagnostics; not a production acquisition budget bypass.
create table public.icash_owner_reply_sessions(
 thread_id uuid primary key references public.icash_text_threads(id),
 enabled boolean not null default false,expires_at timestamptz not null,
 remaining integer not null check(remaining between 0 and 6),authorization_ref text not null check(length(authorization_ref)>20)
);
create table public.icash_owner_reply_attempts(
 id uuid primary key default gen_random_uuid(),message_id uuid not null unique references public.icash_text_messages(id),
 thread_id uuid not null references public.icash_owner_reply_sessions(thread_id),
 state text not null default 'analyzing' check(state in ('analyzing','dispatching','accepted','held')),
 result jsonb,outgoing_id uuid references public.icash_text_messages(id),
 cost_micros bigint check(cost_micros>=0),created_at timestamptz not null default now()
);
alter table public.icash_owner_reply_sessions enable row level security;
alter table public.icash_owner_reply_attempts enable row level security;
revoke all on public.icash_owner_reply_sessions,public.icash_owner_reply_attempts from public,anon,authenticated;
grant all on public.icash_owner_reply_sessions,public.icash_owner_reply_attempts to service_role;
create function public.icash_claim_owner_reply(p_event text) returns jsonb language plpgsql set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;s public.icash_owner_reply_sessions;j uuid;history jsonb;
begin
 select * into m from public.icash_text_messages where event_id=p_event and direction='incoming';
 if not found then return null;end if;
 select * into s from public.icash_owner_reply_sessions where thread_id=m.thread_id for update;
 if not found or not s.enabled or s.expires_at<=now() or s.remaining<=0 then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id;
 if not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=t.account_id and terms->>'practice'='true') then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then
 update public.icash_owner_reply_sessions set enabled=false where thread_id=t.id;return null;end if;
 if t.permission_until is null or t.permission_until<=now() or not exists(select 1 from public.icash_text_senders where phone=t.sender and enabled) then return null;end if;
 if exists(select 1 from public.icash_owner_reply_attempts where message_id=m.id or (thread_id=t.id and (state in ('analyzing','dispatching') or created_at>now()-interval '6 seconds'))) then return null;end if;
 if exists(select 1 from public.icash_text_messages where thread_id=t.id and created_at>m.created_at) then return null;end if;
 insert into public.icash_owner_reply_attempts(message_id,thread_id) values(m.id,t.id) returning id into j;
 update public.icash_owner_reply_sessions set remaining=remaining-1 where thread_id=t.id;
 select jsonb_agg(jsonb_build_object('direction',direction,'body',left(body,1000)) order by created_at) into history from (select direction,body,created_at from public.icash_text_messages where thread_id=t.id order by created_at desc limit 12) h;
 update public.icash_text_ai_jobs set state='analyzing' where message_id=m.id and state='pending';
 return jsonb_build_object('id',j,'account',t.account_id,'thread',t.id,'message',m.id,'messages',history,'attachments',jsonb_array_length(m.attachments)>0,'human',m.body ~* '\m(human|real person|speak to someone|talk to someone|call me|call back|callback)\M');
end $$;
create function public.icash_prepare_owner_reply(p_attempt uuid,p_action text,p_result jsonb) returns jsonb language plpgsql set search_path='' as $$
declare a public.icash_owner_reply_attempts;s public.icash_owner_reply_sessions;t public.icash_text_threads;body text;outgoing uuid;
begin
 select * into a from public.icash_owner_reply_attempts where id=p_attempt;
 if not found then return null;end if;
 select * into s from public.icash_owner_reply_sessions where thread_id=a.thread_id for update;
 select * into a from public.icash_owner_reply_attempts where id=p_attempt for update;
 select * into t from public.icash_text_threads where id=a.thread_id;
 if a.state<>'analyzing' then return null;end if;
 if not s.enabled or s.expires_at<=now() or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
 or exists(select 1 from public.icash_text_messages where thread_id=t.id and created_at>(select created_at from public.icash_text_messages where id=a.message_id)) then
 update public.icash_owner_reply_attempts set state='held',result=p_result where id=a.id;return null;end if;
 body:=case p_action
 when 'ask_condition' then 'What repairs or updates does the property need?'
 when 'ask_price' then 'What price did you have in mind?'
 when 'ask_timing' then 'When would you like to sell?'
 when 'ask_owners' then 'Are all property owners on board with selling?'
 when 'ask_occupancy' then 'Is the property vacant, owner occupied, or rented?'
 when 'ask_callback' then 'What date, time, and time zone work for a callback?'
 when 'review' then 'I saved this for review. No offer or callback has been confirmed.'
 when 'handoff' then 'Your request is saved for review. A callback has not been booked. Automatic replies are paused.'
 else null end;
 if body is null then raise exception 'Unapproved diagnostic reply';end if;
 if p_action in ('review','handoff') then update public.icash_owner_reply_sessions set enabled=false where thread_id=t.id;end if;
 body:='iCash X AI practice. '||body;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,state,request_key) values(t.id,t.account_id,'outgoing',body,'dispatching',a.id) returning id into outgoing;
 update public.icash_text_messages set customer_price_micros=null where id=outgoing;
 update public.icash_owner_reply_attempts set state='dispatching',result=p_result,outgoing_id=outgoing where id=a.id;
 update public.icash_text_ai_jobs set state=case when p_action in ('review','handoff') then 'handoff' else 'queued' end,analysis=p_result->'analysis',usage=p_result->'usage',provider_id=p_result->>'providerId',reply=body,outgoing_id=outgoing where message_id=a.message_id;
 return jsonb_build_object('id',outgoing,'account',t.account_id,'from',t.sender,'to',t.recipient,'message',body);
end $$;
revoke all on function public.icash_claim_owner_reply(text),public.icash_prepare_owner_reply(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_owner_reply(text),public.icash_prepare_owner_reply(uuid,text,jsonb) to service_role;
