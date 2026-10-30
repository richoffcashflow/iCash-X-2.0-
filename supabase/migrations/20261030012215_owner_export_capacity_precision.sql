-- Provider inventory timestamps have whole-second precision. This is only
-- evidence of idle organization capacity, never an owner or cost association.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $migration$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_record_export_capacity_review(uuid,jsonb)'::regprocedure);
 needle:='valid:=valid and latest>=b.created_at;';
 if strpos(d,needle)=0 then raise exception 'Export inventory freshness guard changed';end if;
 execute replace(d,needle,'valid:=valid and latest>=date_trunc(''second'',b.created_at);');
end $migration$;

-- Preserve an already-held review. An operator may create one distinct,
-- quota-bound follow-up only for an otherwise complete same-second receipt.
alter table icash_research_private.owner_export_capacity_reviews
 add column supersedes uuid unique references icash_research_private.owner_export_capacity_reviews(id),
 add constraint owner_export_capacity_no_self_followup check(supersedes is distinct from id);
alter table icash_research_private.owner_export_capacity_reviews drop constraint owner_export_capacity_reviews_export_id_key;
create unique index owner_export_capacity_original_review on icash_research_private.owner_export_capacity_reviews(export_id) where supersedes is null;

create function icash_research_private.guard_capacity_precision_followup() returns trigger
language plpgsql set search_path='' as $$
declare p icash_research_private.owner_export_capacity_reviews;incident timestamptz;latest timestamptz;data jsonb;x jsonb;
begin
 if tg_op='UPDATE' then
  if old.supersedes is distinct from new.supersedes then raise exception 'Capacity review parent is immutable';end if;
  return new;
 end if;
 if new.supersedes is null then return new;end if;
 select * into p from icash_research_private.owner_export_capacity_reviews where id=new.supersedes;
 select b.created_at into incident from icash_research_private.owner_batches b where b.id=new.export_id;
 if p.id is null or p.supersedes is not null or p.state<>'held'
  or row(p.export_id,p.receipt_hash) is distinct from row(new.export_id,new.receipt_hash)
  or new.state<>'planned' or new.request_id is not null or new.started_at is not null or new.checked_at is not null or new.receipt is not null
  or p.receipt->'httpStatus' is distinct from '200'::jsonb or (p.receipt->>'rawText')::jsonb is distinct from p.receipt->'raw'
  or p.started_at is null or p.checked_at is null or p.checked_at-p.started_at not between interval '0 seconds' and interval '30 seconds'
  or incident is null then raise exception 'Held precision review required';end if;
 data:=p.receipt#>'{raw,data}';
 if jsonb_typeof(data) is distinct from 'array' or jsonb_array_length(data) not between 1 and 100
  or (p.receipt#>'{raw,pagination}' @> '{"limit":100,"offset":0,"has_more":false}'::jsonb) is distinct from true
  or p.receipt#>'{raw,pagination,total}' is distinct from to_jsonb(jsonb_array_length(data))
  or (select count(distinct v->>'export_id') from jsonb_array_elements(data) v)<>jsonb_array_length(data)
  or coalesce(p.receipt#>>'{headers,minuteRemaining}','') !~ '^[0-9]{1,10}$' or (p.receipt#>>'{headers,minuteRemaining}')::bigint<=0
  or coalesce(p.receipt#>>'{headers,dayRemaining}','') !~ '^[0-9]{1,10}$' or (p.receipt#>>'{headers,dayRemaining}')::bigint<=0 then raise exception 'Complete idle precision evidence required';end if;
 for x in select value from jsonb_array_elements(data) loop
  if coalesce(x->>'export_id','') !~ '^[-a-zA-Z0-9_]{1,128}$' or coalesce(x->>'status','') not in ('failed','completed')
   or (x->>'created_at')::timestamptz is null or (x->>'created_at')::timestamptz>p.checked_at+interval '5 seconds' then raise exception 'Complete idle precision evidence required';end if;
  latest:=greatest(latest,(x->>'created_at')::timestamptz);
 end loop;
 if latest is distinct from date_trunc('second',incident) or latest>=incident then raise exception 'Same-second precision mismatch required';end if;
 return new;
end $$;
create trigger owner_export_capacity_precision_followup before insert or update on icash_research_private.owner_export_capacity_reviews
 for each row execute function icash_research_private.guard_capacity_precision_followup();
revoke all on function icash_research_private.guard_capacity_precision_followup() from public,anon,authenticated,service_role;
commit;
