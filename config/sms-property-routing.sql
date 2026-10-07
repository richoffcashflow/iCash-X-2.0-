begin;
-- Do not leave a snapshot gap for old-code thread inserts during rollout.
-- Busy deployments abort atomically; retry this unchanged migration when idle.
set local lock_timeout='1s';
lock table public.icash_text_threads,public.icash_text_messages in access exclusive mode nowait;
-- One durable owner per number pair; properties remain separate immutable threads.
-- Existing data is validated before the old uniqueness boundary is removed.
create table public.icash_sms_routes(
 sender text not null,recipient text not null,account_id uuid not null references public.icash_accounts(id),
 revision bigint not null default 1,needs_review boolean not null default false,
 primary key(sender,recipient)
);
alter table public.icash_sms_routes enable row level security;
revoke all on public.icash_sms_routes from public,anon,authenticated;
grant all on public.icash_sms_routes to service_role;
do $$begin
 if exists(select 1 from public.icash_text_threads group by sender,recipient having count(distinct account_id)>1) then
 raise exception 'SMS number pair has conflicting historical account ownership';end if;
end $$;
insert into public.icash_sms_routes(sender,recipient,account_id)
 select distinct sender,recipient,account_id from public.icash_text_threads;
alter table public.icash_text_messages add column route_revision bigint;
-- Existing single-property queues keep their unambiguous binding. Adding another
-- property invalidates them atomically; retired/ambiguous queues receive no revision.
update public.icash_text_messages m set route_revision=r.revision from public.icash_text_threads t,public.icash_sms_routes r
 where m.thread_id=t.id and r.sender=t.sender and r.recipient=t.recipient and m.account_id=t.account_id and (m.state<>'ready' or (t.retired_at is null and
  not exists(select 1 from public.icash_text_threads other where other.sender=t.sender and other.recipient=t.recipient and other.retired_at is null and other.id<>t.id)));
create table public.icash_sms_route_reviews(
 message_id uuid primary key references public.icash_text_messages(id),account_id uuid references public.icash_accounts(id),
 sender text not null,recipient text not null,candidate_threads uuid[] not null,
 reason text not null,created_at timestamptz not null default now(),resolved_at timestamptz,resolved_by uuid,resolution_revision bigint
);
alter table public.icash_sms_route_reviews enable row level security;
revoke all on public.icash_sms_route_reviews from public,anon,authenticated;
grant all on public.icash_sms_route_reviews to service_role;

create function public.icash_sms_thread_binding() returns trigger language plpgsql set search_path='' as $$
declare owner_id uuid;screening uuid;
begin
 if TG_OP='UPDATE' and row(new.account_id,new.deal_id,new.sender,new.recipient,new.party,new.seller_intake_id)
  is distinct from row(old.account_id,old.deal_id,old.sender,old.recipient,old.party,old.seller_intake_id) then
  raise exception 'SMS property and consent binding is immutable';end if;
 if TG_OP='UPDATE' then
  if old.retired_at is not null and new.retired_at is distinct from old.retired_at then raise exception 'Retired SMS threads cannot be reopened';end if;
  return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(new.recipient,74));
 select screening_id into screening from public.icash_deal_files where id=new.deal_id and account_id=new.account_id;
 if not found then raise exception 'SMS deal ownership mismatch';end if;
 insert into public.icash_sms_routes(sender,recipient,account_id) values(new.sender,new.recipient,new.account_id) on conflict do nothing;
 select account_id into owner_id from public.icash_sms_routes where sender=new.sender and recipient=new.recipient for update;
 if owner_id is distinct from new.account_id then raise exception 'SMS number pair belongs to another account';end if;
 if exists(select 1 from public.icash_text_threads t where t.sender=new.sender and t.recipient=new.recipient and t.retired_at is null and t.deal_id<>new.deal_id) then
  if new.party<>'seller' or exists(select 1 from public.icash_text_threads t where t.sender=new.sender and t.recipient=new.recipient and t.retired_at is null and t.party<>'seller') then
   raise exception 'Mixed-role SMS number pair requires review';end if;
  if new.seller_intake_id is null or public.icash_seller_contact_evidence(new.account_id,screening,new.seller_intake_id,new.recipient) is null then
   raise exception 'Separate assigned property consent required';end if;
 end if;
 return new;
end $$;
create trigger icash_00_sms_thread_binding before insert or update on public.icash_text_threads for each row execute function public.icash_sms_thread_binding();
create function public.icash_sms_route_changed() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' or new.retired_at is distinct from old.retired_at then
 update public.icash_sms_routes set revision=revision+1 where sender=new.sender and recipient=new.recipient;
 end if;return new;
