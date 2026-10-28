-- Provider responses may reduce admission; they never raise the application's
-- 50/minute or 4,900/day ceilings or reset its recorded counters.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table icash_research_private.quota_feedback(
 id integer primary key check(id=1),request_id uuid references icash_research_private.requests(id) on delete set null,
 request_started_at timestamptz,observed_at timestamptz,headers jsonb not null default '{}',
 blocked_until timestamptz
);
insert into icash_research_private.quota_feedback(id) values(1);
alter table icash_research_private.quota_feedback enable row level security;
revoke all on icash_research_private.quota_feedback from public,anon,authenticated,service_role;
create function public.icash_dealmachine_provider_available() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select blocked_until is null or blocked_until<=now() from icash_research_private.quota_feedback where id=1),false);
$$;
revoke all on function public.icash_dealmachine_provider_available() from public,anon,authenticated;
grant execute on function public.icash_dealmachine_provider_available() to service_role;
do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_finish_dealmachine_request(uuid,jsonb)'::regprocedure);
 old:='''httpStatus'',''returned'',''creditsUsed'',''minuteRemaining'',''dayRemaining'',''retryAfter''';
 if strpos(d,old)=0 then raise exception 'Request observation fields changed';end if;
 d:=replace(d,old,old||',''minuteLimit'',''minuteReset'',''dayLimit''');
 old:='return found;';
 if strpos(d,old)=0 then raise exception 'Request observation persistence changed';end if;
 execute replace(d,old,$replacement$
 if not found then return false;end if;
 -- The response belongs to a durable admitted request. Retain its original
 -- observation even if another response arrived sooner; latest metadata uses
 -- request start order, and an older 429 can only extend an existing hold.
 update icash_research_private.quota_feedback f set
  request_id=case when f.request_started_at is null or r.created_at>=f.request_started_at then r.id else f.request_id end,
  request_started_at=greatest(f.request_started_at,r.created_at),observed_at=now(),
  headers=case when f.request_started_at is null or r.created_at>=f.request_started_at then clean else f.headers end,
  blocked_until=greatest(f.blocked_until,
   case when clean->>'httpStatus'='429' then now()+make_interval(secs=>least(86400,greatest(1,coalesce((clean->>'retryAfter')::bigint,60)))::integer)
    when clean->>'minuteRemaining'='0' and (clean->>'minuteReset')::bigint between extract(epoch from now()) and extract(epoch from now()+interval '2 minutes') then to_timestamp((clean->>'minuteReset')::bigint)
   end)
 from icash_research_private.requests r where f.id=1 and r.id=p_request and r.admitted;
 return true;
 $replacement$);
 d:=pg_get_functiondef('public.icash_dealmachine_capacity_available(integer)'::regprocedure);
 old:='select coalesce(';if strpos(d,old)=0 then raise exception 'Capacity reader changed';end if;
 execute replace(d,old,'select public.icash_dealmachine_provider_available() and coalesce(');
 d:=pg_get_functiondef('public.icash_take_dealmachine_request()'::regprocedure);
 old:='if not found then return false; end if;';if strpos(d,old)=0 then raise exception 'Request limiter changed';end if;
 execute replace(d,old,old||E'\n if not public.icash_dealmachine_provider_available() then return false;end if;');
end $patch$;
commit;
