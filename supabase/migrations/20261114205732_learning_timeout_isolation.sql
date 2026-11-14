-- Persist completed accounts and observable cancellation without extending work budgets.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
do $$begin
 if md5(pg_get_functiondef('public.icash_refresh_shared_learning(integer)'::regprocedure))<>'1c6fe3654c98d458dea08ffc8ec6b038'
  or md5(pg_get_functiondef('public.icash_learning_health()'::regprocedure))<>'e50ce3a4ab3fa14eb48cf8e5ce52ec72'
 then raise exception 'Learning cancellation predecessor changed';end if;
end$$;

create or replace function public.icash_refresh_shared_learning(p_limit integer default 2) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare item record;version bigint;refreshed integer:=0;failed integer:=0;attempted integer:=0;cache_attempt boolean:=false;cancelled boolean:=false;cache_error text;last_code text;started timestamptz:=clock_timestamp();due integer;
begin
 if p_limit is null or p_limit not between 1 and 5 then raise exception 'Invalid learning batch';end if;
 if not exists(select 1 from public.icash_learning_conversion_cache where id=1 and updated_at>now()-interval '5 minutes') and not exists(select 1 from icash_learning_private.components where component='conversion' and last_error_code='57014' and last_error_at>now()-interval '5 minutes')
  and pg_try_advisory_xact_lock(810211) then
  cache_attempt:=true;
  begin
   insert into public.icash_learning_conversion_cache(id,report) values(1,public.icash_usage_loop_report('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',false))
   on conflict(id) do update set report=excluded.report,updated_at=now();
  exception when query_canceled or others then
   cache_error:=sqlstate;failed:=failed+1;cancelled:=sqlstate='57014';
  end;
 end if;
 -- Preserve outcome-before-queue lock order and generation-bound wakeups.
 if not cancelled then for item in select account_id from public.icash_learning_queue where due_at<=now()
  and (last_error_code is distinct from '57014' or last_error_at<=now()-interval '5 minutes')
  order by due_at,account_id limit p_limit*5 loop
  exit when cancelled or attempted>=p_limit;
  if not pg_try_advisory_xact_lock(hashtextextended(item.account_id::text,81021)) then continue;end if;
  select generation into version from public.icash_learning_queue where account_id=item.account_id and due_at<=now()
   and (last_error_code is distinct from '57014' or last_error_at<=now()-interval '5 minutes');
  if not found then continue;end if;
  attempted:=attempted+1;
  begin
   perform public.icash_refresh_learning_account(item.account_id);
   update public.icash_learning_queue set due_at=case when generation=version then now()+interval '1 hour' else due_at end,
    last_refreshed_at=case when generation=version then now() else last_refreshed_at end,last_success_at=now(),last_attempt_at=now(),last_error_at=null,last_error_code=null where account_id=item.account_id;
   refreshed:=refreshed+1;
  exception when query_canceled or others then
   last_code:=sqlstate;cancelled:=sqlstate='57014';
   update public.icash_learning_queue set due_at=case when generation=version then now()+interval '5 minutes' else due_at end,last_attempt_at=now(),last_error_at=now(),last_error_code=last_code where account_id=item.account_id;
   failed:=failed+1;
  end;
 end loop;end if;
 if cache_attempt then
  insert into icash_learning_private.components(component,last_attempt_at,last_success_at,last_error_at,last_error_code)
   values('conversion',now(),case when cache_error is null then now() end,case when cache_error is not null then now() end,cache_error)
   on conflict(component) do update set last_attempt_at=now(),last_success_at=coalesce(excluded.last_success_at,icash_learning_private.components.last_success_at),last_error_at=excluded.last_error_at,last_error_code=excluded.last_error_code;
 end if;
 if not cancelled then begin
  perform public.icash_review_learning_operations();
 exception when query_canceled or others then
  last_code:=sqlstate;cancelled:=sqlstate='57014';failed:=failed+1;
  insert into icash_learning_private.components(component,last_attempt_at,last_error_at,last_error_code) values('review',now(),now(),sqlstate)
  on conflict(component) do update set last_attempt_at=now(),last_error_at=now(),last_error_code=excluded.last_error_code;
 end;end if;
 insert into icash_learning_private.components(component,last_attempt_at,last_success_at,last_error_at,last_error_code)
 values('refresh',now(),case when failed=0 then now() end,case when failed>0 then now() end,coalesce(last_code,cache_error))
 on conflict(component) do update set last_attempt_at=now(),last_success_at=coalesce(excluded.last_success_at,icash_learning_private.components.last_success_at),last_error_at=excluded.last_error_at,last_error_code=excluded.last_error_code;

 select count(*) into due from public.icash_learning_queue where due_at<=now();
 insert into icash_learning_private.refresh_runs(started_at,completed_at,refreshed,failed,due,conversion_attempted,conversion_error) values(started,clock_timestamp(),refreshed,failed,due,cache_attempt,cache_error);
 if not cancelled then delete from icash_learning_private.refresh_runs where id in(select id from icash_learning_private.refresh_runs where completed_at<now()-interval '7 days' order by id limit 1000);end if;
 -- PostgreSQL uses 57014 for both statement timeouts and operator cancellation.
 -- Preserve a truthful receipt and stop; never start another expensive phase.
 if cancelled then raise warning 'Learning refresh canceled (SQLSTATE 57014); remaining work deferred';end if;
 return jsonb_build_object('refreshed',refreshed,'failed',failed,'due',due)
  ||case when cancelled then jsonb_build_object('canceled',true) else '{}'::jsonb end;
end $$;
revoke all on function public.icash_refresh_shared_learning(integer) from public,anon,authenticated;
grant execute on function public.icash_refresh_shared_learning(integer) to service_role;
-- A recent attempted refresh is observable, not proof of healthy completion.
-- Keep each existing category a single warning even when age and error overlap.
do $$declare d text;refresh_before text:='((not exists(select 1 from r where last_attempt_at>now()-interval ''2 minutes''))::integer+';
 cache_before text:='(not exists(select 1 from cache where updated_at>now()-interval ''15 minutes''))::integer+';
begin
 d:=pg_get_functiondef('public.icash_learning_health()'::regprocedure);
 if (length(d)-length(replace(d,refresh_before,'')))<>length(refresh_before)
  or (length(d)-length(replace(d,cache_before,'')))<>length(cache_before)
 then raise exception 'Learning health warning boundary changed';end if;
 d:=replace(d,refresh_before,'((not exists(select 1 from r where last_attempt_at>now()-interval ''2 minutes'') or exists(select 1 from r where last_error_at is not null))::integer+');
 d:=replace(d,cache_before,'(not exists(select 1 from cache where updated_at>now()-interval ''15 minutes'') or exists(select 1 from c where last_error_at is not null))::integer+');
 execute d;
end$$;
commit;
