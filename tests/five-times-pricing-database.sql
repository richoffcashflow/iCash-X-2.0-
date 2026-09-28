begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); r uuid; low_rate uuid; costs jsonb; k text:='five-x:'||gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 select jsonb_object_agg(c,case when c='elevenlabs' then 100000 else 0 end) into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 update public.icash_operating_budget set enabled=true,funded_micros=10000000,protected_micros=1000000,reserved_micros=0,spent_micros=0,daily_limit_micros=null,minimum_margin_bps=8000 where id=1;
 -- 10 cents all-in + 20% buffer = 12 cents reserved. Minimum price is 60 cents.
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('property_lookup',k,60,costs,'fixture',now()-interval '1 minute',now()+interval '1 hour',true) returning id into r;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('property_lookup',k||':low',59,costs,'fixture',now()-interval '1 minute',now()+interval '1 hour',true) returning id into low_rate;
 perform public.icash_reserve_operation(a,k,r,now()+interval '1 hour');
 if (select reserved_micros from public.icash_operating_budget where id=1)<>120000 then raise exception 'Exact five-times reservation failed'; end if;
 begin
  perform public.icash_reserve_operation(a,k||':low',low_rate,now()+interval '1 hour');
  raise exception 'TEST_EXPECTED_MARGIN_HOLD';
 exception when others then if sqlerrm<>'Margin floor' then raise; end if; end;
 -- No daily dollar cap still preserves total company liquidity.
 update public.icash_operating_budget set funded_micros=1120000 where id=1;
 begin
  perform public.icash_reserve_operation(a,k||':next',r,now()+interval '1 hour');
  raise exception 'TEST_EXPECTED_CASH_HOLD';
 exception when others then if sqlerrm<>'Company budget exhausted' then raise; end if; end;
end $$;
rollback;
select minimum_margin_bps,daily_limit_micros,enabled from public.icash_operating_budget where id=1;
