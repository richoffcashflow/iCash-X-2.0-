-- Recover scheduling capacity from completed HTTP 500 responses only. This
-- never retries an export, releases money, or removes the unresolved-owner fence.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table icash_research_private.export_capacity_automation (
 id integer primary key check(id=1), enabled boolean not null default false
);
insert into icash_research_private.export_capacity_automation(id) values(1);
alter table icash_research_private.owner_export_capacity_reviews
 add column auto_policy text check(auto_policy is null or auto_policy='idle-v1'),
 add column auto_attempt integer not null default 0 check(auto_attempt>=0),
 add constraint owner_export_auto_attempt check((auto_policy is null)=(auto_attempt=0));
create table icash_research_private.export_capacity_probes (
 review_id uuid not null references icash_research_private.owner_export_capacity_reviews(id),
 probe text not null check(probe in ('inventory','pending','processing')),
 request_id uuid not null unique references icash_research_private.requests(id),
 started_at timestamptz not null default clock_timestamp(),
 receipt jsonb, received_at timestamptz,
 primary key(review_id,probe)
);
alter table icash_research_private.export_capacity_automation enable row level security;
alter table icash_research_private.export_capacity_probes enable row level security;
revoke all on icash_research_private.export_capacity_automation,icash_research_private.export_capacity_probes from public,anon,authenticated,service_role;

create function icash_research_private.guard_capacity_probe() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or row(old.review_id,old.probe,old.request_id,old.started_at) is distinct from row(new.review_id,new.probe,new.request_id,new.started_at)
  or (old.receipt is not null and old is distinct from new) then raise exception 'Capacity probe is immutable';end if;
 return new;
end $$;
create trigger export_capacity_probe_immutable before update or delete on icash_research_private.export_capacity_probes
 for each row execute function icash_research_private.guard_capacity_probe();

-- Preserve the original manual precision-only follow-up. Automatic successors
-- are new FREE reads, never a reset of an earlier claim or its saved evidence.
do $patch$declare d text;needle text;begin
 d:=pg_get_functiondef('icash_research_private.guard_capacity_precision_followup()'::regprocedure);
 if md5(d)<>'add829bc71b0998c4d93cf4ce7384581' then raise exception 'Capacity follow-up prerequisite changed';end if;
 needle:=E'begin\n';
 if position(needle in d)=0 then raise exception 'Capacity follow-up guard changed';end if;
 d:=replace(d,needle,needle||$new$
 if tg_op='UPDATE' and row(old.auto_policy,old.auto_attempt) is distinct from row(new.auto_policy,new.auto_attempt) then raise exception 'Automatic capacity policy is immutable';end if;
 if new.auto_policy='idle-v1' then
  if tg_op='UPDATE' then
   if old.supersedes is distinct from new.supersedes then raise exception 'Capacity review parent is immutable';end if;
   return new;
  end if;
  if new.state<>'planned' or new.request_id is not null or new.receipt is not null or new.started_at is not null or new.checked_at is not null then raise exception 'Fresh automatic capacity claim required';end if;
  if new.supersedes is null then
   if new.auto_attempt<>1 then raise exception 'First automatic capacity attempt required';end if;
  else
   select * into p from icash_research_private.owner_export_capacity_reviews where id=new.supersedes;
   if p.id is null or p.auto_policy is distinct from 'idle-v1' or p.state not in ('checking','held')
    or row(p.export_id,p.receipt_hash) is distinct from row(new.export_id,new.receipt_hash)
    or new.auto_attempt<>p.auto_attempt+1
    or new.created_at<coalesce(p.started_at,p.created_at)+make_interval(secs=>least(3600,120*power(2,least(p.auto_attempt-1,5))::integer)) then raise exception 'Automatic capacity backoff required';end if;
  end if;
  return new;
 end if;
$new$);
 execute d;
end $patch$;

