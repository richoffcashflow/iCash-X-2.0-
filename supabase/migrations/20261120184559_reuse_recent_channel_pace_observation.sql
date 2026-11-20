-- Keep the five-minute scheduling observation off the per-candidate hot path.
-- Billing, the three-day cap and the owner's live report still use fresh data.
create table icash_work_private.channel_pace_observation (
 id boolean primary key check(id), seconds integer not null check(seconds in (30,45,50)), measured_at timestamptz not null);
revoke all on icash_work_private.channel_pace_observation from public,anon,authenticated;
insert into icash_work_private.channel_pace_observation values(true,(icash_work_private.platform_usage_pace(false)->>'prioritySeconds')::int,clock_timestamp());
create function icash_work_private.channel_priority_seconds()
returns integer language plpgsql security definer set search_path='' as $fn$
declare prior icash_work_private.channel_pace_observation;fresh integer;
begin
 select * into strict prior from icash_work_private.channel_pace_observation where id;
 if prior.measured_at>=statement_timestamp()-interval '5 minutes' or not pg_try_advisory_xact_lock(594039251) then return prior.seconds;end if;
 fresh:=(icash_work_private.platform_usage_pace(false)->>'prioritySeconds')::int;
 update icash_work_private.channel_pace_observation set seconds=fresh,measured_at=clock_timestamp() where id;
 return fresh;
end $fn$;
revoke all on function icash_work_private.channel_priority_seconds() from public,anon,authenticated;
grant execute on function icash_work_private.channel_priority_seconds() to service_role;
do $patch$
declare src text:=pg_get_functiondef('public.icash_issue_ready_seller_text()'::regprocedure);
begin
 if md5(src)<>'ab1f09b8690b873c18cf7c12e9886a0a' then raise exception 'Unexpected icash_issue_ready_seller_text predecessor';end if;
 execute replace(src,$old$(select (icash_work_private.platform_usage_pace(false)->>'prioritySeconds')::int)$old$,$new$(select icash_work_private.channel_priority_seconds())$new$);
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_issue_ready_voice_ticket()'::regprocedure);
begin
 if md5(src)<>'eb88bac55135c46798282af5322cb480' then raise exception 'Unexpected icash_issue_ready_voice_ticket predecessor';end if;
 execute replace(src,$old$(select (icash_work_private.platform_usage_pace(false)->>'prioritySeconds')::int)$old$,$new$(select icash_work_private.channel_priority_seconds())$new$);
end $patch$;