end $$;
create trigger icash_sms_route_changed after insert or update on public.icash_text_threads for each row execute function public.icash_sms_route_changed();
drop index public.icash_text_threads_active_number;
create unique index icash_text_threads_active_property_number on public.icash_text_threads(account_id,deal_id,sender,recipient) where retired_at is null;

-- Conservative, deterministic address matching. Never infer a property from a price,
-- yes/no answer, recent send, manual state, or delivery receipt.
create function public.icash_sms_normalize_address(p_text text) returns text language sql immutable set search_path='' as $$
 select trim(regexp_replace(lower(coalesce(p_text,'')),'[^a-z0-9]+',' ','g'))
$$;
create function public.icash_sms_resolve_property(p_sender text,p_recipient text,p_body text) returns uuid language plpgsql set search_path='' as $$
declare total integer;matches integer;chosen uuid;normalized text:=public.icash_sms_normalize_address(p_body);
begin
 select count(*) into total from public.icash_text_threads where sender=p_sender and recipient=p_recipient and retired_at is null;
 if total=1 then return (select id from public.icash_text_threads where sender=p_sender and recipient=p_recipient and retired_at is null);end if;
 if total=0 or exists(select 1 from public.icash_text_threads where sender=p_sender and recipient=p_recipient and retired_at is null and party<>'seller') then return null;end if;
 select count(*),(array_agg(id))[1] into matches,chosen from (
  select t.id from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  cross join lateral (select public.icash_sms_normalize_address(split_part(d.terms->>'address',',',1)) address) a
  where t.sender=p_sender and t.recipient=p_recipient and t.retired_at is null
   and a.address ~ '^[0-9]+ [a-z0-9]+ [a-z0-9]+'
   and position(' '||a.address||' ' in ' '||normalized||' ')>0
 ) candidates;
 return case when matches=1 then chosen else null end;
end $$;

-- Replace only inbound selection in the receipt/STOP implementation. Existing outer
-- wrapper preserves shared-budget lock order; all provider-receipt logic is retained.
do $patch$
declare definition text;needle text:=$old$ select * into t from public.icash_text_threads where retired_at is null and sender=v->>'to' and recipient=v->>'from';$old$;
begin
 definition:=pg_get_functiondef('public.icash_ingest_text_event_before_operational(jsonb,boolean)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'SMS inbound routing prerequisite changed';end if;
 definition:=replace(definition,needle,$new$ select * into t from public.icash_text_threads where id=public.icash_sms_resolve_property(v->>'to',v->>'from',v->>'body');$new$);
 if position(E'begin\n' in definition)=0 then raise exception 'SMS inbound lock boundary changed';end if;
 execute regexp_replace(definition,E'begin\n',E'begin\n perform 1 from public.icash_operating_budget where id=1 for update;\n');
end $patch$;

-- A BEFORE INSERT gate makes unrouted messages invisible to all existing AI,
-- callback, contract, and property-signal triggers (which require a thread).
create function public.icash_sms_message_route() returns trigger language plpgsql set search_path='' as $$
declare t public.icash_text_threads;r public.icash_sms_routes;v jsonb;pair_sender text;pair_recipient text;
begin
 if TG_OP='UPDATE' then
  if row(new.thread_id,new.account_id,new.direction,new.route_revision) is distinct from row(old.thread_id,old.account_id,old.direction,old.route_revision) then raise exception 'SMS message route is immutable';end if;
  return new;
 end if;
 -- Provider retries and repeated queue requests must not advance routing state.
 if exists(select 1 from public.icash_text_messages m where (new.event_id is not null and m.event_id=new.event_id) or (new.provider_id is not null and m.provider_id=new.provider_id) or (new.request_key is not null and m.request_key=new.request_key)) then return null;end if;
 if new.thread_id is not null then
 select * into t from public.icash_text_threads where id=new.thread_id and account_id=new.account_id;
 if not found then raise exception 'SMS message account mismatch';end if;
 pair_sender:=t.sender;pair_recipient:=t.recipient;
 elsif new.direction='incoming' then
 select payload->'data' into v from public.icash_text_events where id=new.event_id;
 pair_sender:=v->>'to';pair_recipient:=v->>'from';
 end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(pair_recipient,74));
 select * into r from public.icash_sms_routes where sender=pair_sender and recipient=pair_recipient for update;
 if new.direction='outgoing' then
  if r.account_id is distinct from new.account_id or r.needs_review or t.retired_at is not null then raise exception 'SMS property routing requires review';end if;
 elsif r.account_id is not null then
  -- Any incoming message invalidates queued decisions; ambiguous replies hold all
  -- properties on the pair until an explicit property reply or human review.
  update public.icash_sms_routes set revision=revision+1,needs_review=(new.thread_id is null) where sender=pair_sender and recipient=pair_recipient returning * into r;
  if new.thread_id is null then new.account_id:=r.account_id;new.state:='needs_review';end if;
 end if;
 new.route_revision:=r.revision;
 return new;
