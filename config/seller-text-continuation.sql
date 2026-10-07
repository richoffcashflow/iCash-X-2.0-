begin;
set local lock_timeout='2s';
-- A routing question is account-level work. Its transport thread supplies only
-- the existing sender/permission/rate; the ambiguous incoming quote stays unbound.
create table public.icash_seller_text_replies(
 id uuid primary key default gen_random_uuid(),source_id uuid not null unique references public.icash_text_messages(id),
 account_id uuid not null references public.icash_accounts(id),thread_id uuid not null references public.icash_text_threads(id),
 kind text not null check(kind='clarification'),action text not null,
 body text not null,route_revision bigint not null,message_id uuid unique references public.icash_text_messages(id),
 created_at timestamptz not null default now()
);
create table public.icash_sms_conversation_focus(
 sender text not null,recipient text not null,account_id uuid not null references public.icash_accounts(id),
 thread_id uuid not null references public.icash_text_threads(id),source_id uuid not null references public.icash_text_messages(id),
 route_revision bigint not null,expires_at timestamptz not null,primary key(sender,recipient)
);
alter table public.icash_seller_text_replies enable row level security;
alter table public.icash_sms_conversation_focus enable row level security;
revoke all on public.icash_seller_text_replies,public.icash_sms_conversation_focus from public,anon,authenticated;
grant all on public.icash_seller_text_replies,public.icash_sms_conversation_focus to service_role;

-- Focus requires an explicit address FROM the recipient. Merely sending a new
-- opener never attributes an incoming yes, price or agreement to that property.
alter function public.icash_sms_resolve_property(text,text,text) rename to icash_sms_resolve_explicit_property;
create function public.icash_sms_resolve_property(p_sender text,p_recipient text,p_body text) returns uuid language plpgsql set search_path='' as $$
declare chosen uuid;normalized text:=public.icash_sms_normalize_address(p_body);
begin
 chosen:=public.icash_sms_resolve_explicit_property(p_sender,p_recipient,p_body);
 if chosen is not null then return chosen;end if;
 -- An unmatched/different/multiple address never inherits conversational focus.
 if normalized ~ '[0-9]+ [a-z]' or normalized ~ '\m(other|different) (house|property|address)\M' then return null;end if;
 select f.thread_id into chosen from public.icash_sms_conversation_focus f
 join public.icash_sms_routes r on r.sender=f.sender and r.recipient=f.recipient and r.account_id=f.account_id
 join public.icash_text_threads t on t.id=f.thread_id and t.account_id=f.account_id and t.sender=f.sender and t.recipient=f.recipient
 where f.sender=p_sender and f.recipient=p_recipient and f.expires_at>now() and f.route_revision=r.revision and not r.needs_review
 and t.retired_at is null and t.party='seller';
 return chosen;
end $$;
create function public.icash_remember_sms_property() returns trigger language plpgsql set search_path='' as $$
declare t public.icash_text_threads;r public.icash_sms_routes;address text;explicit_address boolean;
begin
 if new.thread_id is null then return new;end if;
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id;
 select * into r from public.icash_sms_routes where sender=t.sender and recipient=t.recipient;
 if new.direction='outgoing' then
  -- A different property's outbound message ends existing context even before
  -- delivery; there is no latest-outgoing-wins fallback.
  delete from public.icash_sms_conversation_focus where sender=t.sender and recipient=t.recipient and thread_id<>t.id;
  return new;
 end if;
 if new.state<>'received' or t.party<>'seller' or t.retired_at is not null then return new;end if;
 select public.icash_sms_normalize_address(split_part(terms->>'address',',',1)) into address from public.icash_deal_files where id=t.deal_id and account_id=t.account_id;
 explicit_address:=address ~ '^[0-9]+ [a-z0-9]+ [a-z0-9]+' and position(' '||address||' ' in ' '||public.icash_sms_normalize_address(new.body)||' ')>0;
 if explicit_address then
  insert into public.icash_sms_conversation_focus(sender,recipient,account_id,thread_id,source_id,route_revision,expires_at)
  values(t.sender,t.recipient,t.account_id,t.id,new.id,r.revision,now()+interval '2 hours')
  on conflict(sender,recipient) do update set account_id=excluded.account_id,thread_id=excluded.thread_id,source_id=excluded.source_id,route_revision=excluded.route_revision,expires_at=excluded.expires_at;
 else
  update public.icash_sms_conversation_focus set route_revision=r.revision
   where sender=t.sender and recipient=t.recipient and account_id=t.account_id and thread_id=t.id and route_revision=r.revision-1 and expires_at>now();
 end if;
 return new;
end $$;
create trigger icash_01_remember_sms_property after insert on public.icash_text_messages for each row execute function public.icash_remember_sms_property();

