begin;
set local lock_timeout='3s';
set local statement_timeout='15s';

-- A wakeup can arrive while aggregates are rebuilding. Its generation must
-- survive completion of the older refresh, even when due_at was already due.
alter table public.icash_learning_queue add column generation bigint not null default 1 check(generation>0);

create or replace function public.icash_learning_changed() returns trigger
language plpgsql security definer set search_path='' as $$
declare item jsonb;account uuid;ignored text[]:=array['updated_at','next_poll_at','poll_attempts','next_attempt_at','attempts','lease_until','lease_token'];
begin
 -- Scheduler bookkeeping is not a new outcome or a workspace state change.
 if tg_table_name='icash_discovery_configs' then ignored:=ignored||array['next_run_at'];end if;
 if tg_op='UPDATE' and (to_jsonb(new)-ignored) is not distinct from (to_jsonb(old)-ignored) then return new;end if;
 item:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 account:=case when tg_table_name='icash_accounts' then (item->>'id')::uuid else (item->>'account_id')::uuid end;
 if account is null and item->>'deal_id' is not null then select account_id into account from public.icash_deal_files where id=(item->>'deal_id')::uuid;end if;
 if account is not null and exists(select 1 from public.icash_accounts where id=account) then
  insert into public.icash_workspace_revisions(account_id) values(account) on conflict(account_id) do update set revision=public.icash_workspace_revisions.revision+1,changed_at=now();
  insert into public.icash_learning_queue(account_id) values(account) on conflict(account_id) do update
   set due_at=least(public.icash_learning_queue.due_at,now()+interval '1 minute'),generation=public.icash_learning_queue.generation+1;
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.icash_refresh_shared_learning(p_limit integer default 2) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record;version bigint;refreshed integer:=0;failed integer:=0;attempted integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'Invalid learning batch';end if;
 if not exists(select 1 from public.icash_learning_conversion_cache where id=1 and updated_at>now()-interval '5 minutes') and pg_try_advisory_xact_lock(810211) then
  begin
   insert into public.icash_learning_conversion_cache(id,report) values(1,public.icash_usage_loop_report('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',false))
   on conflict(id) do update set report=excluded.report,updated_at=now();
  exception when others then failed:=failed+1;end;
 end if;
 -- Never lock the queue before rebuilding outcomes. Scheduling takes outcome
 -- locks before its trigger writes this queue; the reverse order deadlocked.
 -- Reuse the account refresh lock, nonblocking, with a bounded candidate scan.
 for item in select account_id from public.icash_learning_queue where due_at<=now() order by due_at,account_id limit p_limit*5 loop
  exit when attempted>=p_limit;
  if not pg_try_advisory_xact_lock(hashtextextended(item.account_id::text,81021)) then continue;end if;
  select generation into version from public.icash_learning_queue where account_id=item.account_id and due_at<=now();
  if not found then continue;end if;
  attempted:=attempted+1;
  begin
   perform public.icash_refresh_learning_account(item.account_id);
   update public.icash_learning_queue set due_at=now()+interval '1 hour',last_refreshed_at=now(),last_error_at=null
    where account_id=item.account_id and generation=version;
   refreshed:=refreshed+1;
  exception when others then
   update public.icash_learning_queue set due_at=now()+interval '5 minutes',last_error_at=now()
    where account_id=item.account_id and generation=version;
   failed:=failed+1;
  end;
 end loop;
 return jsonb_build_object('refreshed',refreshed,'failed',failed,'due',(select count(*) from public.icash_learning_queue where due_at<=now()));
end $$;

revoke all on function public.icash_learning_changed(),public.icash_refresh_shared_learning(integer) from public,anon,authenticated;
grant execute on function public.icash_learning_changed(),public.icash_refresh_shared_learning(integer) to service_role;
commit;
