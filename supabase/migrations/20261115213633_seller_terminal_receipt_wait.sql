-- Stop the exact call immediately; keep its automatic contact work waiting until
-- the original source result can establish refusal/suppression. No historical scan.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
create table icash_seller_agreement_private.terminal_receipt_policy(id int primary key check(id=1),installed_at timestamptz not null);
insert into icash_seller_agreement_private.terminal_receipt_policy values(1,clock_timestamp());
create table icash_seller_agreement_private.terminal_receipt_waits(
 kind text not null check(kind in ('call','inbound_call')),source_id uuid not null,
 account_id uuid not null,phone text not null check(phone ~ '^[+][1-9][0-9]{7,14}$'),contact_key text not null,
 screening_id uuid not null,operation_key text not null,requested_at timestamptz not null,
 resolved_at timestamptz,receipt_id text,primary key(kind,source_id),check((resolved_at is null)=(receipt_id is null))
);
create index seller_terminal_receipt_pending_contact on icash_seller_agreement_private.terminal_receipt_waits(account_id,phone) where resolved_at is null;
alter table icash_seller_agreement_private.terminal_receipt_policy enable row level security;
alter table icash_seller_agreement_private.terminal_receipt_waits enable row level security;
revoke all on icash_seller_agreement_private.terminal_receipt_policy,icash_seller_agreement_private.terminal_receipt_waits from public,anon,authenticated,service_role;
create function icash_seller_agreement_private.terminal_wait_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP<>'UPDATE' then raise exception 'Terminal source evidence cannot be deleted';end if;
 if (to_jsonb(new)-array['resolved_at','receipt_id']) is distinct from (to_jsonb(old)-array['resolved_at','receipt_id'])
  or old.resolved_at is not null or new.resolved_at is null or new.receipt_id is null then raise exception 'Terminal source evidence is immutable';end if;
 return new;
end $$;
revoke all on function icash_seller_agreement_private.terminal_wait_immutable() from public,anon,authenticated,service_role;
create trigger seller_terminal_wait_immutable before update or delete on icash_seller_agreement_private.terminal_receipt_waits for each row execute function icash_seller_agreement_private.terminal_wait_immutable();
create trigger seller_terminal_wait_no_truncate before truncate on icash_seller_agreement_private.terminal_receipt_waits for each statement execute function icash_seller_agreement_private.terminal_wait_immutable();
create function public.icash_capture_seller_terminal_wait() returns trigger language plpgsql security definer set search_path='' as $$
declare screen uuid;receipt text;finished timestamptz;
begin
 if new.last_action<>'stop' or new.end_requested_at is null or new.recording_sid is null or new.call_sid is null
  or not exists(select 1 from icash_seller_agreement_private.terminal_receipt_policy p where p.id=1 and new.end_requested_at>=p.installed_at) then return new;end if;
 if TG_TABLE_NAME='icash_call_recordings' then
  if new.party<>'seller' or new.call_context is null then return new;end if;
  select c.id::text,c.completed_at into receipt,finished from public.icash_live_conversations c
   where c.account_id=new.account_id and c.operation_key=new.operation_key and c.screening_id=new.screening_id and c.contact_key=new.contact_key
    and c.party='seller' and c.state='complete' and c.completed_at is not null and c.conversation_id is not null
    and (new.conversation_id is null or c.conversation_id=new.conversation_id);
  insert into icash_seller_agreement_private.terminal_receipt_waits values('call',new.id,new.account_id,new.to_phone,new.contact_key,new.screening_id,new.operation_key,new.end_requested_at,finished,receipt) on conflict do nothing;
 else
  if new.register_claimed_at is null then return new;end if;
  select d.screening_id into screen from icash_seller_agreement_private.inbound_bindings b
   join public.icash_deal_files d on d.id=b.deal_id and d.account_id=b.account_id
   join public.icash_text_threads t on t.id=b.thread_id and t.account_id=b.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=new.from_phone
   where b.session_id=new.id and b.account_id=new.account_id;
  if screen is null then return new;end if;
  select h.session_id::text,h.completed_at into receipt,finished from icash_seller_agreement_private.call_history h
   where h.session_id=new.id and h.account_id=new.account_id and h.screening_id=screen and h.contact_key=new.contact_key
    and h.conversation_id=new.conversation_id;
  insert into icash_seller_agreement_private.terminal_receipt_waits values('inbound_call',new.id,new.account_id,new.from_phone,new.contact_key,screen,new.operation_key,new.end_requested_at,finished,receipt) on conflict do nothing;
 end if;
 return new;
