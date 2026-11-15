-- A single reviewed, completed cost discrepancy may be isolated from unrelated
-- reminder checks. Original evidence, customer holds and unknown requests stay
-- unchanged. Install inactive; review and activation are private operator steps.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.icash_claim_seller_contact_refresh()'::regprocedure))<>'7dc5412062449c7bd304c0fa308ebb06' then
  raise exception 'Contact refresh isolation predecessor changed';
 end if;
end $$;

create table icash_seller_recovery_private.contact_refresh_isolation(
 id integer primary key check(id=1),refresh_id uuid not null unique,
 account_id uuid not null,snapshot jsonb not null,
 snapshot_hash text not null check(snapshot_hash~'^[a-f0-9]{64}$'),
 additional_reserved_micros bigint not null check(additional_reserved_micros between 1 and 12000),
 reviewed_at timestamptz not null default clock_timestamp(),review_reference text not null check(length(review_reference) between 10 and 1000),
 enabled boolean not null default false,activated_at timestamptz,release_sha text check(release_sha~'^[a-f0-9]{40}$'),
 claim_hash text not null check(claim_hash~'^[a-f0-9]{32}$'),
 check((activated_at is null)=(release_sha is null)),check(not enabled or activated_at is not null)
);
alter table icash_seller_recovery_private.contact_refresh_isolation enable row level security;
revoke all on icash_seller_recovery_private.contact_refresh_isolation from public,anon,authenticated,service_role;

create function icash_seller_recovery_private.keep_contact_refresh_isolation() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or to_jsonb(new)-array['enabled','activated_at','release_sha']
   is distinct from to_jsonb(old)-array['enabled','activated_at','release_sha']
  or (old.activated_at is not null and row(new.activated_at,new.release_sha) is distinct from row(old.activated_at,old.release_sha))
  or (old.activated_at is not null and not old.enabled and new.enabled)
 then raise exception 'Contact refresh isolation review is immutable';end if;
 return new;
end $$;
create trigger contact_refresh_isolation_immutable before update or delete on icash_seller_recovery_private.contact_refresh_isolation
 for each row execute function icash_seller_recovery_private.keep_contact_refresh_isolation();

-- This narrow receipt shape is NOT accepted as a billable or clear contact
-- result. It only bounds a separately reviewed historical planning exposure.
-- The second independent request ledger must report the same two used units.
create function icash_seller_recovery_private.contact_refresh_isolation_snapshot(p_refresh uuid) returns jsonb
language plpgsql stable security invoker set search_path='' set timezone='UTC' as $$
declare f icash_seller_recovery_private.contact_refreshes;o public.icash_operation_spend;
 r icash_research_private.requests;rate public.icash_operation_rates;s public.icash_data_cost_settings;
 c public.icash_operational_contacts;extra bigint;
