-- Additive worker protocol: only a confirmed recent issuance gets a short wait.
-- Old workers retain their original RPC. Install and record history atomically
-- before deploying the worker that knows this separate tokenless response.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $patch$
declare item record;before_state jsonb;after_state jsonb;
begin
 for item in select * from (values
  ('public.icash_next_automation_lane(text)','3463e54ab56e8a7732a3af2febf9dc88',true),
  ('public.icash_issue_ready_voice_ticket()','be5503735965b3de7e627d9924162e56',false),
  ('public.icash_queue_voice_jobs()','63b849e981c56294a1fe7e0fa69b9404',false)
 ) expected(signature,definition_hash,security_definer) loop
  if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
   where p.oid=item.signature::regprocedure and md5(pg_get_functiondef(p.oid))=item.definition_hash
    and r.rolname='postgres' and p.proacl='{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
    and p.prosecdef=item.security_definer and p.provolatile='v' and p.proparallel='u'
    and not p.proleakproof and not p.proisstrict and p.prokind='f' and p.proconfig=array['search_path=""'])
  then raise exception 'Voice cooldown prerequisite changed: %',item.signature;end if;
 end loop;
 select jsonb_agg(to_jsonb(p) order by p.oid) into before_state from pg_proc p
 where p.oid in ('public.icash_next_automation_lane(text)'::regprocedure,
  'public.icash_issue_ready_voice_ticket()'::regprocedure,'public.icash_queue_voice_jobs()'::regprocedure);
 if to_regprocedure('public.icash_poll_voice_ticket()') is not null then raise exception 'Voice cooldown RPC already exists';end if;
 execute $definition$
create function public.icash_poll_voice_ticket() returns jsonb
language plpgsql security definer set search_path='' as $function$
declare last_voice timestamptz;at_time timestamptz:=now();
begin
 if not pg_try_advisory_xact_lock(726341927) then return null;end if;
 if not exists(select 1 from icash_work_private.dispatch_policy where id=1 and enabled) then return null;end if;
 select last_dispatch_at into last_voice from public.icash_voice_scheduler where id=1;
 -- Missing or future clock evidence cannot create a repeated fast-poll loop.
 if not found or last_voice>at_time then return null;end if;
 if last_voice>=at_time-interval '1 second' then
  return jsonb_build_object('status','voice_cooldown','retryAfterMs',
   greatest(100,least(1100,ceil(1000*extract(epoch from last_voice+interval '1 second'-at_time))::integer+25)));
 end if;
 -- Retain the original queue, fair selection, capacity and one-use issuer.
 -- A true empty/held result remains null. No other cause gets a retry hint.
 return public.icash_next_automation_lane('voice');
end $function$;
$definition$;
 revoke all on function public.icash_poll_voice_ticket() from public,anon,authenticated;
 grant execute on function public.icash_poll_voice_ticket() to service_role;
 select jsonb_agg(to_jsonb(p) order by p.oid) into after_state from pg_proc p
 where p.oid in ('public.icash_next_automation_lane(text)'::regprocedure,
  'public.icash_issue_ready_voice_ticket()'::regprocedure,'public.icash_queue_voice_jobs()'::regprocedure);
 if before_state is distinct from after_state then raise exception 'Voice cooldown changed an original primitive';end if;
 if not exists(select 1 from pg_proc p join pg_roles r on r.oid=p.proowner
  where p.oid='public.icash_poll_voice_ticket()'::regprocedure and r.rolname='postgres'
   and p.proacl='{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
   and p.prosecdef and p.provolatile='v' and p.proparallel='u' and not p.proisstrict and not p.proleakproof
   and p.proconfig=array['search_path=""'] and p.pronargs=0 and p.prorettype='jsonb'::regtype)
 then raise exception 'Voice cooldown RPC metadata changed';end if;
end $patch$;
