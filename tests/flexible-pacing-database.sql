begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); o uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',true,100);
 insert into public.icash_funding_orders(id,mode,guest_hash,account_id,pack_code,price_cents,credit_cents,run_days,flexible_pacing) values(o,'live',repeat('a',64),a,'start',2000,2000,3,true);
 update public.icash_funding_orders set state='paid',credited_at=now() where id=o;
 perform public.icash_apply_funding_pacing(a);
 if (select daily_limit_cents from public.icash_accounts where id=a)<>666 then raise exception 'Missing consent changed pacing';end if;
 insert into public.icash_funding_consents(order_id,version,terms_text,price_cents,credit_cents,guest_hash,user_agent_hash) values(o,'2026-09-28.2','Fixture consent',2000,2000,repeat('a',64),repeat('b',64));
 update public.icash_funding_orders set pacing_applied_at=null where id=o;
 perform public.icash_apply_funding_pacing(a);
 if (select daily_limit_cents from public.icash_accounts where id=a)<>2000 then raise exception 'Flexible pace not applied';end if;
 if not (select bot_paused from public.icash_accounts where id=a) then raise exception 'Pause altered';end if;
end $$;
rollback;
