-- Shared admission for normal production calls. Existing call identities,
-- recording approvals, credit settlement and unknown-outcome holds stay intact.
begin;
set local lock_timeout='5s';
create table public.icash_voice_capacity_policy(
 id integer primary key check(id=1), workspace_limit integer not null check(workspace_limit between 1 and 40),
 verified_at timestamptz not null, source text not null check(length(source) between 1 and 200)
);
create table public.icash_voice_agent_capacity(
 agent_id text primary key, concurrent_limit integer not null check(concurrent_limit between 1 and 40),
 verified_at timestamptz not null
);
alter table public.icash_voice_capacity_policy enable row level security;
alter table public.icash_voice_agent_capacity enable row level security;
revoke all on public.icash_voice_capacity_policy,public.icash_voice_agent_capacity from public,anon,authenticated;
grant select,insert,update on public.icash_voice_capacity_policy,public.icash_voice_agent_capacity to service_role;
create index icash_recording_active_capacity on public.icash_call_recordings(account_id,agent_id,operation_key) where call_ended_at is null;
create index icash_reception_active_capacity on icash_recorded_reception_private.sessions(account_id,agent_id,operation_key) where call_ended_at is null;

create function public.icash_voice_capacity_targets() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('agentId',agent_id,'branchId',branch_id)),'[]') from (
  select agent_id,null::text branch_id from public.icash_voice_configs where enabled
  union select agent_id,branch_id from icash_recorded_reception_private.configs where enabled and call_profile='normal'
 ) targets
$$;
create function public.icash_save_voice_capacity(p_limit integer,p_agents jsonb,p_source text) returns void
language plpgsql security invoker set search_path='' as $$
declare a jsonb;
begin
 if p_limit not between 1 and 4 or jsonb_typeof(p_agents) is distinct from 'array' or jsonb_array_length(p_agents) not between 1 and 12 then raise exception 'Verified capacity required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 for a in select value from jsonb_array_elements(p_agents) loop
  if coalesce(a->>'agentId','')!~'^agent_[A-Za-z0-9]+$' or (a->>'limit')::integer not between 1 and p_limit then raise exception 'Invalid capacity';end if;
  insert into public.icash_voice_agent_capacity values(a->>'agentId',(a->>'limit')::integer,now())
   on conflict(agent_id) do update set concurrent_limit=excluded.concurrent_limit,verified_at=excluded.verified_at;
 end loop;
 insert into public.icash_voice_capacity_policy values(1,p_limit,now(),p_source)
  on conflict(id) do update set workspace_limit=excluded.workspace_limit,verified_at=excluded.verified_at,source=excluded.source;
end $$;
revoke all on function public.icash_voice_capacity_targets(),public.icash_save_voice_capacity(integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_voice_capacity_targets(),public.icash_save_voice_capacity(integer,jsonb,text) to service_role;

-- One row per operation even when both a dispatch job and a recording exist.
-- Receipt reconciliation, never a timeout, releases uncertain calls.
create function public.icash_active_voice_slots() returns table(operation_key text,account_id uuid,agent_id text,contact_key text)
language sql stable security definer set search_path='' as $$
 select 'voice:'||j.id,j.account_id,c.agent_id,t.contact_key
 from public.icash_voice_jobs j join public.icash_voice_configs c on c.account_id=j.account_id
 left join public.icash_voice_contact_targets t on t.id=coalesce(j.permission_id,j.operational_contact_id) and t.account_id=j.account_id
 where j.state in ('issued','dispatching') or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))
 union
 select l.operation_key,l.account_id,l.agent_id,l.contact_key from public.icash_live_conversations l where l.state in ('waiting','review')
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from public.icash_call_recordings r where r.call_ended_at is null
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from icash_recorded_reception_private.sessions r where r.call_ended_at is null
$$;
create function public.icash_voice_capacity_available(p_account uuid,p_agent text,p_operation text,p_contact text,p_incoming boolean default false) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare total_limit integer:=1;agent_limit integer:=1;account_limit integer:=1;busy integer;agent_busy integer;account_busy integer;contact_busy boolean;
begin
 select least(4,workspace_limit) into total_limit from public.icash_voice_capacity_policy where id=1 and verified_at>now()-interval '24 hours';
 select concurrent_limit into agent_limit from public.icash_voice_agent_capacity where agent_id=p_agent and verified_at>now()-interval '24 hours';
 total_limit:=coalesce(total_limit,1);agent_limit:=coalesce(agent_limit,1);
 select count(distinct operation_key),count(distinct operation_key) filter(where agent_id=p_agent),
 count(distinct operation_key) filter(where account_id=p_account),coalesce(bool_or(p_contact is not null and contact_key=p_contact),false)
 into busy,agent_busy,account_busy,contact_busy from public.icash_active_voice_slots() where operation_key is distinct from p_operation;
 if contact_busy or busy>=total_limit or agent_busy>=agent_limit then return false;end if;
 if p_incoming then return true;end if;
 -- Leave one workspace slot for incoming callbacks; never enable provider burst.
 if (total_limit>1 and busy>=total_limit-1) or (agent_limit>1 and agent_busy>=agent_limit-1) then return false;end if;
 select least(3,greatest(1,floor(greatest(0,least(w.balance_cents,
 coalesce((public.icash_daily_allowance(p_account)->>'remainingCents')::bigint,0)))::numeric/1000)))::integer
 into account_limit from public.icash_wallets w where w.account_id=p_account and w.balance_cents>0;
 return account_busy<coalesce(account_limit,0);