end $$;
create trigger icash_00_sms_message_route before insert or update on public.icash_text_messages for each row execute function public.icash_sms_message_route();
create function public.icash_sms_save_route_review() returns trigger language plpgsql set search_path='' as $$
declare v jsonb;
begin
 if new.direction='incoming' and new.thread_id is null then
 select payload->'data' into v from public.icash_text_events where id=new.event_id;
 insert into public.icash_sms_route_reviews(message_id,account_id,sender,recipient,candidate_threads,reason)
 select new.id,new.account_id,v->>'to',v->>'from',coalesce(array_agg(t.id) filter(where t.id is not null),'{}'),
 'Property could not be identified unambiguously. Review before replying; no terms inferred.'
 from public.icash_text_threads t where t.sender=v->>'to' and t.recipient=v->>'from' and t.retired_at is null;
 end if;return new;
end $$;
create trigger icash_sms_save_route_review after insert on public.icash_text_messages for each row execute function public.icash_sms_save_route_review();

-- Keep legacy permissions and spend gates unchanged. Route CAS runs before any
-- provider reservation, including owner-authored manual sends.
create function public.icash_sms_message_route_current(p_account uuid,p_message uuid) returns boolean language plpgsql set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;r public.icash_sms_routes;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 if t.id is null or t.retired_at is not null then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into r from public.icash_sms_routes where sender=t.sender and recipient=t.recipient for update;
 if r.account_id is distinct from p_account or r.needs_review or m.route_revision is distinct from r.revision then
 update public.icash_text_messages set state='needs_review',updated_at=now() where id=m.id and state='ready';
 return false;end if;
 if exists(select 1 from public.icash_text_ai_jobs j join public.icash_text_messages source on source.id=j.message_id
   where j.outgoing_id=m.id and (source.thread_id is distinct from m.thread_id or source.account_id is distinct from p_account or source.route_revision is distinct from r.revision)) then
 update public.icash_text_messages set state='needs_review',updated_at=now() where id=m.id and state='ready';
 return false;end if;
 if exists(select 1 from public.icash_text_messages source where source.id=m.request_key and source.direction='incoming'
   and (source.thread_id is distinct from m.thread_id or source.account_id is distinct from p_account or source.route_revision is distinct from r.revision)) then
 update public.icash_text_messages set state='needs_review',updated_at=now() where id=m.id and state='ready';
 return false;end if;
 return true;
