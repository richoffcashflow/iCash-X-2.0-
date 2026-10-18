begin;
-- Finishing a video is not a purchase or checkout transition. A real departure
-- afterward still receives the pair under the same recorded channel permission.
do $$ declare body text;begin
 select pg_get_functiondef('public.icash_webinar_departure_pending(uuid)'::regprocedure) into strict body;
 if position('and s.completed_at is null ' in body)=0 then raise exception 'Departure eligibility prerequisite changed';end if;
 execute replace(body,'and s.completed_at is null ','');
 select pg_get_functiondef('public.icash_webinar_recovery_signal(uuid,uuid,uuid,bigint,text)'::regprocedure) into strict body;
 if position(' or s.completed_at is not null' in body)=0 then raise exception 'Departure signal prerequisite changed';end if;
 execute replace(body,' or s.completed_at is not null','');
end $$;
notify pgrst,'reload schema';
commit;
