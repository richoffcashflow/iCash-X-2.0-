-- Owner requested more parallel calls on 2026-10-23. Fresh provider evidence
-- allows ten total, with up to eight outgoing and two slots for callbacks.
-- No funded allowance, claim lock, contact gate or unresolved hold is reset.
begin;
set local lock_timeout='5s';
create or replace function public.icash_save_voice_capacity(p_limit integer,p_agents jsonb,p_source text) returns void
language plpgsql security invoker set search_path='' as $$
declare a jsonb;
begin
 if p_limit is null or p_limit not between 1 and 10 or jsonb_typeof(p_agents) is distinct from 'array' or jsonb_array_length(p_agents) not between 1 and 12 then raise exception 'Verified capacity required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 for a in select value from jsonb_array_elements(p_agents) loop
  if coalesce(a->>'agentId','')!~'^agent_[A-Za-z0-9]+$' or a->>'limit' is null or (a->>'limit')::integer not between 1 and p_limit then raise exception 'Invalid capacity';end if;
  insert into public.icash_voice_agent_capacity values(a->>'agentId',(a->>'limit')::integer,now())
   on conflict(agent_id) do update set concurrent_limit=excluded.concurrent_limit,verified_at=excluded.verified_at;
 end loop;
 insert into public.icash_voice_capacity_policy values(1,p_limit,now(),p_source)
  on conflict(id) do update set workspace_limit=excluded.workspace_limit,verified_at=excluded.verified_at,source=excluded.source;
end $$;

create or replace function public.icash_voice_capacity_available(p_account uuid,p_agent text,p_operation text,p_contact text,p_incoming boolean default false) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare total_limit integer:=1;agent_limit integer:=1;account_limit integer:=1;
 busy integer;agent_busy integer;account_busy integer;outgoing_busy integer;agent_outgoing_busy integer;contact_busy boolean;
begin
 select least(10,workspace_limit) into total_limit from public.icash_voice_capacity_policy where id=1 and verified_at>now()-interval '24 hours';
 select concurrent_limit into agent_limit from public.icash_voice_agent_capacity where agent_id=p_agent and verified_at>now()-interval '24 hours';
 total_limit:=coalesce(total_limit,1);agent_limit:=least(total_limit,coalesce(agent_limit,1));
 select count(distinct operation_key),count(distinct operation_key) filter(where agent_id=p_agent),
 count(distinct operation_key) filter(where account_id=p_account),coalesce(bool_or(p_contact is not null and contact_key=p_contact),false),
 count(distinct operation_key) filter(where operation_key not like 'recorded-reception:%'),
 count(distinct operation_key) filter(where agent_id=p_agent and operation_key not like 'recorded-reception:%')
 into busy,agent_busy,account_busy,contact_busy,outgoing_busy,agent_outgoing_busy
 from public.icash_active_voice_slots() where operation_key is distinct from p_operation;
 if contact_busy or busy>=total_limit or agent_busy>=agent_limit then return false;end if;
 if p_incoming then return true;end if;
 -- Count outgoing calls separately: occupied incoming slots must not subtract
 -- the callback reserve a second time. A one-slot fallback stays usable.
 if outgoing_busy>=greatest(1,total_limit-2) or (agent_outgoing_busy>=greatest(1,agent_limit-2)
  and exists(select 1 from jsonb_array_elements(public.icash_voice_capacity_targets()) t where t->>'agentId'=p_agent and t->>'branchId' is not null)) then return false;end if;
 select least(3,greatest(1,floor(greatest(0,least(w.balance_cents,
 coalesce((public.icash_daily_allowance(p_account)->>'remainingCents')::bigint,0)))::numeric/1000)))::integer
 into account_limit from public.icash_wallets w where w.account_id=p_account and w.balance_cents>0;
 return account_busy<coalesce(account_limit,0);
end $$;
revoke all on function public.icash_save_voice_capacity(integer,jsonb,text),public.icash_voice_capacity_available(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_save_voice_capacity(integer,jsonb,text),public.icash_voice_capacity_available(uuid,text,text,text,boolean) to service_role;
commit;
