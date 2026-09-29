-- Only trusted dispatch may register a live call. Practice conversations are never imported here.
create table public.icash_live_conversations (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null references public.icash_screening_jobs(id),
 party text not null check(party in ('seller','buyer')),agent_id text not null check(agent_id ~ '^agent_[A-Za-z0-9]+$'),
 conversation_id text not null unique check(conversation_id ~ '^conv_[A-Za-z0-9]+$'),
 operation_key text not null unique references public.icash_operation_spend(operation_key),
 contact_key text not null check(length(contact_key) between 16 and 200),
 strategy_key text not null check(strategy_key in ('cash_interest','flexible_timing','buyer_followup')),
 tool_token_hash text unique check(tool_token_hash ~ '^[0-9a-f]{64}$'),tool_expires_at timestamptz,
 state text not null default 'waiting' check(state in ('waiting','complete','review')),
 next_poll_at timestamptz not null default now(),poll_attempts integer not null default 0,
 result jsonb,created_at timestamptz not null default now(),completed_at timestamptz
);
create index icash_live_poll on public.icash_live_conversations(next_poll_at) where state='waiting';
create index icash_live_account on public.icash_live_conversations(account_id,screening_id,created_at desc);
create table public.icash_handoffs (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null unique references public.icash_live_conversations(id),
 account_id uuid not null references public.icash_accounts(id),screening_id uuid not null references public.icash_screening_jobs(id),
 party text not null check(party in ('seller','buyer')),reason text not null,summary text not null,next_action text not null,
 state text not null default 'open' check(state in ('open','acknowledged','resolved')),
 created_at timestamptz not null default now(),resolved_at timestamptz
);
create index icash_handoffs_attention on public.icash_handoffs(account_id,created_at) where state<>'resolved';
create table public.icash_live_callbacks (
 id uuid primary key default gen_random_uuid(),conversation_id uuid not null unique references public.icash_live_conversations(id),
 account_id uuid not null references public.icash_accounts(id),screening_id uuid not null references public.icash_screening_jobs(id),
 due_at timestamptz not null,timezone text not null,evidence jsonb not null,
 state text not null default 'pending_dispatch_review' check(state in ('pending_dispatch_review','held_for_human','canceled','dispatched','missed')),
 created_at timestamptz not null default now()
);
create index icash_live_callbacks_due on public.icash_live_callbacks(due_at) where state='pending_dispatch_review';
create table public.icash_contact_suppressions (
 account_id uuid not null references public.icash_accounts(id),contact_key text not null,
 source_conversation uuid not null references public.icash_live_conversations(id),created_at timestamptz not null default now(),
 primary key(account_id,contact_key)
);
alter table public.icash_live_conversations enable row level security;
alter table public.icash_handoffs enable row level security;
alter table public.icash_live_callbacks enable row level security;
alter table public.icash_contact_suppressions enable row level security;
revoke all on public.icash_live_conversations,public.icash_handoffs,public.icash_live_callbacks,public.icash_contact_suppressions from public,anon,authenticated;
grant all on public.icash_live_conversations,public.icash_handoffs,public.icash_live_callbacks,public.icash_contact_suppressions to service_role;

create function public.icash_validate_live_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_screening_jobs where id=new.screening_id and account_id=new.account_id) then raise exception 'Tenant mismatch';end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key=new.operation_key and o.account_id=new.account_id and o.state='dispatched' and r.operation in ('seller_call','buyer_call')) then raise exception 'Dispatched call required';end if;
 if exists(select 1 from public.icash_voice_test_sessions where conversation_id=new.conversation_id) or exists(select 1 from public.icash_voice_test_config where agent_id=new.agent_id) then raise exception 'Practice is not live';end if;
 return new;
end $$;
create trigger icash_live_binding before insert on public.icash_live_conversations for each row execute function public.icash_validate_live_binding();

