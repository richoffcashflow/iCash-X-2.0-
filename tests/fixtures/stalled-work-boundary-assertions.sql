begin;
do $$
declare quote bigint;age interval;r text;
begin
 if (select reason from public.icash_account_work_observations()) is distinct from 'pending_work' then raise exception 'Nine pending originals still hidden';end if;
 for quote in select unnest(array[99,100,101,299,300,301]) loop
  update public.icash_wallets set balance_cents=quote+90;
  if (select reason from public.icash_account_work_observations()) is distinct from 'pending_work' then raise exception 'Quote boundary %',quote;end if;
 end loop;
 update public.icash_wallets set balance_cents=250;
 for age in select unnest(array[interval '29 minutes 59 seconds',interval '30 minutes',interval '30 minutes 1 second']) loop
  update public.icash_operation_spend set created_at=now()-age;
  select reason into r from public.icash_account_work_observations();
  if (r is not null) is distinct from (age>=interval '30 minutes') then raise exception 'Age boundary %',age;end if;
 end loop;
 update public.icash_operation_spend set created_at=now()-interval '1 day';
 insert into public.icash_operation_spend(operation_key,account_id,state,actual_micros,settled_at)
  select 'synthetic-zero-settlement',id,'settled',0,now() from public.icash_accounts;
 if (select reason from public.icash_account_work_observations()) is distinct from 'pending_work' then raise exception 'Zero settlement claimed completed work';end if;
 insert into public.icash_discovery_results(operation_key,account_id,result,created_at)
  select 'synthetic-output',id,'{}',now() from public.icash_accounts;
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Independent recent output incorrectly stalled';end if;
 delete from public.icash_discovery_results;
 update public.icash_accounts set bot_paused=true;
 insert into public.icash_control_events(id,account_id,action,created_at) select gen_random_uuid(),id,'pause',now() from public.icash_accounts;
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Customer Pause ignored';end if;
 delete from public.icash_control_events;update public.icash_accounts set bot_paused=false;
 update public.fixture_work_policy set member=false;
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Membership ignored';end if;
 update public.fixture_work_policy set member=true;
 insert into public.icash_support_cancel_requests(account_id,confirmed_at) select id,now() from public.icash_accounts;
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Cancellation ignored';end if;
 delete from public.icash_support_cancel_requests;
 update public.icash_discovery_configs set enabled=false;
 if (select reason from public.icash_account_work_observations()) is distinct from 'configuration_disabled' then raise exception 'Configuration precedence';end if;
 update public.icash_discovery_configs set enabled=true;
 insert into public.icash_funding_orders(account_id,mode,state,credited_at) select id,'live','paid',now() from public.icash_accounts;
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Initial funding grace ignored';end if;
 delete from public.icash_funding_orders;
 insert into public.icash_control_events(id,account_id,action,created_at) select gen_random_uuid(),id,'resume',now() from public.icash_accounts;
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Initial resume grace ignored';end if;
 delete from public.icash_control_events;
 delete from public.icash_operation_spend;
 if exists(select 1 from public.icash_account_work_observations()) then raise exception 'Contact-only balance without work is a funding limit';end if;
end $$;
rollback;
