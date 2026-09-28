begin;
do $$
declare o uuid; n integer;
begin
insert into public.icash_test_orders(guest_hash,pack_code,price_cents,credit_cents) values('rollback-fixture','start',2000,2000) returning id into o;
perform public.icash_settle_test_order(o,'cs_test_fixture','pi_fixture',2000);
perform public.icash_settle_test_order(o,'cs_test_fixture','pi_fixture',2000);
select count(*) into n from public.icash_test_orders where id=o and state='paid';
if n<>1 then raise exception 'Duplicate settlement'; end if;
begin
 perform public.icash_settle_test_order(o,'cs_test_fixture','pi_fixture',2001);
 raise exception 'Bad amount accepted';
exception when others then if sqlerrm<>'Amount mismatch' then raise; end if; end;
if has_table_privilege('anon','public.icash_test_orders','SELECT') or has_table_privilege('authenticated','public.icash_test_orders','SELECT') then raise exception 'Test data exposed'; end if;
end; $$;
rollback;
select 'PASS: test settlement idempotent, mismatched amount rejected, guest records private; no live credits created.' as result;