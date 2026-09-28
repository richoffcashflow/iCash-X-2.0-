
begin;
insert into auth.users(id) values('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','Alex',false,500),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','Jordan',false,500);
insert into public.icash_wallets(account_id) select id from public.icash_accounts;
insert into public.icash_deals(account_id,address) select id,'Fictional SQL verification' from public.icash_accounts;
set local role service_role;
do $$
declare a uuid:='10000000-0000-4000-8000-000000000001'; first_id uuid; second_id uuid; n bigint;
begin
 first_id:=public.icash_post_credit(a,'verify-payment','purchase',2000,'verified:test');
 second_id:=public.icash_post_credit(a,'verify-payment','purchase',2000,'verified:test');
 if first_id<>second_id then raise exception 'FAILED duplicate funding'; end if;
 first_id:=public.icash_reserve_credit(a,'verify-operation',300);
 second_id:=public.icash_reserve_credit(a,'verify-operation',300);
 if first_id<>second_id then raise exception 'FAILED duplicate reserve'; end if;
 begin
  perform public.icash_reserve_credit(a,'over-budget',300);
  raise exception 'FAILED budget';
 exception when others then if sqlerrm<>'Daily budget reached' then raise; end if; end;
 begin
  perform public.icash_finish_credit(a,'verify-operation',301,'test');
  raise exception 'FAILED excess settlement';
 exception when others then if sqlerrm<>'Charge exceeds reservation' then raise; end if; end;
 perform public.icash_finish_credit(a,'verify-operation',200,'test');
 perform public.icash_finish_credit(a,'verify-operation',200,'test');
 select balance_cents into n from public.icash_wallets where account_id=a;
 if n<>1800 then raise exception 'FAILED balance'; end if;
 select reserved_cents into n from public.icash_wallets where account_id=a;
 if n<>0 then raise exception 'FAILED release remainder'; end if;
 perform public.icash_reserve_credit(a,'verify-release',100);
 perform public.icash_finish_credit(a,'verify-release',0,'not dispatched');
 begin
  perform public.icash_post_credit(a,'verify-payment','purchase',2001,'verified:test');
  raise exception 'FAILED idempotency mismatch';
 exception when others then if sqlerrm<>'Idempotency conflict' then raise; end if; end;
 begin
  perform public.icash_post_credit(a,'refund-too-large','refund',-2000,'test');
  raise exception 'FAILED overdraft';
 exception when others then if sqlerrm<>'Insufficient unreserved credits' then raise; end if; end;
end; $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
set local role authenticated;
do $$
declare n bigint;
begin
 select count(*) into n from public.icash_accounts;
 if n<>1 then raise exception 'FAILED account isolation'; end if;
 select count(*) into n from public.icash_deals;
 if n<>1 then raise exception 'FAILED deal isolation'; end if;
 select count(*) into n from public.icash_wallets;
 if n<>1 then raise exception 'FAILED wallet isolation'; end if;
 begin
  perform public.icash_post_credit('10000000-0000-4000-8000-000000000001','attack','grant',1000,'fake');
  raise exception 'FAILED customer credit mutation';
 exception when insufficient_privilege then null; end;
end; $$;
reset role;
do $$
begin
 if has_table_privilege('anon','public.icash_deals','SELECT') then raise exception 'FAILED anonymous access'; end if;
 if has_table_privilege('authenticated','public.icash_wallets','UPDATE') then raise exception 'FAILED wallet grants'; end if;
end; $$;
rollback;
select 'PASS: duplicate payment and settlement, limits, reservations, tenant isolation and denied customer credit mutation. All fixtures rolled back.' as result;
