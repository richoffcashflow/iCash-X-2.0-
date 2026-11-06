-- All iCash X Contiguity traffic shares the physical sending number.
begin;
set local lock_timeout='3s';
set local statement_timeout='60s';

create schema icash_sender_private;
revoke all on schema icash_sender_private from public, anon, authenticated;
grant usage on schema icash_sender_private to service_role;
create table icash_sender_private.lines(sender text primary key);
create table icash_sender_private.uses(
 source text not null, source_id uuid not null, sender text not null, cold boolean not null,
 admitted_at timestamptz not null, account_id uuid, thread_id uuid, cohort text, opener boolean not null default false,
 primary key(source,source_id)
);
create index sender_volume_window on icash_sender_private.uses(sender,admitted_at) include(cold);
create index sender_volume_reply_sample on icash_sender_private.uses(sender,account_id,cohort,admitted_at desc) where opener;
create table icash_sender_private.waiting(
 message_id uuid primary key references public.icash_text_messages(id) on delete cascade,
 account_id uuid not null, thread_id uuid not null, sender text not null, claim_kind text not null check(claim_kind in ('automatic','manual','meta')),
 binding text not null, queued_at timestamptz not null, next_check_at timestamptz not null
);
create index sender_volume_due on icash_sender_private.waiting(next_check_at,queued_at);

-- Use the same account, targeting pool, property market and sending number.
-- A missing source cannot qualify a list for more cold sends.
create function icash_sender_private.cohort(p_account uuid,p_thread uuid) returns text
language sql stable set search_path='' as $$
 select (s.snapshot#>>'{raw,data,state}')||'/'||public.icash_owner_targeting_pool(s.account_id,s.id)
 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where t.id=p_thread and t.account_id=p_account and t.party='seller'
 and s.snapshot#>>'{raw,data,state}' ~ '^[A-Z]{2}$'
$$;

-- Bind an actual human text to both ends of this property conversation.
create function icash_sender_private.replied(p_account uuid,p_thread uuid,p_start timestamptz,p_end timestamptz,p_message uuid default null)
returns boolean language sql stable set search_path='' as $$
 select exists(
  select 1 from public.icash_text_threads t
  join public.icash_text_messages r on r.thread_id=t.id and r.account_id=t.account_id
  join public.icash_text_events e on e.id=r.event_id
  where t.id=p_thread and t.account_id=p_account and r.direction='incoming' and r.state='received'
   and (p_message is null or r.id=p_message) and r.created_at>p_start and r.created_at<=p_end
   and e.type in ('text.incoming.sms','text.incoming.mms') and e.payload->>'id'=e.id and e.payload->>'type'=e.type
   and case when jsonb_typeof(e.payload->'timestamp')='number' then (e.payload->>'timestamp')::numeric
    between extract(epoch from p_start) and extract(epoch from p_end)+5 else false end
   and e.payload#>>'{data,from}'=t.recipient and e.payload#>>'{data,to}'=t.sender
   and e.payload#>>'{data,body}'=r.body and length(btrim(r.body))>0
   and coalesce((e.payload->'optOut')='true'::jsonb,false)=false
   and public.icash_seller_response_disposition(r.body) is null
   and r.body !~* '(auto(matic|mated)?[ -]?(reply|response|message)|out of (the )?office|message (blocking|undeliverable)|wrong (person|number)|^no[.! ]*$)'
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=t.recipient)
 )
$$;

