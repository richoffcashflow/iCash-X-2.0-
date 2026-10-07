begin;
-- Apply after sms-property-routing. This prepares copy only: no threads, consent,
-- provider calls, reservations, launch flags, or already-queued bodies are changed.
set local lock_timeout='1s';
lock table public.icash_seller_matches in share row exclusive mode nowait;

do $prerequisite$
begin
 if to_regclass('public.icash_sms_routes') is null
  or not exists(
   select 1 from pg_catalog.pg_index i
   where i.indexrelid=to_regclass('public.icash_text_threads_active_property_number')
    and i.indrelid='public.icash_text_threads'::regclass and i.indisunique and i.indisvalid
    and i.indnkeyatts=4 and i.indnatts=4
    and pg_get_expr(i.indpred,i.indrelid)='(retired_at IS NULL)'
    and (select array_agg(a.attname::text order by k.ordinality)
     from unnest(i.indkey) with ordinality k(attnum,ordinality)
     join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.attnum)
     =array['account_id','deal_id','sender','recipient'])
  or to_regclass('public.icash_text_threads_active_number') is not null then
  raise exception 'Seller recipient variants require property-scoped SMS routing';
 end if;
end $prerequisite$;

-- A durable ordinal is separate from current matches. Removing/recreating a match
-- must not renumber an existing buyer or reuse a previously allocated slot.
-- Deliberately no cascading foreign keys: these ID-only assignment tombstones
-- contain no phone/name/address and survive deletion of the source match.
create table public.icash_seller_recipient_ordinals(
 lead_id uuid not null,
 account_id uuid not null,
 recipient_ordinal integer not null check(recipient_ordinal>0),
 primary key(lead_id,account_id),
 unique(lead_id,recipient_ordinal)
);
alter table public.icash_seller_recipient_ordinals enable row level security;
revoke all on public.icash_seller_recipient_ordinals from public,anon,authenticated,service_role;
grant select,insert on public.icash_seller_recipient_ordinals to service_role;

-- One-time deterministic snapshot; future lookup never reranks mutable matches.
insert into public.icash_seller_recipient_ordinals(lead_id,account_id,recipient_ordinal)
 select lead_id,account_id,row_number() over(partition by lead_id order by assigned_at,account_id)::integer
 from public.icash_seller_matches;

create function public.icash_record_seller_recipient_ordinal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.lead_id::text,219705));
 if not exists(select 1 from public.icash_seller_recipient_ordinals where lead_id=new.lead_id and account_id=new.account_id) then
  insert into public.icash_seller_recipient_ordinals(lead_id,account_id,recipient_ordinal)
   select new.lead_id,new.account_id,coalesce(max(recipient_ordinal),0)+1
   from public.icash_seller_recipient_ordinals where lead_id=new.lead_id;
 end if;
 return new;
end $$;
create trigger icash_record_seller_recipient_ordinal
 after insert or update of lead_id,account_id on public.icash_seller_matches
 for each row execute function public.icash_record_seller_recipient_ordinal();

create function public.icash_keep_seller_recipient_ordinal() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 raise exception 'Seller recipient ordinals are immutable';
end $$;
create trigger icash_keep_seller_recipient_ordinal
 before update or delete on public.icash_seller_recipient_ordinals
 for each row execute function public.icash_keep_seller_recipient_ordinal();

create function public.icash_seller_recipient_opener(p_account uuid,p_thread uuid,p_seller text,p_principal text,p_address text)
returns text language plpgsql stable security invoker set search_path='' as $$
declare ordinal integer;greeting text;body text;
begin
 -- Bind the ordinal to this exact active account/property/consented intake. Copy
 -- lookup is not authorization; the caller retains its full current consent gate.
 select o.recipient_ordinal into ordinal
 from public.icash_text_threads t
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_seller_matches m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id and m.screening_id=d.screening_id
 join public.icash_seller_recipient_ordinals o on o.lead_id=m.lead_id and o.account_id=m.account_id
 where t.id=p_thread and t.account_id=p_account and t.party='seller' and t.retired_at is null;
 if ordinal is null or ordinal not between 1 and 3
  or nullif(trim(p_principal),'') is null or nullif(trim(p_address),'') is null then return null;end if;
 greeting:=case when p_seller ~ '^[A-Za-z][A-Za-z]{0,30}$' then 'Hi '||p_seller||', ' else 'Hi, ' end;
 body:=case ordinal
  when 1 then greeting||'AI for '||p_principal||' here about a possible cash offer. Are you the owner of '||p_address||'?'
  when 2 then greeting||'AI for '||p_principal||' asking about a possible cash offer. Do you own '||p_address||'?'
  when 3 then greeting||'AI for '||p_principal||' reaching out about a possible cash offer. Is '||p_address||' your property?'
 end||' Reply STOP to opt out.';
 -- Never shorten an identity/address, omit AI/STOP, or silently buy more segments.
 if length(body)>160 or body ~ '[^A-Za-z0-9 .,!?]' then return null;end if;
 return body;
end $$;

-- Patch only the actual consented-intake body expression. Retain the current
-- account/principal lookup, budget/consent/route locks, sender, idempotency, and
-- owner-confirmation state machine. Abort atomically if production has drifted.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 needle:=$old$message_body:='Hi, is this '||case when seller is null then '' else seller||', ' end||'the owner of '||address||'?';$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Seller recipient opener prerequisite changed';
 end if;
 execute replace(definition,needle,$new$message_body:=public.icash_seller_recipient_opener(p_account,t.id,seller,principal,address);
  if message_body is null then return null;end if;$new$);
end $patch$;

revoke all on function public.icash_record_seller_recipient_ordinal(),public.icash_keep_seller_recipient_ordinal(),public.icash_seller_recipient_opener(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_record_seller_recipient_ordinal(),public.icash_keep_seller_recipient_ordinal(),public.icash_seller_recipient_opener(uuid,uuid,text,text,text) to service_role;
commit;
