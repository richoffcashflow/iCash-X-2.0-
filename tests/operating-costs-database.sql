begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); rate uuid; costs jsonb; n bigint; msg text; key text:='cost-test:'||gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,'cost-test-'||u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 select jsonb_object_agg(c,case when c='elevenlabs' then 100000 else 0 end) into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('seller_call',key,100,costs,'fixture:rollback-only',now()-interval '1 minute',now()+interval '1 hour',true) returning id into rate;
 update public.icash_operating_budget set enabled=true,funded_micros=10000000,protected_micros=1000000,reserved_micros=0,spent_micros=0,daily_limit_micros=5000000 where id=1;
 begin
  perform public.icash_reserve_operation(a,key,rate,now()+interval '1 hour',now(),false);
  raise exception 'TEST_EXPECTED_FINANCIAL_HOLD';
 exception when others then if sqlerrm<>'Financial screening required' then raise; end if; end;
 perform public.icash_reserve_operation(a,key,rate,now()+interval '1 hour',now(),true);
 perform public.icash_reserve_operation(a,key,rate,now()+interval '1 hour',now(),true);
 select reserved_cents into n from public.icash_wallets where account_id=a;
 if n<>100 then raise exception 'Duplicate customer reservation'; end if;
 select reserved_micros into n from public.icash_operating_budget where id=1;
 if n<>120000 then raise exception 'Incorrect buffered company reservation'; end if;
 update public.icash_operating_budget set funded_micros=1120000 where id=1;
 begin
  perform public.icash_reserve_operation(a,key||':second',rate,now()+interval '1 hour',now(),true);
  raise exception 'TEST_EXPECTED_COMPANY_HOLD';
 exception when others then if sqlerrm<>'Company budget exhausted' then raise; end if; end;
 select reserved_cents into n from public.icash_wallets where account_id=a;
 if n<>100 then raise exception 'Failed reservation modified wallet'; end if;
 update public.icash_operating_budget set funded_micros=10000000 where id=1;
 update public.icash_accounts set bot_paused=true where id=a;
 if public.icash_claim_operation(key) then raise exception 'Paused dispatch accepted'; end if;
 update public.icash_accounts set bot_paused=false where id=a;
 if not public.icash_claim_operation(key) then raise exception 'First dispatch rejected'; end if;
 if public.icash_claim_operation(key) then raise exception 'Duplicate dispatch accepted'; end if;
 perform public.icash_settle_operation(key,100,100000,'fixture:settlement');
 perform public.icash_settle_operation(key,100,100000,'fixture:settlement');
 select balance_cents into n from public.icash_wallets where account_id=a;
 if n<>9900 then raise exception 'Incorrect customer charge'; end if;
 select spent_micros into n from public.icash_operating_budget where id=1;
 if n<>100000 then raise exception 'Duplicate company settlement'; end if;
 begin
  perform public.icash_settle_operation(key,100,100001,'fixture:settlement');
  raise exception 'TEST_EXPECTED_SETTLEMENT_CONFLICT';
 exception when others then if sqlerrm<>'Settlement conflict' then raise; end if; end;
 perform public.icash_reserve_operation(a,key||':cancel',rate,now()+interval '1 hour',now(),true);
 perform public.icash_settle_operation(key||':cancel',0,0,'fixture:not-dispatched');
 select reserved_cents into n from public.icash_wallets where account_id=a;
 if n<>0 then raise exception 'Cancellation leaked customer reserve'; end if;
 select reserved_micros into n from public.icash_operating_budget where id=1;
 if n<>0 then raise exception 'Cancellation leaked company reserve'; end if;
 perform public.icash_reserve_operation(a,key||':overrun',rate,now()+interval '1 hour',now(),true);
 perform public.icash_claim_operation(key||':overrun');
 perform public.icash_settle_operation(key||':overrun',100,150000,'fixture:overrun');
 if (select enabled from public.icash_operating_budget where id=1) then raise exception 'Overrun did not stop spending'; end if;
 perform public.icash_record_cost_observation('fixture',key,key,0.1,'usd');
 perform public.icash_record_cost_observation('fixture',key,key,0.1,'usd');
 begin
  perform public.icash_record_cost_observation('fixture',key,key,0.2,'usd');
  raise exception 'TEST_EXPECTED_RECEIPT_CONFLICT';
 exception when others then if sqlerrm<>'Cost receipt conflict' then raise; end if; end;
end $$;
rollback;
select 'atomic reservation, spending holds, one-time dispatch, settlement and receipt tests passed; all fixtures rolled back' as result;
