-- Avoid rescanning every queued recipient when no outgoing provider slot exists.
-- This is a necessary-condition shortcut only. Per-job/account/contact checks and
-- final locked admission remain unchanged; unresolved calls retain their slots.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_outgoing_voice_capacity_open() returns boolean
language sql stable security invoker set search_path='' as $$
 with slots as materialized (
  select operation_key,agent_id from public.icash_active_voice_slots()
 ), policy as (
  select coalesce((select least(10,workspace_limit) from public.icash_voice_capacity_policy
   where id=1 and verified_at>now()-interval '24 hours'),1) as total_limit
 ), busy as (
  select count(distinct operation_key) total,
   count(distinct operation_key) filter(where operation_key not like 'recorded-reception:%') outgoing from slots
 ), agents as (
  select distinct c.agent_id,least(p.total_limit,coalesce(v.concurrent_limit,1)) agent_limit
  from public.icash_voice_configs c cross join policy p
  left join public.icash_voice_agent_capacity v on v.agent_id=c.agent_id and v.verified_at>now()-interval '24 hours'
  where c.enabled
 ), agent_busy as (
  select agent_id,count(distinct operation_key) total,
   count(distinct operation_key) filter(where operation_key not like 'recorded-reception:%') outgoing
  from slots group by agent_id
 )
 -- Final admission excludes the job's own operation. If such a ready job
 -- already occupies a slot, leave that decision to its existing exact gate.
 select exists(select 1 from slots s join public.icash_voice_jobs j on s.operation_key='voice:'||j.id where j.state='ready')
 or exists(
  select 1 from policy p cross join busy b
  where b.total<p.total_limit and b.outgoing<greatest(1,p.total_limit-2)
   and exists(select 1 from agents a left join agent_busy ab on ab.agent_id=a.agent_id
    where coalesce(ab.total,0)<a.agent_limit
     and (coalesce(ab.outgoing,0)<greatest(1,a.agent_limit-2)
      or not exists(select 1 from jsonb_array_elements(public.icash_voice_capacity_targets()) t
       where t->>'agentId'=a.agent_id and t->>'branchId' is not null)))
 );
$$;
revoke all on function public.icash_outgoing_voice_capacity_open() from public,anon,authenticated;
grant execute on function public.icash_outgoing_voice_capacity_open() to service_role;
do $migration$
declare definition text;
 needle text:=$before$ if (last_voice is null or last_voice<now()-interval '3 seconds') and exists(select 1 from public.icash_operating_budget where id=1 and enabled) then$before$;
 replacement text:=$after$ if (last_voice is null or last_voice<now()-interval '3 seconds') and exists(select 1 from public.icash_operating_budget where id=1 and enabled) and public.icash_outgoing_voice_capacity_open() then$after$;
begin
 definition:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle)
  or (length(definition)-length(replace(definition,'select candidate.* into j','')))/length('select candidate.* into j')<>2
  or (length(definition)-length(replace(definition,'public.icash_voice_queue_slot_open(candidate.account_id,candidate.id)','')))/length('public.icash_voice_queue_slot_open(candidate.account_id,candidate.id)')<>2
  or (length(definition)-length(replace(definition,'public.icash_seller_phone_call_current(candidate.account_id,candidate.id)','')))/length('public.icash_seller_phone_call_current(candidate.account_id,candidate.id)')<>2 then
  raise exception 'Outgoing capacity shortcut prerequisite changed';
 end if;
 execute replace(definition,needle,replacement);
end $migration$;
commit;


