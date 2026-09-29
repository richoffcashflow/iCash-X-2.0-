begin;
do $$
declare a uuid;j uuid;s uuid;c uuid:=gen_random_uuid();claimed jsonb;n integer;
begin
 select id into a from public.icash_accounts limit 1;
 insert into public.icash_market_research_scopes(account_id,city,state,enabled) values(a,'Research fixture','TX',true) returning id into s;
 insert into public.icash_market_research_jobs(scope_id,account_id,cycle,kind,city,state_code,state) values(s,a,c,'locations','Research fixture','TX','issued') returning id into j;
 if public.icash_claim_market_research(gen_random_uuid(),j) is not null then raise exception 'Tenant leak';end if;
 claimed:=public.icash_claim_market_research(a,j);
 if claimed->>'kind'<>'locations' then raise exception 'Claim failed';end if;
 if public.icash_claim_market_research(a,j) is not null then raise exception 'Duplicate claim';end if;
 begin
 perform public.icash_save_market_research(a,j,'{"locations":[{"code":"12345","state":"CA"}]}');
 raise exception 'Invalid scope accepted';
 exception when others then if sqlerrm='Invalid scope accepted' then raise;end if;end;
 perform public.icash_save_market_research(a,j,'{"locations":[{"code":"75217","state":"TX"},{"code":"75217","state":"TX"}],"nextPage":2}');
 perform public.icash_save_market_research(a,j,'{"locations":[{"code":"75218","state":"TX"}]}');
 select count(*) into n from public.icash_market_research_jobs where scope_id=s;
 if n<>3 then raise exception 'Deduplication failed';end if;
 select id into j from public.icash_market_research_jobs where scope_id=s and kind='counts';
 update public.icash_market_research_jobs set state='issued' where id=j;
 perform public.icash_claim_market_research(a,j);
 perform public.icash_save_market_research(a,j,'{"total":1000,"highEquity":300,"potentialBuyers":50}');
 if not exists(select 1 from public.icash_market_research_results where account_id=a and zip='75217' and high_equity_properties=300 and inventory_score>0 and status='research_candidate') then raise exception 'Counts missing';end if;
 update public.icash_market_research_usage set requests_reserved=50 where day=(now() at time zone 'UTC')::date;
 select id into j from public.icash_market_research_jobs where scope_id=s and page=2;
 update public.icash_market_research_jobs set state='issued' where id=j;
 if public.icash_claim_market_research(a,j) is not null then raise exception 'Request cap exceeded';end if;
 if has_function_privilege('anon','public.icash_claim_market_research(uuid,uuid)','execute') then raise exception 'Public claim access';end if;
end $$;
-- Exercise scheduler SQL as well as claim/save RPCs; all tickets roll back.
select public.icash_next_automation() is not null as scheduler_returned;
rollback;
