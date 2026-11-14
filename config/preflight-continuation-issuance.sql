-- Correct the disabled first installation. Preserve every original ticket ID.
set local lock_timeout='5s';set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $$begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from icash_work_private.continuation_policy where id=1 for update;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and not enabled and activated_at is null and release_sha is null and issued=0)
  or exists(select 1 from icash_work_private.continuation_decisions)
  or md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))<>'af79d3cf17140cf94eff5ade974d9c84'
  or md5(pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure))<>'5af0c8dd0a364999f031a76ea8fa89a2'
  or md5(pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure))<>'7d36fdc9dcf45f0442cb94104bb2fb78'
  or md5(pg_get_functiondef('icash_work_private.activate_continuation_fairness(text)'::regprocedure))<>'73c199e58954bac846f6575171de4442'
 then raise exception 'Disabled continuation issuance prerequisite changed';end if;
end$$;
-- A contacts ticket is deliberately reused for the next valid preflight step.
-- Its fresh one-use token identifies an issuance; its original ID is unchanged.
alter table icash_work_private.continuation_decisions drop constraint continuation_decisions_pkey,drop constraint continuation_decisions_turn_key,
 add column issue_token_hash text not null check(issue_token_hash~'^[a-f0-9]{64}$'),
 add primary key(turn),add unique(ticket_id,issue_token_hash);
create or replace function icash_work_private.record_continuation_decision(p_ticket uuid,p_account uuid,p_screening uuid,p_continuation boolean) returns void
language plpgsql security definer set search_path='' as $$
declare turn_number bigint;source_id uuid;issue_hash text;prior icash_work_private.continuation_decisions;
begin
 -- Match the scheduler lock order even for a direct service-role invocation.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select encode(sha256(convert_to(token,'UTF8')),'hex') into issue_hash
  from public.icash_automation_tickets where id=p_ticket and account_id=p_account and state='issued'
   and screening_id is not distinct from p_screening and kind in ('contacts','discovery');
 if issue_hash is null or p_continuation is null then raise exception 'Continuation ticket changed';end if;
 select * into prior from icash_work_private.continuation_decisions where ticket_id=p_ticket and issue_token_hash=issue_hash;
 if found then
  if prior.account_id=p_account and prior.screening_id is not distinct from p_screening and prior.continuation=p_continuation then return;end if;
  raise exception 'Continuation issuance changed';
 end if;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled) then return;end if;
 if p_continuation then
  -- The ticket has just become issued, so rebind the source independently of
  -- the due helper's held-ticket predicate. Never select a stale sibling list.
  select p.id into source_id from icash_research_private.owner_export_preflights p
   where p.account_id=p_account and p.items->0->>'screeningId'=p_screening::text
    and ((p.state='waiting' and p.created_at>now()-interval '30 minutes' and p.created_at<=now()
      and p.next_check_at<=now() and p.deleted_at is null and p.cleanup_attempts=0)
     or (p.state='ready' and icash_research_private.owner_preflight_ready_current(p.id)))
    and icash_research_private.owner_preflight_list_known(p.id)
    and p.items=icash_research_private.owner_preflight_cohort(p_account,p_screening)
   order by case when p.state='ready' then p.checked_at else p.next_check_at end,p.created_at,p.id limit 1;
  if source_id is null then raise exception 'Continuation source changed';end if;
 end if;
 update icash_work_private.continuation_policy set issued=issued+1 where id=1 and enabled returning issued into turn_number;
 if not found then return;end if;
 insert into icash_work_private.continuation_decisions(ticket_id,account_id,screening_id,preflight_id,continuation,turn,issue_token_hash)
  values(p_ticket,p_account,p_screening,source_id,p_continuation,turn_number,issue_hash);
end $$;
alter table icash_work_private.continuation_policy add column recorder_hash text not null default '';
update icash_work_private.continuation_policy set recorder_hash=md5(pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure));
do $$declare d text;needle text:='if not found or p.scheduler_hash';begin
 d:=pg_get_functiondef('icash_work_private.activate_continuation_fairness(text)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continuation activation boundary changed';end if;
 execute replace(d,needle,'if not found or p.recorder_hash<>md5(pg_get_functiondef(''icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)''::regprocedure)) or p.scheduler_hash');
end$$;
