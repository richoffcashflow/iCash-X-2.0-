begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); k text:=gen_random_uuid()::text; j uuid; claim jsonb; old_token uuid; due timestamptz:=now();
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,100,0,'USD');
 update public.icash_screening_control set enabled=true,max_concurrency=1 where id=1;
 j:=public.icash_enqueue_screening(a,k,'{"fixture":true}',due);
 if j<>public.icash_enqueue_screening(a,k,'{"fixture":true}',due) then raise exception 'Duplicate queue insertion'; end if;
 update public.icash_accounts set bot_paused=true where id=a;
 if public.icash_claim_screening() is not null then raise exception 'Paused account claimed'; end if;
 update public.icash_accounts set bot_paused=false where id=a;
 update public.icash_wallets set reserved_cents=100 where account_id=a;
 if public.icash_claim_screening() is not null then raise exception 'Empty available credit claimed'; end if;
 update public.icash_wallets set reserved_cents=0 where account_id=a;
 claim:=public.icash_claim_screening();
 if (claim->>'id')::uuid is distinct from j then raise exception 'Claim missing'; end if;
 old_token:=(claim->>'leaseToken')::uuid;
 if public.icash_claim_screening() is not null then raise exception 'Concurrency cap bypassed'; end if;
 update public.icash_screening_jobs set lease_until=now()-interval '1 second' where id=j;
 claim:=public.icash_claim_screening();
 if public.icash_finish_screening(j,old_token,'{"stale":true}') then raise exception 'Stale worker wrote result'; end if;
 if not public.icash_finish_screening(j,(claim->>'leaseToken')::uuid,'{"actual":true}') then raise exception 'Completion failed'; end if;
 if public.icash_finish_screening(j,(claim->>'leaseToken')::uuid,'{"actual":true}') then raise exception 'Double completion'; end if;
 if has_table_privilege('authenticated','public.icash_screening_jobs','SELECT') or has_function_privilege('anon','public.icash_claim_screening()','EXECUTE') then raise exception 'Private queue exposed'; end if;
end $$;
rollback;