create function public.icash_seller_clarification_current(p_account uuid,p_thread uuid,p_key uuid,p_body text,p_revision bigint) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_seller_text_replies w
 join public.icash_text_messages source on source.id=w.source_id and source.account_id=w.account_id and source.thread_id is null and source.direction='incoming' and source.state='needs_review'
 join public.icash_text_threads t on t.id=w.thread_id and t.account_id=w.account_id and t.retired_at is null and t.party='seller' and t.seller_intake_id is not null and not t.manual_only and not t.paused and t.ai_mode='auto'
 join public.icash_sms_route_reviews q on q.message_id=source.id and q.account_id=w.account_id and q.sender=t.sender and q.recipient=t.recipient
 join public.icash_sms_routes r on r.sender=t.sender and r.recipient=t.recipient and r.account_id=w.account_id
 where w.id=p_key and w.account_id=p_account and w.thread_id=p_thread and w.kind='clarification' and w.action='ask_address'
 and w.body=p_body and p_body='What is the address of the property you are confirming?'
 and w.route_revision=p_revision and source.route_revision=p_revision and r.revision=p_revision and r.needs_review
 and w.created_at>now()-interval '15 minutes' and q.resolved_at is null)
$$;
-- Exception admits ONLY the exact non-property-specific address question. All
-- ordinary pause, consent, suppression, hours and billing gates remain downstream.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_sms_message_route()'::regprocedure);
 needle:='r.account_id is distinct from new.account_id or r.needs_review or t.retired_at is not null';
 if position(needle in definition)=0 then raise exception 'SMS insert routing prerequisite changed';end if;
 execute replace(definition,needle,'r.account_id is distinct from new.account_id or (r.needs_review and not public.icash_seller_clarification_current(new.account_id,new.thread_id,new.request_key,new.body,r.revision)) or t.retired_at is not null');
 definition:=pg_get_functiondef('public.icash_sms_message_route_current(uuid,uuid)'::regprocedure);
 needle:=' if r.account_id is distinct from p_account or r.needs_review or m.route_revision is distinct from r.revision then';
 if position(needle in definition)=0 then raise exception 'SMS claim routing prerequisite changed';end if;
 execute replace(definition,needle,$new$ if m.direction='outgoing' and cardinality(m.asset_ids)=0 and m.attachments='[]'::jsonb and public.icash_seller_clarification_current(p_account,m.thread_id,m.request_key,m.body,m.route_revision) then return true;end if;
 if r.account_id is distinct from p_account or r.needs_review or m.route_revision is distinct from r.revision then$new$);
end $patch$;

-- The existing bounded AI engine owns matched seller conversation. This RPC
-- only promotes its event-bound pending job for immediate processing; its normal
-- atomic AI claim still reserves usage and serializes against the worker.
create function public.icash_prepare_seller_text_event(p_event text) returns jsonb language plpgsql set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;r public.icash_sms_routes;w public.icash_seller_text_replies;outgoing uuid;job uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where event_id=p_event and direction='incoming';
 if not found or m.account_id is null or m.created_at<now()-interval '2 hours' then return null;end if;
 select * into w from public.icash_seller_text_replies where source_id=m.id;
 if found then return case when w.message_id is null then null else jsonb_build_object('accountId',w.account_id,'messageId',w.message_id) end;end if;
 select id into outgoing from public.icash_text_messages where account_id=m.account_id and request_key=m.id and direction='outgoing' and state='ready';
 if outgoing is not null then return jsonb_build_object('accountId',m.account_id,'messageId',outgoing);end if;
 if m.thread_id is not null then
  select * into t from public.icash_text_threads where id=m.thread_id and account_id=m.account_id;
  select * into r from public.icash_sms_routes where sender=t.sender and recipient=t.recipient for update;
  if r.account_id is distinct from m.account_id or r.needs_review or r.revision is distinct from m.route_revision or m.state<>'received'
   or public.icash_seller_conversation_context(m.account_id,t.id) is null then return null;end if;
  update public.icash_text_ai_jobs set state='issued',updated_at=now(),next_attempt_at=now()+interval '15 minutes'
   where message_id=m.id and account_id=m.account_id and thread_id=t.id and state='pending' and next_attempt_at<=now() returning id into job;
  return case when job is null then null else jsonb_build_object('accountId',m.account_id,'textAiJobId',job) end;
 end if;
 select routes.* into r from public.icash_sms_routes routes join public.icash_sms_route_reviews q on q.sender=routes.sender and q.recipient=routes.recipient and q.account_id=routes.account_id where q.message_id=m.id and q.resolved_at is null for update of routes;
 if r.account_id is distinct from m.account_id or not r.needs_review or r.revision is distinct from m.route_revision then return null;end if;
 -- The eligible transport never determines which property the seller meant.
 select th.* into t from public.icash_text_threads th where th.account_id=m.account_id and th.sender=r.sender and th.recipient=r.recipient
  and th.retired_at is null and th.party='seller' and th.seller_intake_id is not null and not th.paused and not th.manual_only and th.ai_mode='auto'
  and public.icash_sms_thread_review_current(th.account_id,th.id,true)
  and exists(select 1 from public.icash_text_messages sent where sent.thread_id=th.id and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null)
  order by th.id limit 1;
 if t.id is null or not public.icash_outreach_sms_current(m.account_id)
  or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused)
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')) then return null;end if;
 if lower(m.body) ~ '\m(stop|unsubscribe|quit|not interested|wrong number|leave me alone|do not (call|text|contact)|don''t (call|text|contact)|remove me|human|real person)\M' or lower(trim(m.body)) ~ '^(no|nope|nah|end|cancel)[.! ]*$' then return null;end if;
 if (select count(*) from public.icash_seller_text_replies work join public.icash_text_threads th on th.id=work.thread_id where work.account_id=m.account_id and th.recipient=t.recipient and work.created_at>now()-interval '1 hour')>=6 then return null;end if;
 if exists(select 1 from public.icash_seller_text_replies work join public.icash_text_threads th on th.id=work.thread_id join public.icash_text_messages sent on sent.id=work.message_id where work.account_id=m.account_id and th.recipient=t.recipient and sent.state in ('dispatching','accepted','delivered') and work.created_at>now()-interval '2 minutes') then return null;end if;
 insert into public.icash_seller_text_replies(source_id,account_id,thread_id,kind,action,body,route_revision)
  values(m.id,m.account_id,t.id,'clarification','ask_address','What is the address of the property you are confirming?',r.revision) returning * into w;
 outgoing:=public.icash_queue_text(m.account_id,t.id,w.id,w.body,'{}');
 update public.icash_seller_text_replies set message_id=outgoing where id=w.id;
 return jsonb_build_object('accountId',m.account_id,'messageId',outgoing);