create function icash_research_private.capacity_source_current(p_export uuid,p_hash text) returns boolean
language plpgsql stable set search_path='' as $$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;
begin
 select * into e from icash_research_private.owner_exports where id=p_export;
 select * into b from icash_research_private.owner_batches where id=p_export;
 return e.id is not null and b.id is not null and e.terminal_at is null and e.completed_at is null and e.capacity_review_id is null
  and md5(e.receipt::text)=p_hash and e.receipt->'httpStatus'='500'::jsonb
  and e.receipt#>>'{raw,error,code}'='internal_error'
  and coalesce(e.receipt#>>'{raw,error,request_id}','') ~ '^req_[A-Za-z0-9_-]{1,100}$'
  and not (e.receipt->'raw') ? 'export_id' and (e.receipt->>'rawText')::jsonb=e.receipt->'raw'
  and exists(select 1 from icash_research_private.requests q where q.id=e.id and q.account_id=b.account_id and q.kind='owner_lookup' and q.admitted
   and q.finished_at<=now()-interval '1 minute' and q.result->>'outcome'='http_error' and q.result->'httpStatus'='500'::jsonb)
  and not exists(select 1 from icash_research_private.owner_exports x where x.id<>e.id and x.terminal_at is null and x.capacity_review_id is null);
exception when others then return false;
end $$;

create function public.icash_claim_automatic_export_capacity(p_release text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;r icash_research_private.owner_export_capacity_reviews;previous icash_research_private.owner_export_capacity_reviews;request uuid:=gen_random_uuid();
begin
 if p_release is null or p_release !~ '^[a-f0-9]{40}$' or not exists(select 1 from icash_research_private.export_capacity_automation where id=1 and enabled)
  or not public.icash_owner_active_export_enabled() or not public.icash_dealmachine_capacity_available(3)
  or not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then return null;end if;
 select * into e from icash_research_private.owner_exports where terminal_at is null and capacity_review_id is null for update;
 if not found or icash_research_private.capacity_source_current(e.id,md5(e.receipt::text)) is distinct from true then return null;end if;
 select * into previous from icash_research_private.owner_export_capacity_reviews where export_id=e.id order by created_at desc,id desc limit 1;
 if found then
  -- Explicit manual reviews retain their existing operator authority.
  if previous.auto_policy is distinct from 'idle-v1' or previous.receipt_hash<>md5(e.receipt::text) or previous.state not in ('checking','held')
   or coalesce(previous.started_at,previous.created_at)+make_interval(secs=>least(3600,120*power(2,least(previous.auto_attempt-1,5))::integer))>now() then return null;end if;
 end if;
 insert into icash_research_private.owner_export_capacity_reviews(export_id,receipt_hash,reviewed_release,auto_policy,auto_attempt,supersedes)
 values(e.id,md5(e.receipt::text),p_release,'idle-v1',coalesce(previous.auto_attempt,0)+1,previous.id) returning * into r;
 if not public.icash_take_dealmachine_request('owner_preview',null,'export-capacity-auto:'||r.id||':inventory',request) then
  update icash_research_private.owner_export_capacity_reviews set state='held' where id=r.id;return null;
 end if;
 update icash_research_private.owner_export_capacity_reviews set state='checking',request_id=request,started_at=clock_timestamp() where id=r.id;
 insert into icash_research_private.export_capacity_probes(review_id,probe,request_id) values(r.id,'inventory',request);
 return jsonb_build_object('reviewId',r.id,'requestId',request);
end $$;

create function public.icash_claim_export_capacity_probe(p_review uuid,p_probe text) returns uuid
language plpgsql security definer set search_path='' as $$
declare r icash_research_private.owner_export_capacity_reviews;request uuid:=gen_random_uuid();
begin
 if p_probe is null or p_probe not in ('pending','processing') or not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then return null;end if;
 select * into r from icash_research_private.owner_export_capacity_reviews where id=p_review for update;
 if not found or r.auto_policy is distinct from 'idle-v1' or r.state<>'checking' or r.started_at<clock_timestamp()-interval '45 seconds'
  or not exists(select 1 from icash_research_private.export_capacity_automation where id=1 and enabled)
  or icash_research_private.capacity_source_current(r.export_id,r.receipt_hash) is distinct from true
  or exists(select 1 from icash_research_private.export_capacity_probes where review_id=r.id and probe=p_probe)
  or not exists(select 1 from icash_research_private.export_capacity_probes where review_id=r.id and probe=case p_probe when 'pending' then 'inventory' else 'pending' end and receipt->'httpStatus'='200'::jsonb)
  or not public.icash_take_dealmachine_request('owner_preview',null,'export-capacity-auto:'||r.id||':'||p_probe,request) then return null;end if;
 insert into icash_research_private.export_capacity_probes(review_id,probe,request_id) values(r.id,p_probe,request);
 return request;
end $$;

create function public.icash_record_export_capacity_probe(p_review uuid,p_probe text,p_receipt jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare r icash_research_private.export_capacity_probes;
begin
 if p_receipt is null or jsonb_typeof(p_receipt)<>'object' or octet_length(p_receipt::text)>2200000 then return false;end if;
 select * into r from icash_research_private.export_capacity_probes where review_id=p_review and probe=p_probe for update;
 if not found then return false;end if;
 if r.receipt is not null then return r.receipt=p_receipt;end if;
 update icash_research_private.export_capacity_probes set receipt=p_receipt,received_at=clock_timestamp() where review_id=p_review and probe=p_probe;
 return true;
end $$;

create function public.icash_finish_automatic_export_capacity(p_review uuid) returns text
language plpgsql security definer set search_path='' as $$
declare r icash_research_private.owner_export_capacity_reviews;p icash_research_private.export_capacity_probes;raw jsonb;x jsonb;receipts jsonb;valid boolean:=true;latest timestamptz;stamp timestamptz;incident timestamptz;n integer;total integer;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then return 'capacity_review_held';end if;
 select * into r from icash_research_private.owner_export_capacity_reviews where id=p_review for update;
 if not found or r.auto_policy is distinct from 'idle-v1' then return 'capacity_review_held';end if;
 if r.state='verified' then return 'capacity_verified';end if;
 if r.state<>'checking' then return 'capacity_review_held';end if;
 select jsonb_object_agg(probe,jsonb_build_object('requestId',request_id,'receipt',receipt,'receivedAt',received_at)),count(*) into receipts,n from icash_research_private.export_capacity_probes where review_id=r.id;
 select created_at into incident from icash_research_private.owner_batches where id=r.export_id;
 valid:=n=3 and r.started_at>clock_timestamp()-interval '45 seconds' and incident is not null
  and exists(select 1 from icash_research_private.export_capacity_automation where id=1 and enabled)
  and icash_research_private.capacity_source_current(r.export_id,r.receipt_hash) is true;
 begin
  for p in select * from icash_research_private.export_capacity_probes where review_id=r.id loop
   raw:=p.receipt->'raw';
   if p.received_at is null or p.received_at-p.started_at not between interval '0 seconds' and interval '20 seconds'
    or p.receipt->'httpStatus' is distinct from '200'::jsonb or (p.receipt->>'rawText')::jsonb is distinct from raw
    or jsonb_typeof(raw->'data') is distinct from 'array' or raw#>'{pagination,limit}' is distinct from '100'::jsonb or raw#>'{pagination,offset}' is distinct from '0'::jsonb
    or coalesce(raw#>>'{pagination,total}','') !~ '^[0-9]{1,9}$'
    or coalesce(p.receipt#>>'{headers,minuteRemaining}','') !~ '^[0-9]{1,10}$' or (p.receipt#>>'{headers,minuteRemaining}')::bigint<=0
    or coalesce(p.receipt#>>'{headers,dayRemaining}','') !~ '^[0-9]{1,10}$' or (p.receipt#>>'{headers,dayRemaining}')::bigint<=0
    or not exists(select 1 from icash_research_private.requests q where q.id=p.request_id and q.admitted and q.kind='owner_preview' and q.operation_key='export-capacity-auto:'||r.id||':'||p.probe) then valid:=false;exit;end if;
   n:=jsonb_array_length(raw->'data');total:=(raw#>>'{pagination,total}')::integer;
   if p.probe<>'inventory' then
    if n<>0 or total<>0 or raw#>'{pagination,has_more}' is distinct from 'false'::jsonb then valid:=false;exit;end if;
   else
    if n not between 1 and 100 or n<>least(total,100) or raw#>'{pagination,has_more}' is distinct from to_jsonb(total>n)
     or (select count(distinct v->>'export_id') from jsonb_array_elements(raw->'data') v)<>n then valid:=false;exit;end if;
    for x in select value from jsonb_array_elements(raw->'data') loop
     if coalesce(x->>'export_id','') !~ '^[-a-zA-Z0-9_]{1,128}$' or coalesce(x->>'status','') not in ('failed','completed') then valid:=false;exit;end if;
     stamp:=(x->>'created_at')::timestamptz;
     if stamp is null or stamp>clock_timestamp()+interval '5 seconds' then valid:=false;exit;end if;
     latest:=greatest(latest,stamp);
    end loop;
   end if;
  end loop;
  valid:=valid and latest>=date_trunc('second',incident);
 exception when others then valid:=false;
 end;
 -- Keep every response. An interrupted attempt remains separate from a later
 -- read, including a late response that arrives after this final decision.
 update icash_research_private.owner_export_capacity_reviews set receipt=jsonb_build_object('policy','idle-v1','probes',coalesce(receipts,'{}')),checked_at=clock_timestamp(),state=case when valid is true then 'verified' else 'held' end where id=r.id;
 if valid is distinct from true then return 'capacity_review_held';end if;
 update icash_research_private.owner_exports set capacity_review_id=r.id where id=r.export_id;
 return 'capacity_verified';
end $$;

revoke all on function icash_research_private.guard_capacity_probe(),icash_research_private.capacity_source_current(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_automatic_export_capacity(text),public.icash_claim_export_capacity_probe(uuid,text),public.icash_record_export_capacity_probe(uuid,text,jsonb),public.icash_finish_automatic_export_capacity(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_automatic_export_capacity(text),public.icash_claim_export_capacity_probe(uuid,text),public.icash_record_export_capacity_probe(uuid,text,jsonb),public.icash_finish_automatic_export_capacity(uuid) to service_role;
notify pgrst,'reload schema';
commit;