begin
 select * into f from icash_seller_recovery_private.contact_refreshes where id=p_refresh;
 if not found or f.state<>'processed' or f.outcome is distinct from 'cost_review' or f.http_status is distinct from 200
  or f.requested_at>='2026-11-15T00:00:00Z'::timestamptz or f.response_at is null or f.response_at<f.requested_at
  or f.response_at>now() or f.receipt_id is not null or f.successor_contact_id is not null or f.original_snapshot is null then return null;end if;
 select * into o from public.icash_operation_spend where operation_key=f.operation_key and account_id=f.account_id;
 select * into r from icash_research_private.requests where id=f.request_id and account_id=f.account_id and operation_key=f.operation_key;
 select * into rate from public.icash_operation_rates where id=f.rate_id;
 select * into s from public.icash_data_cost_settings where provider='dealmachine';
 select * into c from public.icash_operational_contacts where id=f.original_contact_id and account_id=f.account_id;
 if o.operation_key is null or o.state<>'dispatched' or o.rate_id is distinct from f.rate_id
  or o.actual_micros is not null or o.charged_cents is not null or o.settled_at is not null or o.settlement_evidence is not null
  or o.created_at>f.requested_at or o.dispatched_at is null or o.dispatched_at>f.requested_at
  or o.reserved_micros<=0 or f.operation_key is distinct from 'dnc:'||f.gap_id
  or f.unit_cost_micros is distinct from o.data_unit_cost_micros or f.unit_cost_micros is distinct from s.credit_micros
  or f.unit_cost_micros not between 1 and 10000 or o.data_cost_basis is distinct from s.cost_basis
  or rate.id is null or rate.operation<>'contact_revalidation' or not rate.enabled
  or rate.verified_at>f.requested_at or rate.expires_at<=now() or rate.buffer_bps not between 0 and 2000
  or rate.costs_micros->'dealmachine' is distinct from to_jsonb(f.unit_cost_micros)
  or r.id is null or not r.admitted or r.kind<>'phone_dnc' or r.finished_at is null
  or r.created_at>f.requested_at or r.finished_at<r.created_at or r.finished_at>f.response_at
  or r.result->>'outcome' is distinct from 'response' or r.result->'httpStatus' is distinct from '200'::jsonb
  or r.result->'returned' is distinct from '1'::jsonb or r.result->'creditsUsed' is distinct from '2'::jsonb
  or c.id is null or jsonb_typeof(f.response->'data') is distinct from 'array'
 then return null;end if;
 if jsonb_array_length(f.response->'data')<>1
  or public.icash_operational_phone(f.response#>>'{data,0,input,number}') is distinct from c.phone
  or f.response#>'{data,0,matched}' is distinct from 'true'::jsonb
  or f.response->'totals' is distinct from '{"submitted":1,"matched":1,"unmatched":0}'::jsonb
  or f.response->'credits' is distinct from '{"used":2,"people":1,"deduplicated":1}'::jsonb
 then return null;end if;
 extra:=ceil(f.unit_cost_micros::numeric*(10000+rate.buffer_bps)/10000)::bigint;
 return jsonb_build_object('refresh',to_jsonb(f),'operation',to_jsonb(o)-'estimate_checked_at','request',to_jsonb(r),
  'rate',to_jsonb(rate),'dataCostSettings',to_jsonb(s),'originalContact',to_jsonb(c),
  'additionalReservedMicros',extra,'basis','Additional reported unit at original planning unit cost and buffer; not settled cost');
end $$;

create function icash_seller_recovery_private.contact_refresh_isolated(p_refresh uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from icash_seller_recovery_private.contact_refresh_isolation p
  join public.icash_operating_budget b on b.id=1 and b.enabled
  where p.refresh_id=p_refresh and p.enabled and p.activated_at is not null
   and p.claim_hash=md5(pg_get_functiondef('public.icash_claim_seller_contact_refresh()'::regprocedure))
   and p.snapshot=icash_seller_recovery_private.contact_refresh_isolation_snapshot(p_refresh)
   and b.reserved_micros >= (p.snapshot#>>'{operation,reserved_micros}')::bigint+p.additional_reserved_micros);
$$;

-- The original admission body is retained. Only one reviewed terminal record
-- can be omitted from the global barrier, and its own account cannot qualify.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_seller_contact_refresh()'::regprocedure);
 needle:=$old$where pending.response_at is null or (pending.outcome='cost_review' and spend.state<>'settled')$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Contact refresh isolation barrier changed';end if;
 d:=replace(d,needle,$new$where (pending.response_at is null or spend.state is distinct from 'settled')
   and not icash_seller_recovery_private.contact_refresh_isolated(pending.id)$new$);
 needle:=$old$and not exists(select 1 from icash_seller_recovery_private.contact_refreshes prior where prior.gap_id=g.id)$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Contact refresh candidate boundary changed';end if;
 d:=replace(d,needle,needle||$new$
   and not exists(select 1 from icash_seller_recovery_private.contact_refresh_isolation isolated
    left join public.icash_operation_spend original on original.operation_key=isolated.snapshot#>>'{operation,operation_key}'
    where isolated.account_id=g.account_id and (original.state is distinct from 'settled' or original.actual_micros is null
     or original.charged_cents is null or original.settled_at is null or nullif(original.settlement_evidence,'') is null))$new$);
 execute d;
end $patch$;

create function icash_seller_recovery_private.review_contact_refresh_isolation(p_refresh uuid,p_expected_hash text,p_reference text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare snap jsonb;
begin
 if p_expected_hash is null or p_expected_hash!~'^[a-f0-9]{64}$' or p_reference is null or length(p_reference) not between 10 and 1000 then return false;end if;
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;if not found then return false;end if;
 if exists(select 1 from icash_seller_recovery_private.contact_refresh_isolation) then return false;end if;
 snap:=icash_seller_recovery_private.contact_refresh_isolation_snapshot(p_refresh);
 if snap is null or encode(sha256(convert_to(snap::text,'UTF8')),'hex')<>p_expected_hash then return false;end if;
 insert into icash_seller_recovery_private.contact_refresh_isolation(id,refresh_id,account_id,snapshot,snapshot_hash,additional_reserved_micros,review_reference,claim_hash)
 values(1,p_refresh,(snap#>>'{refresh,account_id}')::uuid,snap,p_expected_hash,(snap->>'additionalReservedMicros')::bigint,p_reference,
  md5(pg_get_functiondef('public.icash_claim_seller_contact_refresh()'::regprocedure)));
 return true;
end $$;

create function icash_seller_recovery_private.activate_contact_refresh_isolation(p_expected_hash text,p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p icash_seller_recovery_private.contact_refresh_isolation;b public.icash_operating_budget;daily numeric;
begin
 if p_expected_hash is null or p_expected_hash!~'^[a-f0-9]{64}$' or p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 perform pg_advisory_xact_lock(726341927);
 select * into b from public.icash_operating_budget where id=1 and enabled for update;if not found then return false;end if;
 select * into p from icash_seller_recovery_private.contact_refresh_isolation where id=1 for update;
 if not found or p.snapshot_hash<>p_expected_hash or p.snapshot is distinct from icash_seller_recovery_private.contact_refresh_isolation_snapshot(p.refresh_id)
  or p.claim_hash<>md5(pg_get_functiondef('public.icash_claim_seller_contact_refresh()'::regprocedure)) then return false;end if;
 if p.activated_at is not null then return p.enabled and p.release_sha=p_release;end if;
 if exists(select 1 from icash_seller_recovery_private.contact_refreshes f join public.icash_operation_spend o on o.operation_key=f.operation_key
  where f.id<>p.refresh_id and (f.response_at is null or o.state is distinct from 'settled')) then return false;end if;
 if b.require_company_reserve then
  select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where state='settled' and settled_at>now()-interval '24 hours';
  if b.funded_micros-b.spent_micros-b.reserved_micros-b.protected_micros<p.additional_reserved_micros
   or b.daily_limit_micros is null or daily+b.reserved_micros+p.additional_reserved_micros>b.daily_limit_micros then return false;end if;
 end if;
 -- Extra platform planning reserve persists through rollback and original
 -- settlement. Only a separate reviewed reconciliation may release it later.
 update public.icash_operating_budget set reserved_micros=reserved_micros+p.additional_reserved_micros where id=1;
 update icash_seller_recovery_private.contact_refresh_isolation set enabled=true,activated_at=clock_timestamp(),release_sha=p_release where id=1;
 return true;
end $$;

revoke all on function icash_seller_recovery_private.keep_contact_refresh_isolation(),
 icash_seller_recovery_private.contact_refresh_isolation_snapshot(uuid),icash_seller_recovery_private.contact_refresh_isolated(uuid),
 icash_seller_recovery_private.review_contact_refresh_isolation(uuid,text,text),icash_seller_recovery_private.activate_contact_refresh_isolation(text,text)
 from public,anon,authenticated,service_role;
commit;