create function icash_sender_private.room(p_sender text,p_cold boolean,p_account uuid default null,p_cohort text default null)
returns boolean language plpgsql stable set search_path='' as $$
declare at_time timestamptz:=statement_timestamp(); total integer; cold_used integer;
begin
 if p_sender is null or p_sender !~ '^\+[1-9][0-9]{7,14}$' or p_cold is null then return false;end if;
 select count(*),count(*) filter(where u.cold) into total,cold_used
 from icash_sender_private.uses u where u.sender=p_sender and u.admitted_at>at_time-interval '24 hours';
 if total>=1000 then return false;end if;
 if not p_cold or cold_used<100 then return true;end if;
 if cold_used>=300 or p_account is null or p_cohort is null then return false;end if;
 -- Last 50 distinct, mature first touches. Unknown deliveries remain in the denominator.
 return (with first_touches as (
  select distinct on(t.recipient) t.recipient,u.thread_id,u.admitted_at,u.source_id
  from icash_sender_private.uses u join public.icash_text_threads t on t.id=u.thread_id and t.account_id=u.account_id and t.sender=u.sender
  where u.opener and u.sender=p_sender and u.account_id=p_account and u.cohort=p_cohort
   and u.admitted_at between at_time-interval '7 days' and at_time-interval '24 hours'
  order by t.recipient,u.admitted_at,u.source_id
 ), sample as (select * from first_touches order by admitted_at desc,thread_id limit 50)
 select count(*)=50 and count(*) filter(where exists(select 1 from public.icash_text_messages m where m.id=sample.source_id
  and m.account_id=p_account and m.thread_id=sample.thread_id and m.direction='outgoing' and m.state in ('accepted','delivered') and nullif(m.provider_id,'') is not null)
  and icash_sender_private.replied(p_account,thread_id,admitted_at,admitted_at+interval '24 hours'))>=5
 from sample);
end $$;

-- A row update serializes contenders for the last slot. A conflicting transaction
-- using stronger snapshot isolation fails before its transport is authorized.
create function icash_sender_private.take(p_source text,p_id uuid,p_sender text,p_cold boolean,
 p_account uuid default null,p_thread uuid default null,p_cohort text default null,p_opener boolean default false)
returns boolean language plpgsql set search_path='' as $$
begin
 if p_sender is null or p_sender !~ '^\+[1-9][0-9]{7,14}$' or p_id is null then return false;end if;
 insert into icash_sender_private.lines values(p_sender) on conflict(sender) do update set sender=excluded.sender;
 if not icash_sender_private.room(p_sender,p_cold,p_account,p_cohort) then return false;end if;
 insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at,account_id,thread_id,cohort,opener)
 values(p_source,p_id,p_sender,p_cold,clock_timestamp(),p_account,p_thread,p_cohort,p_opener)
 on conflict(source,source_id) do nothing;
 return found;
end $$;

create function icash_sender_private.transactional(m public.icash_text_messages,t public.icash_text_threads)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_contract_text_deliveries d where d.message_id=m.id and d.thread_id=t.id and d.account_id=t.account_id)
 or exists(select 1 from public.icash_cancellation_notices n where n.sms_id=m.id and n.account_id=t.account_id and n.destination=t.recipient)
 or exists(select 1 from public.icash_meta_lead_messages link join public.icash_meta_leads l on l.lead_id=link.lead_id
   join public.icash_seller_intakes i on i.id=l.lead_id and i.phone=t.recipient
   join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id and d.screening_id=l.screening_id
   where link.message_id=m.id and link.purpose in ('initial','address_link','reply') and l.account_id=t.account_id
    and l.consent_receipt is not null and l.submitted_at<=m.created_at and l.contact_until>=m.created_at)
 or exists(select 1 from public.icash_text_ai_jobs j where j.outgoing_id=m.id and j.account_id=t.account_id and j.thread_id=t.id
    and icash_sender_private.replied(t.account_id,t.id,m.created_at-interval '30 days',m.created_at,j.message_id))
 or (m.customer_author_id is not null and icash_sender_private.replied(t.account_id,t.id,m.created_at-interval '7 days',m.created_at))
$$;

create function icash_sender_private.message_binding(m public.icash_text_messages,p_recipient text)
returns text language sql stable set search_path='' as $$
 select md5(jsonb_build_array(m.account_id,m.thread_id,m.request_key,m.body,m.attachments,m.asset_ids,m.customer_author_id,m.route_revision,p_recipient)::text)