end $$;
do $patch$
declare signature text;definition text;
begin
 foreach signature in array array['public.icash_claim_text(uuid,uuid,text)','public.icash_claim_customer_text(uuid,uuid,text)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position(E'begin\n' in definition)=0 then raise exception 'SMS dispatch prerequisite changed: %',signature;end if;
 execute regexp_replace(definition,E'begin\n',E'begin\n if not public.icash_sms_message_route_current(p_account,p_message) then return null;end if;\n');
 end loop;
end $patch$;

-- Change all current insert conflict targets atomically with the unique index.
do $patch$
declare signature text;definition text;needle text:='on conflict(sender,recipient) where retired_at is null';
begin
 foreach signature in array array['public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)','public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)','public.icash_project_operational_sms_contacts(uuid)'] loop
 definition:=pg_get_functiondef(signature::regprocedure);
 if position(needle in definition)=0 then raise exception 'SMS thread insertion prerequisite changed: %',signature;end if;
 definition:=replace(definition,needle,'on conflict(account_id,deal_id,sender,recipient) where retired_at is null');
 -- A review may affect only its own property, never the pre-existing property.
 if signature like '%decide_authority%' then
 definition:=replace(definition,$old$where retired_at is null and sender=v->>'smsSender' and recipient=p->>'phone'$old$,$new$where retired_at is null and account_id=r.account_id and deal_id=d.id and sender=v->>'smsSender' and recipient=p->>'phone'$new$);
 end if;
 execute definition;
 end loop;
end $patch$;
revoke all on function public.icash_sms_thread_binding(),public.icash_sms_route_changed(),public.icash_sms_normalize_address(text),public.icash_sms_resolve_property(text,text,text),public.icash_sms_message_route(),public.icash_sms_save_route_review(),public.icash_sms_message_route_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_sms_normalize_address(text),public.icash_sms_resolve_property(text,text,text),public.icash_sms_message_route_current(uuid,uuid) to service_role;

-- Every queue entry must acquire the same budget lock before recipient/thread
-- locks. This includes retained internal implementations that remain callable.
do $locks$
declare signature text;definition text;
begin
 foreach signature in array array[
  'public.icash_queue_text(uuid,uuid,uuid,text,uuid[])',
  'public.icash_queue_ai_reply(uuid,uuid,text)',
  'public.icash_queue_ai_reply_before_campaign(uuid,uuid,text)',
  'public.icash_queue_buyer_package_text(uuid,uuid,text)',
  'public.icash_queue_seller_opener(uuid,uuid)',
  'public.icash_queue_seller_opener_before_campaign(uuid,uuid)',
  'public.icash_prepare_owner_reply(uuid,text,jsonb)',
  'public.icash_prepare_manual_text(uuid,uuid,uuid,text,jsonb)',
  'public.icash_retire_expired_practice_threads(uuid,text,text)'
 ] loop
  if to_regprocedure(signature) is null then raise exception 'SMS queue lock prerequisite missing: %',signature;end if;
  definition:=pg_get_functiondef(signature::regprocedure);
  if definition !~* '\mbegin\M[[:space:]]+' then raise exception 'SMS queue lock boundary changed: %',signature;end if;
  execute regexp_replace(definition,'\mbegin\M[[:space:]]+',E'begin\n perform 1 from public.icash_operating_budget where id=1 for update;\n','i');
 end loop;
end $locks$;
-- Practice replies are also bound to the exact inbound revision, never a new
-- property's number-pair context. No provider send is added by this migration.
do $patch$
declare definition text;needle text:=' body:=case p_action';
begin
 definition:=pg_get_functiondef('public.icash_prepare_owner_reply(uuid,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Practice SMS route prerequisite changed';end if;
 execute replace(definition,needle,$new$
 if not exists(select 1 from public.icash_text_messages source join public.icash_sms_routes r on r.sender=t.sender and r.recipient=t.recipient
  where source.id=a.message_id and source.thread_id=t.id and source.account_id=t.account_id
   and r.account_id=t.account_id and not r.needs_review and source.route_revision=r.revision) then
  update public.icash_owner_reply_attempts set state='held',result=p_result where id=a.id;return null;
 end if;
 body:=case p_action$new$);
end $patch$;

-- Account-level review never assigns the ambiguous quote to a property or feeds
-- it back through AI. The owner releases only the routing hold after seeing all
-- outstanding messages; all ordinary consent/manual/STOP gates still apply.
create function public.icash_sms_route_review_items(p_account uuid,p_offset integer default 0,p_limit integer default 7)
returns table(message_id uuid,recipient text,body text,attachments jsonb,created_at timestamptz,revision bigint,needs_review boolean,candidates jsonb)
language sql stable set search_path='' as $$
 select q.message_id,q.recipient,m.body,m.attachments,q.created_at,r.revision,r.needs_review,
 coalesce((select jsonb_agg(jsonb_build_object('threadId',t.id,'screeningId',d.screening_id,'address',d.terms->>'address') order by t.id)
 from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 where t.id=any(q.candidate_threads) and t.account_id=p_account),'[]'::jsonb)
 from public.icash_sms_route_reviews q join public.icash_sms_routes r on r.sender=q.sender and r.recipient=q.recipient and r.account_id=q.account_id
 join public.icash_text_messages m on m.id=q.message_id and m.account_id=q.account_id and m.thread_id is null
 where q.account_id=p_account and q.resolved_at is null
 order by q.created_at,q.message_id limit least(greatest(p_limit,1),7) offset least(greatest(p_offset,0),60000)
$$;
create function public.icash_review_sms_route(p_account uuid,p_actor uuid,p_message uuid,p_revision bigint)
returns boolean language plpgsql set search_path='' as $$
declare q public.icash_sms_route_reviews;r public.icash_sms_routes;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for share;
 if not found then return false;end if;
 select * into q from public.icash_sms_route_reviews where message_id=p_message and account_id=p_account;
 if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(q.recipient,74));
 select * into r from public.icash_sms_routes where sender=q.sender and recipient=q.recipient and account_id=p_account for update;
 select * into q from public.icash_sms_route_reviews where message_id=p_message and account_id=p_account for update;
 if q.resolved_at is not null then return q.resolved_by=p_actor and q.resolution_revision=p_revision;end if;
 if r.revision is distinct from p_revision then return false;end if;
 update public.icash_sms_route_reviews set resolved_at=now(),resolved_by=p_actor,resolution_revision=p_revision where message_id=p_message and resolved_at is null;
 if not exists(select 1 from public.icash_sms_route_reviews where sender=q.sender and recipient=q.recipient and resolved_at is null) then
 update public.icash_sms_routes set needs_review=false,revision=revision+1 where sender=q.sender and recipient=q.recipient;
 end if;
 return true;
end $$;
revoke all on function public.icash_sms_route_review_items(uuid,integer,integer),public.icash_review_sms_route(uuid,uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.icash_sms_route_review_items(uuid,integer,integer),public.icash_review_sms_route(uuid,uuid,uuid,bigint) to service_role;

commit;
