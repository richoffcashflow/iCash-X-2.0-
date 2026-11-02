-- Adopt the observed organization entitlement with headroom. This changes only
-- request ceilings, never a counter, window, provider plan or customer balance.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $review$
declare b public.icash_dealmachine_request_budget;f icash_research_private.quota_feedback;q icash_research_private.requests;
begin
 select * into strict b from public.icash_dealmachine_request_budget where id=1 for update;
 if b.minute_limit<>50 or b.day_limit<>4900 then raise exception 'Request limits changed since review';end if;
 select * into strict f from icash_research_private.quota_feedback where id=1;
 select * into q from icash_research_private.requests where id=f.request_id;
 if q.id is null or q.admitted is distinct from true or q.finished_at is null or q.finished_at not between now()-interval '1 hour' and now()
  or q.created_at is null or q.created_at<now()-interval '1 hour' or f.request_started_at is distinct from q.created_at
  or q.result->>'httpStatus' is distinct from '200' or f.headers->>'httpStatus' is distinct from '200'
  or q.result->>'minuteLimit' is distinct from '70' or f.headers->>'minuteLimit' is distinct from '70'
  or q.result->>'dayLimit' is distinct from '10000' or f.headers->>'dayLimit' is distinct from '10000'
  or (f.blocked_until is not null and f.blocked_until>now())
  or (select count(*) from icash_research_private.requests where admitted and created_at>now()-interval '1 hour' and finished_at<=now()
   and result->>'httpStatus'='200' and result->>'minuteLimit'='70' and result->>'dayLimit'='10000')<2 then raise exception 'Fresh verified provider entitlement required';end if;
 if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.icash_dealmachine_request_budget'::regclass and conname='icash_dealmachine_request_budget_day_limit_check')
  is distinct from 'CHECK (((day_limit >= 1) AND (day_limit <= 5000)))' then raise exception 'Daily request constraint changed';end if;
 insert into public.icash_integration_checks(provider,checked_at,result) values('dealmachine_request_capacity_20261102',now(),
  jsonb_build_object('sourceRequest',q.id,'sourceCreatedAt',q.created_at,'sourceResult',q.result,'before',to_jsonb(b),'minuteLimit',60,'dayLimit',9800,'providerMinuteLimit',70,'providerDayLimit',10000,'counterReset',false));
end $review$;
alter table public.icash_dealmachine_request_budget drop constraint icash_dealmachine_request_budget_day_limit_check;
alter table public.icash_dealmachine_request_budget add constraint icash_dealmachine_request_budget_day_limit_check check(day_limit between 1 and 10000);
update public.icash_dealmachine_request_budget set minute_limit=60,day_limit=9800 where id=1;
commit;