$$;

create function icash_sender_private.property_dispatch() returns trigger language plpgsql set search_path='' as $$
declare t public.icash_text_threads; cold boolean; key text; opener boolean; waiting icash_sender_private.waiting;
begin
 if tg_op='UPDATE' and old.state='dispatching' then return new;end if;
 select * into strict t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id;
 cold:=not icash_sender_private.transactional(new,t);
 select * into waiting from icash_sender_private.waiting where message_id=new.id;
 if found and (waiting.account_id<>t.account_id or waiting.thread_id<>t.id or waiting.sender<>t.sender
  or waiting.binding<>icash_sender_private.message_binding(new,t.recipient) or waiting.queued_at<now()-interval '24 hours'
  or not exists(select 1 from public.icash_accounts a where a.id=t.account_id and not a.bot_paused)
  or (waiting.claim_kind<>'manual' and (t.paused or t.ai_mode<>'auto'))
  or exists(select 1 from public.icash_text_messages newer where newer.thread_id=t.id and newer.account_id=t.account_id and newer.id<>new.id and newer.created_at>=new.created_at))
 then raise exception using errcode='PCT02',message='Deferred message changed';end if;
 if waiting.message_id is not null and cold and not icash_text_receipt_private.sender_opener_available(t.sender)
 then raise exception using errcode='PCT01',message='Sender is recovering';end if;
 if cold then key:=icash_sender_private.cohort(t.account_id,t.id);end if;
 opener:=cold and exists(select 1 from public.icash_seller_opener_assignments a where a.message_id=new.id and a.thread_id=t.id and a.account_id=t.account_id and a.body=new.body);
 if not icash_sender_private.take('property',new.id,t.sender,cold,t.account_id,t.id,key,opener)
 then raise exception using errcode='PCT01',message='Sender volume is full';end if;
 delete from icash_sender_private.waiting where message_id=new.id;
 return new;
end $$;

-- A failed final grant rolls back its entire claim, including wallet reservations.
-- Save only the exact unstarted message. Never recover a previously dispatched one.
create function icash_sender_private.defer(p_account uuid,p_message uuid,p_sender text,p_kind text) returns void
language sql set search_path='' as $$
 insert into icash_sender_private.waiting(message_id,account_id,thread_id,sender,claim_kind,binding,queued_at,next_check_at)
 select m.id,m.account_id,t.id,t.sender,p_kind,icash_sender_private.message_binding(m,t.recipient),clock_timestamp(),clock_timestamp()+interval '1 minute'
 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
 where m.id=p_message and m.account_id=p_account and t.sender=p_sender and m.direction='outgoing' and m.state='ready'
 and m.provider_id is null and m.last_delivery_at is null
 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||m.id)
 and not exists(select 1 from icash_sender_private.uses u where u.source='property' and u.source_id=m.id)
 on conflict(message_id) do nothing
$$;

-- Recovery takes no spending authority. Each send must pass its original claim again.
create function public.icash_next_sender_volume_retry() returns jsonb language plpgsql security invoker set search_path='' as $$
declare w icash_sender_private.waiting; m public.icash_text_messages; t public.icash_text_threads;
begin
 for w in select * from icash_sender_private.waiting where next_check_at<=now() order by next_check_at,queued_at limit 8 for update skip locked loop
  select * into m from public.icash_text_messages where id=w.message_id and account_id=w.account_id;
  select * into t from public.icash_text_threads where id=w.thread_id and account_id=w.account_id;
  if w.queued_at<now()-interval '24 hours' or m.id is null or t.id is null or m.state<>'ready' or m.provider_id is not null
   or t.sender<>w.sender or m.thread_id<>w.thread_id or icash_sender_private.message_binding(m,t.recipient)<>w.binding
   or t.retired_at is not null or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
   or exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id)
   or exists(select 1 from icash_sender_private.uses where source='property' and source_id=m.id)
   or exists(select 1 from public.icash_text_messages newer where newer.thread_id=t.id and newer.account_id=t.account_id and newer.id<>m.id and newer.created_at>=m.created_at)
  then delete from icash_sender_private.waiting where message_id=w.message_id;continue;end if;
  update icash_sender_private.waiting set next_check_at=now()+interval '5 minutes' where message_id=w.message_id;
  if not exists(select 1 from public.icash_accounts a where a.id=w.account_id and not a.bot_paused)
   or (w.claim_kind<>'manual' and (t.paused or t.ai_mode<>'auto'))
   or (not icash_sender_private.transactional(m,t) and not icash_text_receipt_private.sender_opener_available(w.sender))
   or not icash_sender_private.room(w.sender,not icash_sender_private.transactional(m,t),w.account_id,icash_sender_private.cohort(w.account_id,t.id))
  then continue;end if;
  return jsonb_build_object('accountId',w.account_id,'messageId',w.message_id,'claimKind',w.claim_kind);
 end loop;
 return null;
