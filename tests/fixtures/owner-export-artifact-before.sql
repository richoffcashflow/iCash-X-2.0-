-- Synthetic native fixture; original immutable export table and recovery claim.
create schema icash_research_private;
create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,created_at timestamptz default now(),items jsonb,preview_receipt jsonb,paid_receipt jsonb);
create table icash_research_private.owner_export_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into icash_research_private.owner_export_settings values(1,false);
create table icash_research_private.owner_exports(
 id uuid primary key references icash_research_private.owner_batches(id),
 request jsonb not null,receipt jsonb,recovery jsonb,recovery_history jsonb not null default '[]',
 csv text,artifact_sha256 text,parsed_rows jsonb,terminal_at timestamptz,completed_at timestamptz,
 next_recover_at timestamptz not null default now(),recovery_attempts integer not null default 0,
 lease_token uuid,lease_until timestamptz
);
-- An unknown POST keeps this slot indefinitely. Lease expiry never clears it.
create unique index owner_export_one_pending on icash_research_private.owner_exports((true)) where terminal_at is null;
create index owner_export_recovery_due on icash_research_private.owner_exports(next_recover_at) where completed_at is null and receipt is not null and recovery_attempts<6;
alter table icash_research_private.owner_export_settings enable row level security;
alter table icash_research_private.owner_exports enable row level security;
revoke all on icash_research_private.owner_export_settings,icash_research_private.owner_exports from public,anon,authenticated,service_role;

create function icash_research_private.guard_owner_export() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Original export evidence is immutable';end if;
 if old.id is distinct from new.id or old.request is distinct from new.request
  or (old.receipt is not null and old.receipt is distinct from new.receipt)
  or (old.csv is not null and row(old.csv,old.artifact_sha256) is distinct from row(new.csv,new.artifact_sha256))
  or (old.parsed_rows is not null and old.parsed_rows is distinct from new.parsed_rows)
  or (old.terminal_at is not null and old.terminal_at is distinct from new.terminal_at)
  or (old.completed_at is not null and old is distinct from new)
  or new.recovery_attempts<old.recovery_attempts
  or not (new.recovery_history @> old.recovery_history) then raise exception 'Original export evidence is immutable';end if;
 return new;
end $$;
create trigger owner_export_immutable before update or delete on icash_research_private.owner_exports for each row execute function icash_research_private.guard_owner_export();
revoke all on function icash_research_private.guard_owner_export() from public,anon,authenticated,service_role;

create function public.icash_claim_owner_export_recovery(p_batch uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e icash_research_private.owner_exports;b icash_research_private.owner_batches;token uuid:=gen_random_uuid();
begin
 select * into e from icash_research_private.owner_exports where (p_batch is null or id=p_batch) and completed_at is null and receipt is not null
  and coalesce(receipt->'raw'->>'export_id','') ~ '^[-a-zA-Z0-9_]{1,128}$' and recovery_attempts<6 and next_recover_at<=clock_timestamp() and (lease_until is null or lease_until<clock_timestamp())
 order by next_recover_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 select * into strict b from icash_research_private.owner_batches where id=e.id;
 update icash_research_private.owner_exports set lease_token=token,lease_until=clock_timestamp()+interval '90 seconds',recovery_attempts=recovery_attempts+1,next_recover_at=clock_timestamp()+interval '10 minutes' where id=e.id;
 return jsonb_build_object('id',e.id,'accountId',b.account_id,'createdAt',to_char(b.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'items',b.items,'preview',b.preview_receipt,'request',e.request,'receipt',e.receipt,'recovery',e.recovery->'raw','csv',e.csv,'lease',token);
end $$;

revoke all on function public.icash_claim_owner_export_recovery(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_owner_export_recovery(uuid) to service_role;
