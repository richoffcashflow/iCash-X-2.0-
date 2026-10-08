begin;
set local lock_timeout='2s';
-- A delivered, saved ownership question names the conversational property. This
-- is routing context only: it grants no financial, offer or signing authority.
create function public.icash_sms_recent_owner_question(p_sender text,p_recipient text,p_clock timestamptz default now()) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;
begin
 if p_clock>now() or p_clock<now()-interval '2 hours' then return null;end if;
 select sent.* into m from public.icash_text_messages sent join public.icash_text_threads th on th.id=sent.thread_id and th.account_id=sent.account_id
 where th.sender=p_sender and th.recipient=p_recipient and sent.direction='outgoing'
 and sent.created_at<=p_clock and sent.created_at>p_clock-interval '2 hours'
 and sent.state in ('ready','dispatching','accepted','delivered')
 and not exists(select 1 from public.icash_seller_text_replies c where c.message_id=sent.id and c.kind='clarification')
 order by sent.created_at desc,sent.id desc limit 1;
 if m.id is null or m.state<>'delivered' or m.provider_id is null or m.last_delivery_at is null or m.last_delivery_at>p_clock then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=m.account_id;
 if t.party<>'seller' or t.retired_at is not null or t.seller_intake_id is null or t.paused or t.manual_only or t.ai_mode<>'auto'
 or not public.icash_seller_sms_permission_current(t.account_id,t.id,false)
 or not exists(select 1 from public.icash_sms_routes r where r.sender=p_sender and r.recipient=p_recipient and r.account_id=t.account_id)
 or exists(select 1 from public.icash_text_threads other where other.sender=p_sender and other.recipient=p_recipient and other.retired_at is null and other.party<>'seller')
 or not exists(select 1 from public.icash_sms_seller_openings o join public.icash_seller_opener_assignments a on a.thread_id=o.thread_id and a.account_id=o.account_id
  where o.thread_id=t.id and o.account_id=t.account_id and o.owner_question_id=m.id and a.body=m.body)
 or exists(select 1 from public.icash_text_messages other join public.icash_text_threads th on th.id=other.thread_id
  where th.sender=p_sender and th.recipient=p_recipient and other.direction='outgoing' and other.id<>m.id and other.created_at=m.created_at and other.state in ('ready','dispatching','accepted','delivered')
  and not exists(select 1 from public.icash_seller_text_replies c where c.message_id=other.id and c.kind='clarification')) then return null;end if;
 return jsonb_build_object('accountId',t.account_id,'threadId',t.id,'questionId',m.id);
end $$;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_sms_resolve_property(text,text,text)'::regprocedure);
 needle:=' return chosen;';
 if position(needle in definition)=0 then raise exception 'SMS focus resolver changed';end if;
 execute replace(definition,needle,$new$ return coalesce(chosen,(public.icash_sms_recent_owner_question(p_sender,p_recipient)->>'threadId')::uuid);$new$);
 definition:=pg_get_functiondef('public.icash_remember_sms_property()'::regprocedure);
 needle:=' if explicit_address then';
 if position(needle in definition)=0 then raise exception 'SMS focus capture changed';end if;
 execute replace(definition,needle,$new$ if explicit_address or (public.icash_sms_recent_owner_question(t.sender,t.recipient,new.created_at)->>'threadId')::uuid=t.id then$new$);
end $patch$;

-- Audited repair of a recent, still-unbound confirmation. Never move a message
-- between properties, rewrite its body/timestamp, or replay a provider event.
create table public.icash_sms_owner_reply_resolutions(
 source_id uuid primary key references public.icash_text_messages(id),
 question_id uuid not null references public.icash_text_messages(id),
 account_id uuid not null references public.icash_accounts(id),
 thread_id uuid not null references public.icash_text_threads(id),
 route_revision bigint not null,created_at timestamptz not null default now()
);
alter table public.icash_sms_owner_reply_resolutions enable row level security;
revoke all on public.icash_sms_owner_reply_resolutions from public,anon,authenticated;
grant select,insert on public.icash_sms_owner_reply_resolutions to service_role;
create function public.icash_sms_owner_reply_resolution_current(p_source uuid,p_account uuid,p_thread uuid,p_revision bigint) returns boolean language sql security invoker set search_path='' as $$
 select exists(select 1 from public.icash_sms_owner_reply_resolutions b join public.icash_text_messages m on m.id=b.source_id
 join public.icash_text_threads t on t.id=b.thread_id and t.account_id=b.account_id
 join public.icash_sms_routes r on r.sender=t.sender and r.recipient=t.recipient and r.account_id=t.account_id
 where b.source_id=p_source and b.account_id=p_account and b.thread_id=p_thread and b.route_revision=p_revision and r.revision=p_revision
 and m.account_id=p_account and m.thread_id is null and m.direction='incoming' and m.state='needs_review'
 and m.route_revision=p_revision and m.created_at>now()-interval '15 minutes'
 and lower(trim(m.body)) ~ '^(yes|yeah|yep|yup|correct|that is me|that''s me)[.! ]*$'
 and public.icash_sms_recent_owner_question(t.sender,t.recipient,m.created_at)=jsonb_build_object('accountId',p_account,'threadId',p_thread,'questionId',b.question_id));