end $$;

-- Revalidate exact source and approved prose at dispatch. Do not infer property
-- facts from the account-level clarification's transport thread.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_seller_continuation;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
declare w public.icash_seller_text_replies;m public.icash_text_messages;t public.icash_text_threads;source public.icash_text_messages;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into w from public.icash_seller_text_replies where message_id=p_message and account_id=p_account;
 if found then
  select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
  select * into source from public.icash_text_messages where id=w.source_id and account_id=p_account;
  select * into t from public.icash_text_threads where id=w.thread_id and account_id=p_account;
  if t.id is null or t.manual_only or t.paused or t.ai_mode<>'auto' or t.retired_at is not null or m.thread_id<>t.id or m.request_key<>w.id or m.body<>w.body or cardinality(m.asset_ids)<>0 or m.attachments<>'[]'::jsonb or w.created_at<now()-interval '15 minutes' then return null;end if;
 end if;
 return public.icash_claim_text_before_seller_continuation(p_account,p_message,p_sender);
end $$;

-- Worker fallback covers webhook timeouts and transient preparation errors. Reuse
-- one-use SMS capabilities, never retry a claimed/uncertain provider operation.
alter function public.icash_next_automation() rename to icash_next_before_seller_continuation;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare work record;candidate record;prepared jsonb;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if found then
  for candidate in select m.event_id from public.icash_text_messages m join public.icash_accounts a on a.id=m.account_id and not a.bot_paused
   where m.direction='incoming' and m.thread_id is null and m.state='needs_review' and m.created_at>now()-interval '15 minutes' and m.event_id is not null
   and not exists(select 1 from public.icash_seller_text_replies w where w.source_id=m.id)
   and not exists(select 1 from public.icash_text_messages o where o.request_key=m.id and o.direction='outgoing')
   order by m.created_at desc limit 5
  loop begin prepared:=public.icash_prepare_seller_text_event(candidate.event_id);exception when others then null;end;end loop;
  select m.id,m.account_id into work from public.icash_seller_text_replies w join public.icash_text_messages m on m.id=w.message_id and m.account_id=w.account_id
   where m.state='ready' and m.provider_id is null and m.last_delivery_at is null and w.created_at>now()-interval '15 minutes'
   and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id)
   and not exists(select 1 from public.icash_automation_tickets x where x.opener_message_id=m.id and (x.state='consumed' or (x.state='issued' and x.expires_at>now())))
   and (select count(*) from public.icash_automation_tickets x where x.opener_message_id=m.id)<3
   order by w.created_at limit 1;
  if found then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(work.account_id,'seller_opener',work.id) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
 end if;
 return public.icash_next_before_seller_continuation();
end $$;
revoke all on function public.icash_sms_resolve_explicit_property(text,text,text),public.icash_sms_resolve_property(text,text,text),public.icash_remember_sms_property(),public.icash_seller_clarification_current(uuid,uuid,uuid,text,bigint),public.icash_prepare_seller_text_event(text),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_seller_continuation(uuid,uuid,text),public.icash_next_automation(),public.icash_next_before_seller_continuation() from public,anon,authenticated;
grant execute on function public.icash_sms_resolve_explicit_property(text,text,text),public.icash_sms_resolve_property(text,text,text),public.icash_seller_clarification_current(uuid,uuid,uuid,text,bigint),public.icash_prepare_seller_text_event(text),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_seller_continuation(uuid,uuid,text),public.icash_next_automation(),public.icash_next_before_seller_continuation() to service_role;
commit;
