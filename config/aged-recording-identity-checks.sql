-- A confirmed empty conversation search can use a longer interval for an
-- unchanged, priced recording on a call that ended more than a day ago.
set local lock_timeout='4s';
set local statement_timeout='20s';
do $patch$
declare
 target regprocedure := 'public.icash_finish_call_recording_work(uuid,uuid,text,text,uuid,text,jsonb)'::regprocedure;
 definition text := pg_get_functiondef(target);
 needle text;
begin
 if md5(definition)<>'9f2802792f9fa95922f03f7abd7c85c1' or not exists (
  select 1 from pg_proc where oid=target and prosecdef and pg_get_userbyid(proowner)='postgres'
   and proconfig=array['search_path=""'] and proacl::text='{postgres=X/postgres,service_role=X/postgres}'
 ) then raise exception 'Unexpected recording receipt function or access'; end if;
 needle:='begin'||chr(10)||' if p_kind is null';
 definition:=replace(definition,needle,$new$ identity_empty boolean := p_kind='reconcile' and p_outcome='available_identity_empty';
begin
 if identity_empty then p_outcome:='available'; end if;
 if p_kind is null$new$);
 needle:='when work.reconcile_attempts<=3 then 60';
 definition:=replace(definition,needle,$new$when identity_empty and work.reconcile_attempts>=24 and r.state='available'
        and r.call_ended_at<=t-interval '1 day' and r.recording_sid is not null
        and r.provider_recording_price_micros is not null and not r.price_is_estimate
        and row(r.recording_sid,r.provider_started_at,r.ended_at,r.duration_seconds,r.provider_recording_price_micros,r.price_is_estimate)
         is not distinct from row(work.recording_sid,work.provider_started_at,work.ended_at,work.duration_seconds,work.provider_recording_price_micros,work.price_is_estimate)
        then case when r.call_ended_at<=t-interval '7 days' then 21600 else 3600 end
       when work.reconcile_attempts<=3 then 60$new$);
 execute definition;
end $patch$;
