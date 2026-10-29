-- Capacity evidence is separate from delivery and money. Nothing here marks
-- the original export terminal, settles its cost, or permits its owner again.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create table icash_research_private.owner_export_capacity_reviews(
 id uuid primary key default gen_random_uuid(),
 export_id uuid not null unique references icash_research_private.owner_exports(id),
 receipt_hash text not null check(receipt_hash ~ '^[a-f0-9]{32}$'),
 reviewed_release text not null check(reviewed_release ~ '^[a-f0-9]{40}$'),
 created_at timestamptz not null default clock_timestamp(),
 state text not null default 'planned' check(state in ('planned','checking','held','verified')),
 request_id uuid unique,started_at timestamptz,checked_at timestamptz,receipt jsonb
);
alter table icash_research_private.owner_export_capacity_reviews enable row level security;
revoke all on icash_research_private.owner_export_capacity_reviews from public,anon,authenticated,service_role;
alter table icash_research_private.owner_exports add column capacity_review_id uuid unique references icash_research_private.owner_export_capacity_reviews(id);

create function icash_research_private.guard_export_capacity_review() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or row(old.id,old.export_id,old.receipt_hash,old.reviewed_release,old.created_at) is distinct from row(new.id,new.export_id,new.receipt_hash,new.reviewed_release,new.created_at)
  or (old.state in ('held','verified') and old is distinct from new)
  or (old.request_id is not null and row(old.request_id,old.started_at) is distinct from row(new.request_id,new.started_at))
  or (old.receipt is not null and old.receipt is distinct from new.receipt)
  or (old.state<>'planned' and new.state='planned') then raise exception 'Export capacity evidence is immutable';end if;
 return new;
end $$;
create trigger owner_export_capacity_review_immutable before update or delete on icash_research_private.owner_export_capacity_reviews for each row execute function icash_research_private.guard_export_capacity_review();

create function icash_research_private.guard_export_capacity_binding() returns trigger language plpgsql set search_path='' as $$
begin
 if old.capacity_review_id is not null and old.capacity_review_id is distinct from new.capacity_review_id then raise exception 'Export capacity binding is immutable';end if;
 if new.capacity_review_id is not null and not exists(select 1 from icash_research_private.owner_export_capacity_reviews r where r.id=new.capacity_review_id and r.export_id=new.id and r.state='verified' and r.receipt_hash=md5(new.receipt::text)) then raise exception 'Verified export capacity evidence required';end if;
 return new;
end $$;
create trigger owner_export_capacity_binding before update on icash_research_private.owner_exports for each row execute function icash_research_private.guard_export_capacity_binding();
revoke all on function icash_research_private.guard_export_capacity_review(),icash_research_private.guard_export_capacity_binding() from public,anon,authenticated,service_role;