end $$;
revoke all on function public.icash_next_sender_volume_retry() from public,anon,authenticated;
grant execute on function public.icash_next_sender_volume_retry() to service_role;
revoke all on all functions in schema icash_sender_private from public, anon, authenticated;
grant execute on all functions in schema icash_sender_private to service_role;
grant select,insert,update on icash_sender_private.lines to service_role;
grant select,insert on icash_sender_private.uses to service_role;
grant select,insert,update,delete on icash_sender_private.waiting to service_role;

-- Install and initialize from existing grants in the same transaction. Even an
-- uncertain provider result occupies a slot. A callback never creates a second use.
lock table public.icash_text_messages,public.icash_purchase_phone_challenges,
 public.icash_purchase_access_followups,public.icash_customer_update_deliveries,
 public.icash_legacy_outbox,public.icash_webinar_outbox,public.icash_text_diagnostics
 in share row exclusive mode;
insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at,account_id,thread_id,cohort,opener)
select 'property',m.id,t.sender,case when a.message_id is not null then true else not icash_sender_private.transactional(m,t) end,
 coalesce(o.dispatched_at,m.updated_at),m.account_id,t.id,
 case when a.message_id is not null then icash_sender_private.cohort(t.account_id,t.id) end,a.message_id is not null
from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
left join public.icash_seller_opener_assignments a on a.message_id=m.id and a.thread_id=t.id and a.account_id=t.account_id and a.body=m.body
where m.direction='outgoing' and (o.dispatched_at>now()-interval '24 hours' or
 (o.dispatched_at is null and m.updated_at>now()-interval '24 hours' and (m.state in ('dispatching','accepted','delivered') or m.provider_id is not null
   or exists(select 1 from public.icash_owner_reply_attempts a where a.outgoing_id=m.id and a.state in ('dispatching','held')))))
 and t.sender is not null;
insert into icash_sender_private.uses(source,source_id,sender,cold,admitted_at)
select * from (
 select 'access-code',id,sender,false,least(expires_at,clock_timestamp()) from public.icash_purchase_phone_challenges
  where status<>'pending' and sender is not null and expires_at>now()-interval '24 hours'
 union all select 'access-followup',id,message->>'from',false,first_attempt_at from public.icash_purchase_access_followups
  where channel='sms' and message->>'from' is not null and first_attempt_at>now()-interval '24 hours'
 union all select 'customer-update',id,sender,false,authorized_at from public.icash_customer_update_deliveries
  where channel='sms' and sender is not null and authorized_at>now()-interval '24 hours'
 union all select 'legacy',id,sender,true,coalesce(sent_at,updated_at) from public.icash_legacy_outbox
  where channel='sms' and sender is not null and state in ('sending','accepted','uncertain','delivered','failed') and coalesce(sent_at,updated_at)>now()-interval '24 hours'
 union all select 'webinar',id,payload->>'from',true,first_attempt_at from public.icash_webinar_outbox
  where channel='sms' and payload->>'from' is not null and first_attempt_at>now()-interval '24 hours'
 union all select 'diagnostic',id,sender,false,updated_at from public.icash_text_diagnostics
  where state in ('dispatching','accepted','delivered','needs_review') and sender is not null and updated_at>now()-interval '24 hours'
) history;