create function public.icash_open_handoff(p_call uuid,p_reason text,p_summary text,p_next text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare c public.icash_live_conversations; prop text; result uuid;
begin
 select * into strict c from public.icash_live_conversations where id=p_call for update;
 if length(p_reason) not between 1 and 1000 or length(p_summary)>6000 or length(p_next) not between 1 and 1000 then raise exception 'Invalid handoff';end if;
 select snapshot->>'propertyId' into strict prop from public.icash_screening_jobs where id=c.screening_id and account_id=c.account_id;
 insert into public.icash_property_controls(account_id,property_id,manual) values(c.account_id,prop,true)
 on conflict(account_id,property_id) do update set manual=true,updated_at=now();
 insert into public.icash_handoffs(conversation_id,account_id,screening_id,party,reason,summary,next_action)
 values(c.id,c.account_id,c.screening_id,c.party,p_reason,p_summary,p_next)
 on conflict(conversation_id) do update set summary=excluded.summary
 returning id into result;
 update public.icash_live_callbacks set state='held_for_human' where account_id=c.account_id and screening_id=c.screening_id and state='pending_dispatch_review';
 return result;
end $$;

create function public.icash_live_handoff_tool(p_hash text,p_conversation text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.icash_live_conversations; h uuid;
begin
 select * into c from public.icash_live_conversations where tool_token_hash=p_hash and conversation_id=p_conversation and tool_expires_at>now() and state='waiting' for update;
 if not found then raise exception 'Invalid capability';end if;
 h:=public.icash_open_handoff(c.id,p_reason,'Conversation is in progress. Full summary will appear after the call.','Review the conversation and follow up personally.');
 return jsonb_build_object('saved',true,'handoffId',h,'instruction','Stop negotiating. Tell the caller a person needs to follow up. Do not promise an immediate transfer.');
end $$;

create function public.icash_save_live_result(p_call uuid,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare c public.icash_live_conversations; prop text; due timestamptz; zone text;
begin
 select * into strict c from public.icash_live_conversations where id=p_call for update;
 if c.state='complete' then if c.result<>p_result then raise exception 'Conflicting result';end if;return;end if;
 if octet_length(p_result::text)>262144 or jsonb_typeof(p_result->'transcript') is distinct from 'array' or nullif(p_result->>'summary','') is null or p_result->>'party' is distinct from c.party then raise exception 'Invalid result';end if;
 select snapshot->>'propertyId' into strict prop from public.icash_screening_jobs where id=c.screening_id and account_id=c.account_id;
 if (p_result->>'humanRequested')::boolean then perform public.icash_open_handoff(c.id,'Requested a person',left(p_result->>'summary',6000),p_result->>'nextAction');end if;
 update public.icash_handoffs set summary=left(p_result->>'summary',6000) where conversation_id=c.id;
 if (p_result->>'optedOut')::boolean then
  insert into public.icash_contact_suppressions(account_id,contact_key,source_conversation) values(c.account_id,c.contact_key,c.id) on conflict do nothing;
  insert into public.icash_property_controls(account_id,property_id,manual) values(c.account_id,prop,true) on conflict(account_id,property_id) do update set manual=true,updated_at=now();
  update public.icash_live_callbacks b set state='canceled' from public.icash_live_conversations v where b.conversation_id=v.id and v.account_id=c.account_id and v.contact_key=c.contact_key and b.state in ('pending_dispatch_review','held_for_human');
 elsif p_result->>'callbackDueAt' is not null then
  due:=(p_result->>'callbackDueAt')::timestamptz;zone:=p_result->>'callbackTimezone';
  if not exists(select 1 from pg_timezone_names where name=zone) or due>now()+interval '90 days' then raise exception 'Invalid callback time';end if;
  insert into public.icash_live_callbacks(conversation_id,account_id,screening_id,due_at,timezone,evidence,state)
  values(c.id,c.account_id,c.screening_id,due,zone,jsonb_build_object('quote',p_result->'callbackQuote','readback',p_result->'callbackEvidence'),case when due<=now() then 'missed' when exists(select 1 from public.icash_property_controls where account_id=c.account_id and property_id=prop and manual) then 'held_for_human' else 'pending_dispatch_review' end) on conflict do nothing;
 end if;
 update public.icash_live_conversations set result=p_result,state='complete',completed_at=now(),tool_token_hash=null where id=c.id;
end $$;

create function public.icash_acknowledge_handoff(p_user uuid,p_account uuid,p_id uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 update public.icash_handoffs set state='acknowledged' where id=p_id and account_id=p_account and state='open';
 -- Acknowledgement intentionally does not resume automation.
end $$;

-- Polling is read-only provider work and remains available while customers pause acquisition.
-- Keep the prior scheduler intact and wrap it, so outbound budgeting behavior is unchanged.
alter function public.icash_next_automation() rename to icash_next_acquisition;
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result'));
alter table public.icash_automation_tickets add column live_call_id uuid references public.icash_live_conversations(id);
create function public.icash_next_automation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.icash_live_conversations; t public.icash_automation_tickets;
begin
 select * into c from public.icash_live_conversations where state='waiting' and next_poll_at<=now() and poll_attempts<60 order by next_poll_at for update skip locked limit 1;
 if found then
  update public.icash_live_conversations set poll_attempts=poll_attempts+1,next_poll_at=now()+interval '2 minutes' where id=c.id;
  insert into public.icash_automation_tickets(account_id,kind,live_call_id) values(c.account_id,'voice_result',c.id) returning * into t;
  return jsonb_build_object('token',t.token);
 end if;
 update public.icash_live_conversations set state='review' where state='waiting' and poll_attempts>=60 and next_poll_at<=now();
 return public.icash_next_acquisition();
end $$;
create or replace function public.icash_consume_automation(p_token text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id,'liveCallId',t.live_call_id);
end $$;
revoke all on function public.icash_validate_live_binding(),public.icash_open_handoff(uuid,text,text,text),public.icash_live_handoff_tool(text,text,text),public.icash_save_live_result(uuid,jsonb),public.icash_acknowledge_handoff(uuid,uuid,uuid),public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_validate_live_binding(),public.icash_open_handoff(uuid,text,text,text),public.icash_live_handoff_tool(text,text,text),public.icash_save_live_result(uuid,jsonb),public.icash_acknowledge_handoff(uuid,uuid,uuid),public.icash_next_automation() to service_role;

create or replace function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
declare prop text;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account ownership required';end if;
 if p_action in ('pause','resume') then
 update public.icash_accounts set bot_paused=(p_action='pause') where id=p_account;
 elsif p_action in ('takeover','return_to_bot') then
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p_screening and account_id=p_account;
 if prop is null then raise exception 'Property missing';end if;
 insert into public.icash_property_controls(account_id,property_id,manual) values(p_account,prop,p_action='takeover')
 on conflict(account_id,property_id) do update set manual=excluded.manual,updated_at=now();
 if p_action='return_to_bot' then
 update public.icash_handoffs set state='resolved',resolved_at=now() where account_id=p_account and screening_id=p_screening and state<>'resolved';
 -- Returning control never automatically retries a past callback.
 end if;
 else raise exception 'Invalid control';end if;
 insert into public.icash_control_events(account_id,actor_user_id,action,property_id) values(p_account,p_user,p_action,prop);
end $$;