-- A reviewed HTTP response has finished locally. A separate fresh, complete
-- organization inventory must establish provider idleness before new work.
-- An unreviewed failure or timeout retains the original global capacity hold.
create function public.icash_claim_export_capacity_review() returns jsonb
language plpgsql security definer set search_path='' as $$
declare r icash_research_private.owner_export_capacity_reviews;e icash_research_private.owner_exports;new_request uuid:=gen_random_uuid();
begin
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then return null;end if;
 select * into r from icash_research_private.owner_export_capacity_reviews where state='planned' order by created_at,id limit 1 for update skip locked;
 if not found or not public.icash_dealmachine_capacity_available(1) then return null;end if;
 select * into e from icash_research_private.owner_exports where id=r.export_id for update;
 if not found or e.terminal_at is not null or e.completed_at is not null or e.capacity_review_id is not null
  or md5(e.receipt::text) is distinct from r.receipt_hash or e.receipt->'httpStatus' is distinct from '500'::jsonb
  or e.receipt#>>'{raw,error,code}' is distinct from 'internal_error'
  or coalesce(e.receipt#>>'{raw,error,request_id}','') !~ '^req_[A-Za-z0-9_-]{1,100}$'
  or (e.receipt->'raw') ? 'export_id'
  or not exists(select 1 from icash_research_private.requests q where q.id=e.id and q.admitted and q.finished_at is not null and q.result->>'outcome'='http_error' and q.result->'httpStatus'='500'::jsonb)
  or exists(select 1 from icash_research_private.owner_exports x where x.id<>e.id and x.terminal_at is null and x.capacity_review_id is null)
  then update icash_research_private.owner_export_capacity_reviews set state='held' where id=r.id;return null;end if;
 if not public.icash_take_dealmachine_request('owner_preview',null,'export-capacity-review:'||r.id,new_request) then return null;end if;
 update icash_research_private.owner_export_capacity_reviews set state='checking',request_id=new_request,started_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('reviewId',r.id,'requestId',new_request);
end $$;

create function public.icash_record_export_capacity_review(p_review uuid,p_receipt jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare r icash_research_private.owner_export_capacity_reviews;e icash_research_private.owner_exports;b icash_research_private.owner_batches;data jsonb;row jsonb;valid boolean:=false;latest timestamptz;stamp timestamptz;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then return 'held';end if;
 select * into r from icash_research_private.owner_export_capacity_reviews where id=p_review for update;
 if not found then return 'held';end if;
 if r.receipt is not null then return case when r.state='verified' and r.receipt=p_receipt then 'capacity_verified' else 'held' end;end if;
 if r.state<>'checking' or p_receipt is null or jsonb_typeof(p_receipt)<>'object' or octet_length(p_receipt::text)>2200000 then return 'held';end if;
 -- Save every original response privately even when parsing/validation fails.
 update icash_research_private.owner_export_capacity_reviews set receipt=p_receipt,checked_at=clock_timestamp() where id=r.id;
 select * into e from icash_research_private.owner_exports where id=r.export_id for update;
 select * into b from icash_research_private.owner_batches where id=e.id;
 begin
  data:=p_receipt->'raw'->'data';
  valid:=r.started_at>clock_timestamp()-interval '30 seconds'
   and e.terminal_at is null and e.completed_at is null and e.capacity_review_id is null
   and md5(e.receipt::text)=r.receipt_hash
   and p_receipt->'httpStatus'='200'::jsonb and (p_receipt->>'rawText')::jsonb=p_receipt->'raw'
   and p_receipt->'raw'->'pagination' @> '{"limit":100,"offset":0,"has_more":false}'::jsonb
   and jsonb_typeof(data)='array' and jsonb_array_length(data) between 1 and 100
   and p_receipt->'raw'->'pagination'->'total'=to_jsonb(jsonb_array_length(data))
   and (select count(distinct x->>'export_id') from jsonb_array_elements(data) x)=jsonb_array_length(data)
   and coalesce(p_receipt#>>'{headers,minuteRemaining}','') ~ '^[0-9]{1,10}$' and (p_receipt#>>'{headers,minuteRemaining}')::bigint>0
   and coalesce(p_receipt#>>'{headers,dayRemaining}','') ~ '^[0-9]{1,10}$' and (p_receipt#>>'{headers,dayRemaining}')::bigint>0
   and exists(select 1 from icash_research_private.requests q where q.id=r.request_id and q.admitted and q.kind='owner_preview' and q.operation_key='export-capacity-review:'||r.id)
   and not exists(select 1 from icash_research_private.owner_exports x where x.id<>e.id and x.terminal_at is null and x.capacity_review_id is null);
  if valid is true then
   for row in select value from jsonb_array_elements(data) loop
    if coalesce(row->>'export_id','') !~ '^[-a-zA-Z0-9_]{1,128}$' or coalesce(row->>'status','') not in ('failed','completed') then valid:=false;exit;end if;
    stamp:=(row->>'created_at')::timestamptz;
    if stamp is null or stamp>clock_timestamp()+interval '5 seconds' then valid:=false;exit;end if;
    latest:=greatest(latest,stamp);
   end loop;
   -- Never use an empty or pre-incident inventory as proof of idle capacity.
   valid:=valid and latest>=b.created_at;
  end if;
 exception when others then valid:=false;
 end;
 if valid is distinct from true then update icash_research_private.owner_export_capacity_reviews set state='held' where id=r.id;return 'held';end if;
 update icash_research_private.owner_export_capacity_reviews set state='verified' where id=r.id;
 update icash_research_private.owner_exports set capacity_review_id=r.id where id=e.id;
 return 'capacity_verified';
end $$;

drop index icash_research_private.owner_export_one_pending;
create unique index owner_export_one_pending on icash_research_private.owner_exports((true)) where terminal_at is null and capacity_review_id is null;
create index owner_export_unresolved_people on icash_research_private.owner_exports using gin ((request->'people_ids')) where completed_at is null;
create function public.icash_owner_export_people_available(p_ids jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select jsonb_typeof(p_ids)='array' and jsonb_array_length(p_ids) between 1 and 125
 and not exists(select 1 from icash_research_private.owner_exports e where e.completed_at is null and (e.request->'people_ids') ?| array(select jsonb_array_elements_text(p_ids)));
$$;
do $$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 needle:='where terminal_at is null';
 if strpos(d,needle)=0 or strpos(d,'capacity_review_id')>0 then raise exception 'Export admission changed';end if;
 execute replace(d,needle,'where terminal_at is null and capacity_review_id is null');
 d:=pg_get_functiondef('public.icash_owner_active_export_capacity()'::regprocedure);
 if strpos(d,needle)=0 or strpos(d,'capacity_review_id')>0 then raise exception 'Export capacity changed';end if;
 execute replace(d,needle,'where terminal_at is null and capacity_review_id is null');
 d:=pg_get_functiondef('public.icash_claim_owner_batch(uuid,uuid,uuid,jsonb,jsonb,jsonb)'::regprocedure);
 needle:='perform 1 from public.icash_operating_budget where id=1 for update;';
 if strpos(d,needle)=0 or strpos(d,'icash_owner_export_people_available')>0 then raise exception 'Owner batch claim changed';end if;
 execute replace(d,needle,'if not public.icash_owner_export_people_available((select jsonb_agg(id) from jsonb_array_elements(p_items) i, jsonb_array_elements(i->''ids'') id)) then return false;end if;'||E'\n '||needle);
end $$;
revoke all on function public.icash_claim_export_capacity_review(),public.icash_record_export_capacity_review(uuid,jsonb),public.icash_owner_export_people_available(jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_export_capacity_review(),public.icash_record_export_capacity_review(uuid,jsonb),public.icash_owner_export_people_available(jsonb) to service_role;
commit;
