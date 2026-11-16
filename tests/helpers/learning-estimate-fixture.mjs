import {readFileSync} from 'node:fs';
export const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
export const migration=read('config/learning-estimate-bookkeeping.sql');
const prior=read('config/learning-refresh-concurrency.sql');
export const predecessor=prior.slice(prior.indexOf('create or replace function public.icash_learning_changed()'),prior.indexOf('\ncreate or replace function public.icash_refresh_shared_learning'));
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const setup=`
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
create table public.icash_accounts(id uuid primary key);
create table public.icash_deal_files(id uuid primary key,account_id uuid);
create table public.icash_workspace_revisions(account_id uuid primary key,revision bigint not null default 1,changed_at timestamptz default now());
create table public.icash_learning_queue(account_id uuid primary key,generation bigint not null default 1,due_at timestamptz not null default now(),last_refreshed_at timestamptz);
create table public.icash_operation_spend(
 operation_key text primary key,account_id uuid not null,state text not null default 'dispatched',
 estimate_checked_at timestamptz,financial_checked_at timestamptz,
 actual_micros bigint,charged_cents bigint,settlement_evidence text,cost_basis text,receipt jsonb,
 updated_at timestamptz,lease_until timestamptz
);
create table public.fixture_learning_source(id integer primary key,account_id uuid,estimate_checked_at timestamptz);
create table public.icash_discovery_configs(account_id uuid primary key,next_run_at timestamptz,enabled boolean not null default true);
create schema fixture_other;
create table fixture_other.icash_operation_spend(id integer primary key,account_id uuid,estimate_checked_at timestamptz);
${predecessor}
revoke all on function public.icash_learning_changed() from public,anon,authenticated;
grant execute on function public.icash_learning_changed() to service_role;
create trigger icash_learning_change after insert or update or delete on public.icash_operation_spend for each row execute function public.icash_learning_changed();
create trigger icash_learning_change after insert or update or delete on public.fixture_learning_source for each row execute function public.icash_learning_changed();
create trigger icash_learning_change after insert or update or delete on public.icash_discovery_configs for each row execute function public.icash_learning_changed();
create trigger icash_learning_change after insert or update or delete on fixture_other.icash_operation_spend for each row execute function public.icash_learning_changed();
insert into public.icash_accounts values('${id(1)}'),('${id(2)}');
insert into public.icash_operation_spend(operation_key,account_id) values('synthetic-operation','${id(1)}');
`;
export const value=async(db,sql,args=[])=>Object.values((await db.query(sql,args)).rows[0]??{})[0];
export const sourceHash=db=>value(db,"select md5(pg_get_functiondef('public.icash_learning_changed()'::regprocedure))");
export const metadata=db=>value(db,"select to_jsonb(p)-'prosrc' from pg_proc p where p.oid='public.icash_learning_changed()'::regprocedure");
export const progress=db=>value(db,`select jsonb_build_object('queue',to_jsonb(q),'revision',to_jsonb(r)) from icash_learning_queue q join icash_workspace_revisions r using(account_id) where q.account_id='${id(1)}'`);
