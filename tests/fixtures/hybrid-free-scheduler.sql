CREATE OR REPLACE FUNCTION public.icash_next_before_seller_openers()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prior jsonb;s public.icash_market_research_scopes;j public.icash_market_research_jobs;t public.icash_automation_tickets;cycle uuid;
begin
 perform pg_advisory_xact_lock(726341927);
 -- Customer work always has priority over free research.
 prior:=public.icash_next_before_market_research();
 if prior->>'token' is not null then return prior;end if;
 if exists(select 1 from public.icash_market_research_usage where day=(now() at time zone 'UTC')::date and requests_reserved>=48)
 or exists(select 1 from public.icash_automation_tickets where kind='market_research' and created_at>now()-interval '1 minute') then return prior;end if;
 for s in select * from public.icash_market_research_scopes where enabled and next_scan_at<=now() order by next_scan_at limit 4 for update skip locked loop
 -- Finish the current scan before beginning another cycle.
 if not exists(select 1 from public.icash_market_research_jobs where scope_id=s.id and state<>'complete' and attempts<3) then
 cycle:=gen_random_uuid();
 insert into public.icash_market_research_jobs(scope_id,account_id,cycle,kind,city,state_code) values(s.id,s.account_id,cycle,'locations',s.city,s.state);
 -- Known candidates ensure useful screening even when the city-name search is sparse.
 insert into public.icash_market_research_jobs(scope_id,account_id,cycle,kind,city,state_code,zip)
 select s.id,s.account_id,cycle,'counts',s.city,s.state,z.zip from public.icash_market_shortlist z where z.city=s.city and z.state=s.state;
 update public.icash_market_research_scopes set next_scan_at=now()+interval '7 days' where id=s.id;
 end if;end loop;
 select q.* into j from public.icash_market_research_jobs q join public.icash_market_research_scopes scope on scope.id=q.scope_id and scope.enabled
 where q.state<>'complete' and q.attempts<3 and q.next_attempt_at<=now()
 order by case when q.kind='locations' then 0 else 1 end,q.next_attempt_at,q.created_at,q.id for update of q skip locked limit 1;
 if not found then return prior;end if;
 update public.icash_market_research_jobs set state='issued',updated_at=now(),next_attempt_at=now()+interval '15 minutes' where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,market_research_job_id) values(j.account_id,'market_research',j.id) returning * into t;
 return jsonb_build_object('token',t.token);
end $function$;
