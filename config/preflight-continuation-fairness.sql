-- Disabled installation. Selection only; the final request/spend gates stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $$begin
 if md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))<>'f18773412034944d2eb90b7f6d94202f'
  or md5(pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure))<>'5af0c8dd0a364999f031a76ea8fa89a2'
 then raise exception 'Continuation fairness prerequisite changed';end if;
end $$;
create table icash_work_private.continuation_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 issued bigint not null default 0 check(issued>=0),release_sha text,activated_at timestamptz,
 scheduler_hash text not null default '',due_hash text not null default ''
);
insert into icash_work_private.continuation_policy(id) values(1);
create table icash_work_private.continuation_decisions(
 ticket_id uuid primary key references public.icash_automation_tickets(id),
 account_id uuid not null,screening_id uuid,preflight_id uuid,
 continuation boolean not null,turn bigint not null unique,recorded_at timestamptz not null default clock_timestamp()
);
alter table icash_work_private.continuation_policy enable row level security;
alter table icash_work_private.continuation_decisions enable row level security;
revoke all on icash_work_private.continuation_policy,icash_work_private.continuation_decisions from public,anon,authenticated,service_role;
grant select on icash_work_private.continuation_policy to service_role;
grant select on icash_work_private.continuation_decisions to service_role;
create function icash_work_private.preserve_continuation_decision() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Continuation decisions are append-only';end$$;
create trigger preserve_continuation_decision before update or delete or truncate on icash_work_private.continuation_decisions
 for each statement execute function icash_work_private.preserve_continuation_decision();
revoke all on function icash_work_private.preserve_continuation_decision() from public,anon,authenticated,service_role;
create function icash_work_private.record_continuation_decision(p_ticket uuid,p_account uuid,p_screening uuid,p_continuation boolean) returns void
language plpgsql security definer set search_path='' as $$
declare turn_number bigint;source_id uuid;
begin
 -- The caller holds the existing operating-budget lock and has just issued
 -- the original ticket. Both decision and fair turn commit with that issuance.
 if not exists(select 1 from public.icash_automation_tickets where id=p_ticket and account_id=p_account and state='issued'
  and screening_id is not distinct from p_screening and kind in ('contacts','discovery')) then raise exception 'Continuation ticket changed';end if;
 update icash_work_private.continuation_policy set issued=issued+1 where id=1 and enabled returning issued into turn_number;
 if not found then return;end if;
 if p_continuation then
  select id into source_id from icash_research_private.owner_export_preflights
   where account_id=p_account and items->0->>'screeningId'=p_screening::text
    and ((state='waiting' and created_at>now()-interval '30 minutes' and created_at<=now() and deleted_at is null and cleanup_attempts=0)
     or (state='ready' and icash_research_private.owner_preflight_ready_current(id)))
   order by next_check_at,id limit 1;
  if source_id is null then raise exception 'Continuation source changed';end if;
 end if;
 insert into icash_work_private.continuation_decisions(ticket_id,account_id,screening_id,preflight_id,continuation,turn)
  values(p_ticket,p_account,p_screening,source_id,p_continuation,turn_number);
end $$;
revoke all on function icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean) to service_role;

do $patch$
declare d text;needle text;
begin
 -- Keep the exact source-bound due predicate, including its three-request
 -- capacity gate. Existing paced headroom must accrue before a continuation
 -- can win a turn; ranking never invents provider capacity.
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 d:=replace(d,'minimum_quote bigint;','minimum_quote bigint;continuation_enabled boolean:=false;continuation_turn boolean:=false;was_continuation boolean:=false;');
 needle:='if not found then return null;end if;';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continuation budget lock changed';end if;
 d:=replace(d,needle,needle||E'\n select enabled,(issued%3)<>2 into continuation_enabled,continuation_turn from icash_work_private.continuation_policy where id=1;');
 needle:=E' order by\n  -- Ordinary overdue accounts';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continuation ranking changed';end if;
 d:=replace(d,needle,$rank$ order by
  -- Two continuation turns, then one ordinary turn, with work-conserving
  -- fallback. The existing five-row scan and budget lock remain authoritative.
  case when continuation_enabled then
   ((case when d.contacts_enabled and d.contact_rate_id is not null
     and public.icash_owner_active_export_capacity(d.account_id) in ('disabled','ready')
     then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end is not null)=continuation_turn)
   end desc nulls last,
  -- Ordinary overdue accounts$rank$);
 needle:='if j is not null then';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continuation candidate changed';end if;
 d:=replace(d,needle,needle||E'\n was_continuation:=continuation_enabled and public.icash_owner_preflight_due_at(c.account_id,j) is not null;');
 needle:='return jsonb_build_object(''token'',t.token);';
 if (length(d)-length(replace(d,needle,'')))<>2*length(needle) then raise exception 'Continuation issue boundary changed';end if;
 d:=replace(d,needle,E'if continuation_enabled then perform icash_work_private.record_continuation_decision(t.id,c.account_id,t.screening_id,coalesce(was_continuation,false));end if;\n '||needle);
 execute d;
end $patch$;
update icash_work_private.continuation_policy set
 scheduler_hash=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)),
 due_hash=md5(pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure));
create function icash_work_private.activate_continuation_fairness(p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare p icash_work_private.continuation_policy;
begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into p from icash_work_private.continuation_policy where id=1 for update;
 if not found or p.scheduler_hash<>md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))
  or p.due_hash<>md5(pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure)) then return false;end if;
 if p.enabled then return p.release_sha=p_release;end if;
 if p.activated_at is not null then return false;end if;
 update icash_work_private.continuation_policy set enabled=true,release_sha=p_release,activated_at=clock_timestamp() where id=1;
 return true;
end $$;
revoke all on function icash_work_private.activate_continuation_fairness(text) from public,anon,authenticated,service_role;
commit;