end $$;
revoke all on function public.icash_active_voice_slots(),public.icash_voice_capacity_available(uuid,text,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_active_voice_slots(),public.icash_voice_capacity_available(uuid,text,text,text,boolean) to service_role;

-- Exact guarded edits keep the current, layered recipient and financial checks.
do $patch$
declare d text;needle text;signature text;
begin
 d:=pg_get_functiondef('public.icash_voice_queue_slot_open(uuid,uuid)'::regprocedure);
 if position('busy.account_id=j.account_id or ' in d)=0 or position('live.account_id=j.account_id or ' in d)=0 then raise exception 'Queue capacity prerequisite changed';end if;
 d:=replace(replace(d,'busy.account_id=j.account_id or ',''),'live.account_id=j.account_id or ','');
 needle:='j.state=''ready''';
 d:=replace(d,needle,needle||E'\n and public.icash_voice_capacity_available(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),''voice:''||j.id,target.contact_key,false)');
 execute d;
 foreach signature in array array['public.icash_claim_voice_job(uuid)','public.icash_claim_cancellation_voice(uuid,uuid,jsonb)','public.icash_meta_claim_voice(uuid,uuid)','public.icash_meta_claim_or_defer_voice(uuid,uuid)'] loop
  d:=pg_get_functiondef(signature::regprocedure);
  if position('icash_operating_budget' in d)=0 or position('icash_claim_operation(''voice:''||j.id)' in d)=0 then raise exception 'Claim capacity prerequisite changed: %',signature;end if;
  -- Contact exclusion remains global. Only the old per-account singleton goes.
  d:=replace(replace(replace(d,'v.account_id=j.account_id or ',''),'v.account_id=p_account or ',''),'account_id=p_account or contact_key=p.contact_key','contact_key=p.contact_key');
  d:=replace(d,'account_id=j.account_id or contact_key=p.contact_key','contact_key=p.contact_key');
  needle:='if not public.icash_claim_operation(''voice:''||j.id) then';
  if signature like '%claim_or_defer%' then
   -- Keep its existing bounded, receipt-free deferral when shared capacity is full.
   needle:='if exists(select 1 from public.icash_voice_jobs';
   if position(needle in d)=0 then raise exception 'Meta capacity deferral boundary changed';end if;
   d:=replace(d,needle,'if not public.icash_voice_capacity_available(p_account,(select agent_id from public.icash_voice_configs where account_id=p_account),''voice:''||j.id,p.contact_key,false) or exists(select 1 from public.icash_voice_jobs');
  else
   d:=replace(d,needle,'if not public.icash_voice_capacity_available(j.account_id,(select agent_id from public.icash_voice_configs where account_id=j.account_id),''voice:''||j.id,p.contact_key,false) then return false;end if;'||E'\n '||needle);
  end if;
  execute d;
 end loop;
 d:=pg_get_functiondef('public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure);
 needle:='if exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then return jsonb_build_object(''allowed'',false,''reason'',''concurrency_limit'');end if;';
 if position(needle in d)=0 then raise exception 'Incoming capacity prerequisite changed';end if;
 -- Budget row is the common lock used by every final outbound claim.
 d:=replace(d,needle,'');
 needle:='select * into b from public.icash_operating_budget where id=1 for update;';
 d:=replace(d,needle,needle||E'\n if (c.call_profile=''normal'' and not public.icash_voice_capacity_available(c.account_id,c.agent_id,''recorded-reception:''||p_call_sid,encode(sha256(convert_to(p_from_phone,''UTF8'')),''hex''),true)) or (c.call_profile<>''normal'' and exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null)) then return jsonb_build_object(''allowed'',false,''reason'',''concurrency_limit'');end if;');
 execute d;
end $patch$;
commit;