create trigger icash_property_sender_volume before insert or update of state on public.icash_text_messages
 for each row when (new.direction='outgoing' and new.state='dispatching') execute function icash_sender_private.property_dispatch();

-- Keep each existing admission and its lock order. Refuse to patch an unreviewed
-- predecessor or ambiguous call site. The public functions keep their original ACLs.
do $patch$
declare r record; d text; needle text; replacement text;
begin
 for r in select * from (values
 ('public.icash_claim_text(uuid,uuid,text)','efd5884336d3f0fca93af7bc45b15b65','automatic'),
 ('public.icash_claim_customer_text(uuid,uuid,text)','a6caa12936e2749ebf26654e741e944e','manual'),
 ('public.icash_meta_claim_text(uuid,uuid,text)','9c066ef61adeddf52fb11282cf2cf26e','meta'),
 ('public.icash_prepare_owner_reply(uuid,text,jsonb)','b5ca5d236d52d2ff163a6538e3945b42','practice'),
 ('public.icash_claim_text_diagnostic(text,text)','5da472ac2238c8ec774d348ec4a497bb','diagnostic'),
 ('public.icash_claim_customer_update(uuid,boolean,boolean)','749cd41f72329490280e359de93d3fc9','customer-claim'),
 ('public.icash_authorize_customer_update(uuid,uuid)','904ed0eccd1958ad19557335ef06611b','customer-auth'),
 ('public.icash_authorize_phone_challenge(uuid,text)','0d0fbe0e3188a01a9bde6b0278d6267c','otp'),
 ('public.icash_authorize_purchase_access_followup(uuid,uuid,jsonb)','3e9c7647069a460de5e80bf4e029cd80','access'),
 ('public.icash_legacy_authorize(uuid)','bb384c29855862aa882ed1cd18d9e96b','legacy'),
 ('public.icash_webinar_authorize_followup(uuid,jsonb)','f98c67b1c5285fa0f7fa8beb903df486','webinar'),
 ('public.icash_seller_opener_candidate_body(uuid,uuid)','b54f72895db9540b4229b01e00d019ad','opener'),
 ('public.icash_queue_seller_opener(uuid,uuid)','f3d92a16edba7bf1b22eb21f22cc4c7a','opener'),
 ('public.icash_next_seller_followup()','450b939546f7085feb20bf8f8898fab7','followup'),
 ('public.icash_recover_unstarted_seller_opener()','109c1751442b53eb78ae71212f78c07a','recover')
 ) v(signature,expected,kind) loop
  d:=pg_get_functiondef(r.signature::regprocedure);
  if md5(d)<>r.expected then raise exception 'Sender volume prerequisite changed: %',r.signature;end if;
  case
  when r.kind in ('automatic','manual','meta','practice','diagnostic') then
   if r.kind='diagnostic' then
    needle:=' if not found then return null;end if;';
    if strpos(d,needle)=0 then raise exception 'Missing diagnostic claim';end if;
    d:=replace(d,needle,needle||$s$
 if not icash_sender_private.take('diagnostic',j.id,j.sender,false) then raise exception using errcode='PCT01';end if;$s$);
   end if;
   needle:='end $function$';
   replacement:='exception when sqlstate ''PCT01'' then '||
    case when r.kind in ('automatic','manual','meta') then format('perform icash_sender_private.defer(p_account,p_message,p_sender,%L); ',r.kind) else '' end||
    'return null;'||chr(10)||case when r.kind in ('automatic','manual','meta') then
     'when sqlstate ''PCT02'' then return null;'||chr(10) else '' end||needle;
  when r.kind='customer-claim' then
   needle:='insert into public.icash_customer_update_deliveries(account_id,channel';
   replacement:=$s$result:=gen_random_uuid();
  if chosen='sms' and not icash_sender_private.take('customer-update',result,public.icash_webinar_campaign_sender(p.phone),false) then continue;end if;
  insert into public.icash_customer_update_deliveries(id,account_id,channel$s$;
   if strpos(d,'values(p_account,chosen,s.source_key')=0 then raise exception 'Missing customer job id';end if;
   d:=replace(d,'values(p_account,chosen,s.source_key','values(result,p_account,chosen,s.source_key');
  when r.kind='customer-auth' then
   needle:='update public.icash_customer_update_deliveries set authorized_at=now(),sender=sender_phone';
   replacement:=$s$if n.channel='sms' and not exists(select 1 from icash_sender_private.uses where source='customer-update' and source_id=n.id and sender=sender_phone)
 and not icash_sender_private.take('customer-update',n.id,sender_phone,false) then return null;end if;
 $s$||needle;
  when r.kind='otp' then
   needle:='update public.icash_purchase_phone_challenges set status=''sending''';
   replacement:=$s$if not icash_sender_private.take('access-code',c.id,c.sender,false) then return false;end if;
 $s$||needle;
  when r.kind='access' then
   needle:='update public.icash_purchase_access_followups set message=candidate,status=''sending''';
   replacement:=$s$if f.channel='sms' and not icash_sender_private.take('access-followup',f.id,sender_phone,false) then
  update public.icash_purchase_access_followups set status='pending',next_attempt_at=now()+interval '5 minutes',attempts=greatest(0,attempts-1)
  where id=f.id and first_attempt_at is null;return null;end if;
 $s$||needle;
  when r.kind='legacy' then
   needle:='return jsonb_build_object(''id'',j.id,''channel'',j.channel';
   replacement:=$s$if j.channel='sms' and not icash_sender_private.take('legacy',j.id,j.sender,true) then
  if not exists(select 1 from icash_sender_private.uses where source='legacy' and source_id=j.id) then
   update public.icash_legacy_outbox set state='queued',due_at=now()+interval '5 minutes',updated_at=now() where id=j.id and state='sending' and provider_id is null;
  end if;return null;end if;
 $s$||needle;
  when r.kind='webinar' then
   needle:='update public.icash_webinar_outbox set state=''sending'',payload=candidate';
   replacement:=$s$if f.channel='sms' and not icash_sender_private.take('webinar',f.id,candidate->>'from',true) then
  update public.icash_webinar_outbox set state='pending',due_at=now()+interval '5 minutes',attempts=greatest(0,attempts-1)
  where id=f.id and first_attempt_at is null;return null;end if;
 $s$||needle;
  when r.kind='opener' then
   needle:='not icash_text_receipt_private.sender_opener_available(t.sender)';
   replacement:=needle||' or not icash_sender_private.room(t.sender,true,t.account_id,icash_sender_private.cohort(t.account_id,t.id))';
  when r.kind='followup' then
   needle:='and public.icash_seller_text_cadence_current(gap.account_id,t.id,gap.outgoing_id,true)';
   replacement:=needle||' and icash_sender_private.room(t.sender,true,t.account_id,icash_sender_private.cohort(t.account_id,t.id))';
  when r.kind='recover' then
   needle:='and public.icash_seller_text_cadence_current(ordered.account_id,ordered.thread_id,ordered.message_id)';
   replacement:=needle||' and exists(select 1 from public.icash_text_threads th where th.id=ordered.thread_id and th.account_id=ordered.account_id and icash_sender_private.room(th.sender,true,th.account_id,icash_sender_private.cohort(th.account_id,th.id)))';
  end case;
  if length(d)-length(replace(d,needle,''))<>length(needle) then raise exception 'Sender volume call site changed: %',r.signature;end if;
  execute replace(d,needle,replacement);
 end loop;
end $patch$;
commit;
