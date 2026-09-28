begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); j uuid; d uuid; s uuid;
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,100,0,'USD');
 j:=public.icash_enqueue_screening(a,gen_random_uuid()::text,'{"propertyId":"prop_fixture"}',now());
 update public.icash_screening_jobs set state='complete',result='{}',completed_at=now() where id=j;
 d:=public.icash_prepare_deal(a,j,'{"seller":"Fixture"}');
 if d<>public.icash_prepare_deal(a,j,'{"seller":"Updated"}') then raise exception 'Duplicate deal';end if;
 begin
 perform public.icash_prepare_deal(gen_random_uuid(),j,'{}');raise exception 'FAIL';
 exception when others then if sqlerrm<>'Account property missing' then raise;end if;end;
 s:=public.icash_propose_showing(a,d,'Fixture',now()+interval '1 day',now()+interval '1 day 30 minutes','America/Chicago');
 begin
 perform public.icash_propose_showing(a,d,'Fixture',now()+interval '1 day',now()+interval '1 day 30 minutes','America/Chicago');raise exception 'FAIL';
 exception when others then if sqlerrm<>'Showing time unavailable' then raise;end if;end;
 begin
 update public.icash_showing_requests set state='confirmed' where id=s;raise exception 'FAIL';
 exception when check_violation then null;end;
 update public.icash_deal_files set stage='under_contract' where id=d;
 begin
 perform public.icash_prepare_deal(a,j,'{}');raise exception 'FAIL';
 exception when others then if sqlerrm<>'Executed deal requires amendment' then raise;end if;end;
 perform public.icash_set_work_control(u,a,'pause');
 if not (select bot_paused from public.icash_accounts where id=a) then raise exception 'Pause failed';end if;
 perform public.icash_set_work_control(u,a,'takeover',j);
 if not exists(select 1 from public.icash_property_controls where account_id=a and property_id='prop_fixture' and manual) then raise exception 'Takeover failed';end if;
 begin
 perform public.icash_set_work_control(gen_random_uuid(),a,'resume');raise exception 'FAIL';
 exception when others then if sqlerrm<>'Account ownership required' then raise;end if;end;
 if has_table_privilege('authenticated','public.icash_deal_files','SELECT') or has_function_privilege('anon','public.icash_prepare_deal(uuid,uuid,jsonb)','EXECUTE') then raise exception 'Private deals exposed';end if;
end $$;
rollback;
