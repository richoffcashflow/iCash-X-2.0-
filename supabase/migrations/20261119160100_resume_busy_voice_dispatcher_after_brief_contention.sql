set local lock_timeout='2s';
do $guard$ begin if md5(pg_get_functiondef('public.icash_poll_voice_ticket()'::regprocedure))<>'11f1f60257c5a5b8e8a7a7b29274a031' then raise exception 'Voice poll changed';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.icash_poll_voice_ticket()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare last_voice timestamptz;at_time timestamptz:=now();
begin
 if not pg_try_advisory_xact_lock(726341927) then
  -- Another lane owns the dispatcher. A recent successful issue plus due
  -- work distinguishes temporary contention from a truly idle queue.
  if exists(select 1 from icash_work_private.dispatch_policy where id=1 and enabled)
   and exists(select 1 from public.icash_voice_scheduler where id=1
    and last_dispatch_at between at_time-interval '15 seconds' and at_time)
   and exists(select 1 from public.icash_voice_jobs where state='ready' and due_at<=at_time) then
   return jsonb_build_object('status','voice_cooldown','retryAfterMs',1100);
  end if;
  return null;
 end if;
 if not exists(select 1 from icash_work_private.dispatch_policy where id=1 and enabled) then return null;end if;
 select last_dispatch_at into last_voice from public.icash_voice_scheduler where id=1;
 -- Missing or future clock evidence cannot create a repeated fast-poll loop.
 if not found or last_voice>at_time then return null;end if;
 if last_voice>=at_time-interval '1 second' then
  return jsonb_build_object('status','voice_cooldown','retryAfterMs',
   greatest(100,least(1100,ceil(1000*extract(epoch from last_voice+interval '1 second'-at_time))::integer+25)));
 end if;
 -- Retain the original queue, fair selection, capacity and one-use issuer.
 -- A true empty/held result remains null.
 return public.icash_next_automation_lane('voice');
end $function$
;