$$;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_sms_message_route()'::regprocedure);
 needle:=$old$then raise exception 'SMS message route is immutable';end if;$old$;
 if position(needle in definition)=0 then raise exception 'SMS immutable route prerequisite changed';end if;
 execute replace(definition,needle,$new$then
   if not (old.thread_id is null and new.thread_id is not null and old.state='needs_review' and new.state='received'
    and row(new.account_id,new.direction,new.route_revision,new.body,new.created_at,new.event_id,new.provider_id,new.attachments)
      is not distinct from row(old.account_id,old.direction,old.route_revision,old.body,old.created_at,old.event_id,old.provider_id,old.attachments)
    and public.icash_sms_owner_reply_resolution_current(old.id,new.account_id,new.thread_id,new.route_revision))
   then raise exception 'SMS message route is immutable';end if;
  end if;$new$);
end $patch$;
create trigger icash_01_remember_resolved_owner_reply after update of thread_id on public.icash_text_messages
 for each row when(old.thread_id is null and new.thread_id is not null) execute function public.icash_remember_sms_property();
create function public.icash_resolve_recent_owner_reply(p_account uuid,p_message uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;q public.icash_sms_route_reviews;r public.icash_sms_routes;context jsonb;t public.icash_text_threads;outgoing uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
 select * into q from public.icash_sms_route_reviews where message_id=m.id and account_id=p_account;
 if m.id is null or m.thread_id is not null or m.state<>'needs_review' or m.direction<>'incoming' or m.created_at<now()-interval '15 minutes' or q.resolved_at is not null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(q.recipient,74));
 select * into r from public.icash_sms_routes where sender=q.sender and recipient=q.recipient and account_id=p_account for update;
 if r.revision is distinct from m.route_revision then return null;end if;
 context:=public.icash_sms_recent_owner_question(q.sender,q.recipient,m.created_at);
 if context is null or context->>'accountId'<>p_account::text then return null;end if;
 select * into t from public.icash_text_threads where id=(context->>'threadId')::uuid and account_id=p_account;
 insert into public.icash_sms_owner_reply_resolutions(source_id,question_id,account_id,thread_id,route_revision)
 values(m.id,(context->>'questionId')::uuid,p_account,t.id,r.revision) on conflict do nothing;
 if not public.icash_sms_owner_reply_resolution_current(m.id,p_account,t.id,r.revision) then return null;end if;
 update public.icash_sms_routes set needs_review=false where sender=r.sender and recipient=r.recipient;
 update public.icash_text_messages set thread_id=t.id,state='received',updated_at=now() where id=m.id;
 update public.icash_sms_route_reviews set resolved_at=now(),resolution_revision=r.revision,
 reason='Bound to the delivered ownership question; no offer or contract authority inferred.' where message_id=m.id;
 -- Continue through the existing consent/financial/credit-aware response engine.
 outgoing:=public.icash_prepare_sms_inbound_reply(p_account,t.id,m.id);
 return jsonb_build_object('threadId',t.id,'messageId',outgoing);
end $$;
revoke all on function public.icash_sms_recent_owner_question(text,text,timestamptz),public.icash_sms_owner_reply_resolution_current(uuid,uuid,uuid,bigint),public.icash_resolve_recent_owner_reply(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_sms_recent_owner_question(text,text,timestamptz),public.icash_sms_owner_reply_resolution_current(uuid,uuid,uuid,bigint),public.icash_resolve_recent_owner_reply(uuid,uuid) to service_role;
commit;
