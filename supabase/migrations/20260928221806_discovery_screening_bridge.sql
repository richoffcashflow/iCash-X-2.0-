create table public.icash_discovery_configs (
 account_id uuid primary key references public.icash_accounts(id),
 enabled boolean not null default false,
 zip text not null check(zip ~ '^[0-9]{5}$'),
 rate_id uuid not null references public.icash_operation_rates(id),
 property_credit_micros bigint not null check(property_credit_micros>0),
 data_rights_until timestamptz not null,
 assignment_fee_cents bigint not null default 1000000 check(assignment_fee_cents>=0),
 seller_cost_reserve_cents bigint not null check(seller_cost_reserve_cents>=0),
 per_page integer not null default 5 check(per_page between 1 and 10),
 next_page integer not null default 1 check(next_page>0),
 revision uuid not null default gen_random_uuid(),
 exhausted boolean not null default false
);
create table public.icash_discovery_results (
 operation_key text primary key references public.icash_operation_spend(operation_key),
 account_id uuid not null references public.icash_accounts(id),
 result jsonb not null,created_at timestamptz not null default now()
);
create index icash_discovery_results_account on public.icash_discovery_results(account_id,created_at desc);
create table public.icash_dealmachine_request_budget (
 id integer primary key check(id=1), minute_start timestamptz not null default now(),minute_used integer not null default 0,
 day_start timestamptz not null default now(),day_used integer not null default 0,
 minute_limit integer not null default 50 check(minute_limit between 1 and 60),day_limit integer not null default 4500 check(day_limit between 1 and 5000)
);
insert into public.icash_dealmachine_request_budget(id) values(1);
alter table public.icash_discovery_configs enable row level security;
alter table public.icash_discovery_results enable row level security;
alter table public.icash_dealmachine_request_budget enable row level security;
revoke all on public.icash_discovery_configs,public.icash_discovery_results,public.icash_dealmachine_request_budget from public,anon,authenticated;
grant all on public.icash_discovery_configs,public.icash_discovery_results,public.icash_dealmachine_request_budget to service_role;
create function public.icash_take_dealmachine_request() returns boolean
language plpgsql security invoker set search_path='' as $$
declare b public.icash_dealmachine_request_budget;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if not found then return false; end if;
 if b.minute_start<=now()-interval '1 minute' then b.minute_start:=now();b.minute_used:=0;end if;
 if b.day_start<=now()-interval '24 hours' then b.day_start:=now();b.day_used:=0;end if;
 if b.minute_used>=b.minute_limit or b.day_used>=b.day_limit then return false;end if;
 update public.icash_dealmachine_request_budget set minute_start=b.minute_start,minute_used=b.minute_used+1,day_start=b.day_start,day_used=b.day_used+1 where id=1;
 return true;
end $$;
create function public.icash_save_discovery(p_account uuid,p_operation text,p_revision uuid,p_page integer,p_result jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare c public.icash_discovery_configs; o public.icash_operation_spend; saved jsonb; row jsonb; n integer:=0; stamp timestamptz; used bigint;
begin
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.account_id<>p_account or o.state<>'dispatched' then raise exception 'Dispatched acquisition required'; end if;
 select result into saved from public.icash_discovery_results where operation_key=p_operation;
 if found then if saved<>p_result then raise exception 'Discovery result conflict';end if;return jsonb_array_length(saved->'rows');end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or c.revision<>p_revision or c.next_page<>p_page or c.rate_id<>o.rate_id then raise exception 'Discovery configuration changed';end if;
 if jsonb_typeof(p_result->'rows') is distinct from 'array' or jsonb_array_length(p_result->'rows')>c.per_page or octet_length(p_result::text)>524288 then raise exception 'Invalid discovery result';end if;
 used:=(p_result->>'creditsUsed')::bigint;stamp:=(p_result->>'fetchedAt')::timestamptz;
 if used is null or used<0 or stamp is null or stamp>now()+interval '1 minute' or stamp<now()-interval '1 day' or (p_result->>'peopleCredits')::bigint is distinct from 0 then raise exception 'Invalid discovery receipt';end if;
 perform public.icash_record_cost_observation('dealmachine',p_operation,'dealmachine:search:'||p_operation,used,'provider_credits');
 for row in select value from jsonb_array_elements(p_result->'rows') loop
  perform public.icash_enqueue_screening(p_account,p_operation||':'||(row->>'dm_property_id'),jsonb_build_object('propertyId',row->>'dm_property_id','propertyType','house','fetchedAt',stamp,'assignmentFeeCents',c.assignment_fee_cents,'sellerCostReserveCents',c.seller_cost_reserve_cents,'raw',jsonb_build_object('data',row)),stamp);
  n:=n+1;
 end loop;
 insert into public.icash_discovery_results(operation_key,account_id,result) values(p_operation,p_account,p_result);
 update public.icash_discovery_configs set next_page=next_page+1,exhausted=not coalesce((p_result->>'hasNextPage')::boolean,false),enabled=case when used>(p_result->>'estimatedCredits')::bigint then false else enabled end where account_id=p_account;
 return n;
end $$;
revoke all on function public.icash_take_dealmachine_request(),public.icash_save_discovery(uuid,text,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.icash_take_dealmachine_request(),public.icash_save_discovery(uuid,text,uuid,integer,jsonb) to service_role;
