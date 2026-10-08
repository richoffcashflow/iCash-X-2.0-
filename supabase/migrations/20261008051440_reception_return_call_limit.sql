-- Normal callbacks must not inherit the original two-calls-per-hour test limit.
-- Keep a short burst limit, exact provider binding, concurrency and all funding checks.
begin;
alter table icash_recorded_reception_private.configs
 alter column caller_window_seconds set default 60,
 alter column caller_max_calls set default 5;

do $return_calls$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;
begin
 select * into c from icash_recorded_reception_private.configs
 where account_id='48dfb798-8c1a-404f-88c0-c396cc067062' and called_number='+17816093521' and enabled
 for update;
 if not found then return;end if;
 if row(c.caller_max_calls,c.caller_window_seconds)=row(5,60) then return;end if;
 if c.call_profile<>'normal' or c.entry_policy<>'direct_recorded_v1'
  or row(c.caller_max_calls,c.caller_window_seconds) is distinct from row(2,3600) then
  raise exception 'Unexpected active return-call configuration';
 end if;
 -- Use the same lock order as call admission and the immutable config guard.
 perform 1 from icash_reception_private.config where id=1 for update;
 if exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then
  raise exception 'Finish the active call before changing the return-call limit';
 end if;
 n:=c;n.id:=gen_random_uuid();
 n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.caller_max_calls:=5;n.caller_window_seconds:=60;
 n.created_at:=icash_recorded_reception_private.clock_now();n.approved_at:=n.created_at;
 n.approval_reference:='Owner requested working inbound callbacks October 8, 2026, 12:10 AM America/Chicago. Replace inherited two-per-hour limit with five admissions per minute. Financial limits, provider script and caller context remain bound to source configuration '||c.id::text||'.';
 update icash_recorded_reception_private.configs set enabled=false where id=c.id;
 insert into icash_recorded_reception_private.configs select n.*;
end $return_calls$;
commit;
