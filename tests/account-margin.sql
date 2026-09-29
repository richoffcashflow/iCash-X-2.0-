begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); hi uuid; lo uuid; search_rate uuid; screening uuid; k text:='margin-fixture:'||gen_random_uuid(); costs jsonb;
begin
 insert into auth.users(id,email) values(u,k||'@example.invalid');
 insert into icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 update icash_operating_budget set enabled=true,funded_micros=100000000,protected_micros=0,spent_micros=0,reserved_micros=0,daily_limit_micros=null,minimum_margin_bps=8000 where id=1;
 select jsonb_object_agg(c,case when c='title_and_signing' then 1000000 else 0 end) into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('fixture',k,1000,costs,'rollback fixture only',now()-interval '1 minute',now()+interval '1 hour',true) returning id into hi;
 insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('contract_signing',k||':low',100,jsonb_set(costs,'{title_and_signing}','400000'),'rollback fixture only',now()-interval '1 minute',now()+interval '1 hour',true) returning id into lo;
 begin
 perform icash_reserve_operation(a,k||':noheadroom',lo,now()+interval '1 hour');
 raise exception 'Fresh account subsidized';
 exception when others then if sqlerrm<>'Account margin reserve exhausted' then raise;end if;end;
 perform icash_reserve_operation(a,k||':earn',hi,now()+interval '1 hour');perform icash_claim_operation(k||':earn');
 perform icash_settle_operation(k||':earn',1000,1000000,'fixture settled evidence');
 perform icash_reserve_operation(a,k||':sign',lo,now()+interval '1 hour');perform icash_claim_operation(k||':sign');
 perform icash_settle_operation(k||':sign',100,400000,'fixture signed evidence');
 perform icash_settle_operation(k||':sign',100,400000,'fixture signed evidence');
 if (select balance_cents from icash_wallets where account_id=a)<>8900 then raise exception 'Duplicate charge';end if;
 if (select bot_paused from icash_accounts where id=a) or not (select enabled from icash_operating_budget where id=1) then raise exception 'Profitable pooled signing paused';end if;
 if icash_account_margin_ok(gen_random_uuid(),100,400000,true) then raise exception 'Cross-account subsidy';end if;
 perform icash_reserve_operation(a,k||':pending1',lo,now()+interval '1 hour');
 perform icash_reserve_operation(a,k||':pending2',lo,now()+interval '1 hour');
 begin
 perform icash_reserve_operation(a,k||':pending3',lo,now()+interval '1 hour');
 raise exception 'Pending costs ignored';
 exception when others then if sqlerrm<>'Account margin reserve exhausted' then raise;end if;end;
 update icash_accounts set bot_paused=true where id=a;
 if icash_claim_operation(k||':pending1') then raise exception 'Stop ignored';end if;
 perform icash_settle_operation(k||':pending1',0,0,'fixture canceled');
 perform icash_settle_operation(k||':pending2',0,0,'fixture canceled');
 update icash_accounts set bot_paused=false,daily_limit_cents=1000 where id=a;
 update icash_wallets set balance_cents=150 where account_id=a;
 insert into icash_screening_jobs(account_id,event_key,snapshot,state) values(a,k,'{"propertyId":"prop_fixture"}','complete') returning id into screening;
 insert into icash_deal_files(account_id,screening_id,terms,stage) values(a,screening,'{}','under_contract');
 insert into icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('property_search',k||':search',100,jsonb_set(costs,'{title_and_signing}','400000'),'rollback fixture only',now()-interval '1 minute',now()+interval '1 hour',true) returning id into search_rate;
 begin
 perform icash_reserve_operation(a,k||':search',search_rate,now()+interval '1 hour');
 raise exception 'Protected followup credits spent';
 exception when others then if sqlerrm<>'Credits protected for active deals and callbacks' then raise;end if;end;
 if has_function_privilege('authenticated','icash_account_margin_ok(uuid,bigint,bigint,boolean)','execute') then raise exception 'Private economics exposed';end if;
end $$;
rollback;