end $$;
create trigger seller_terminal_stop_wait after update of last_action on public.icash_call_recordings for each row execute function public.icash_capture_seller_terminal_wait();
create trigger seller_terminal_stop_wait after update of last_action on icash_recorded_reception_private.sessions for each row execute function public.icash_capture_seller_terminal_wait();
create function public.icash_resolve_seller_terminal_wait() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='icash_live_conversations' then
  if new.party<>'seller' or new.state<>'complete' or new.completed_at is null or new.conversation_id is null then return new;end if;
  update icash_seller_agreement_private.terminal_receipt_waits w set resolved_at=new.completed_at,receipt_id=new.id::text
   from public.icash_call_recordings r where w.kind='call' and w.source_id=r.id and w.resolved_at is null
    and w.account_id=new.account_id and w.operation_key=new.operation_key and w.screening_id=new.screening_id and w.contact_key=new.contact_key
    and r.account_id=w.account_id and r.operation_key=w.operation_key and r.to_phone=w.phone and r.contact_key=w.contact_key
    and (r.conversation_id is null or r.conversation_id=new.conversation_id);
 else
  update icash_seller_agreement_private.terminal_receipt_waits w set resolved_at=new.completed_at,receipt_id=new.session_id::text
   from icash_recorded_reception_private.sessions s where w.kind='inbound_call' and w.source_id=new.session_id and w.resolved_at is null
    and s.id=w.source_id and s.account_id=w.account_id and s.from_phone=w.phone and s.conversation_id=new.conversation_id
    and w.account_id=new.account_id and w.screening_id=new.screening_id and w.contact_key=new.contact_key;
 end if;
 return new;
end $$;
-- The existing source observer runs first and persists any hard stop in the same transaction.
create trigger zzz_seller_terminal_wait_result after insert or update of state on public.icash_live_conversations for each row execute function public.icash_resolve_seller_terminal_wait();
create trigger zzz_seller_terminal_wait_result after insert on icash_seller_agreement_private.call_history for each row execute function public.icash_resolve_seller_terminal_wait();
create function public.icash_seller_terminal_receipt_pending(p_account uuid,p_phone text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_seller_agreement_private.terminal_receipt_waits w where w.account_id=p_account and w.phone=p_phone and w.resolved_at is null)
$$;
revoke all on function public.icash_capture_seller_terminal_wait(),public.icash_resolve_seller_terminal_wait(),public.icash_seller_terminal_receipt_pending(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.icash_seller_terminal_receipt_pending(uuid,text) to service_role;
do $patch$
declare d text;old text;sig text;
begin
 -- Stop acquisition and final source-result processing serialize with existing
 -- spend admission. Acquire the budget lock before the recording row, never after.
 foreach sig in array array['public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb)','public.icash_transition_recorded_reception(uuid,uuid,text,bigint,text,jsonb)'] loop
  d:=pg_get_functiondef(sig::regprocedure);old:=E'begin\n select * into r from ';
  if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Terminal stop transition prerequisite changed: %',sig;end if;
  execute replace(d,old,E'begin\n if p_action=''stop'' then perform 1 from public.icash_operating_budget where id=1 for update;end if;\n select * into r from ');
 end loop;
 d:=pg_get_functiondef('public.icash_seller_response_operation_allowed(uuid,text)'::regprocedure);
 foreach old in array array['  if scope.cancellation_notice_id is not null then return true;end if;','  if scope.customer_author_id is not null then return true;end if;'] loop
  if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Terminal final-send prerequisite changed';end if;
  d:=replace(d,old,old||E'\n  if public.icash_seller_terminal_receipt_pending(p_account,scope.phone) then return false;end if;');
 end loop;
 old:='  if scope.email_id is null then return true;end if;';
 if (length(d)-length(replace(d,old,'')))<>length(old) then raise exception 'Terminal email admission prerequisite changed';end if;
 d:=replace(d,old,old||$email$
  if exists(select 1 from public.icash_seller_matches sm join public.icash_seller_intakes l on l.id=sm.lead_id
   where sm.account_id=p_account and sm.screening_id=scope.screening_id and lower(l.email)=lower(scope.recipient)
    and public.icash_seller_terminal_receipt_pending(p_account,l.phone)) then return false;end if;$email$);
 execute d;
end $patch$;
commit;
