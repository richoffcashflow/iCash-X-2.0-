begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); r uuid; low_rate uuid; rev uuid; result jsonb; n integer; ticket jsonb; consumed jsonb; screening uuid; costs jsonb; k text:='five-x:'||gen_random_uuid();
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

 insert into public.icash_discovery_configs(account_id,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,enabled) values(a,'75201',r,10000,now()+interval '1 hour',100000,true) returning revision into rev;
 if not public.icash_claim_operation(k) then raise exception 'Claim failed';end if;
 result:=jsonb_build_object('creditsUsed',1,'peopleCredits',0,'estimatedCredits',1,'hasNextPage',false,'fetchedAt',now(),'rows',jsonb_build_array(jsonb_build_object('dm_property_id','prop_123','full_address','Fixture only','estimated_value',200000,'estimated_repair_cost',40000,'total_estimated_loan_balance',50000)));
 n:=public.icash_save_discovery(a,k,rev,1,result);
 if n<>1 then raise exception 'Screening not queued';end if;
 if public.icash_save_discovery(a,k,rev,1,result)<>1 then raise exception 'Idempotent save failed';end if;
 if (select count(*) from public.icash_screening_jobs where account_id=a)<>1 then raise exception 'Duplicate screening';end if;
 if not (select exhausted and next_page=2 from public.icash_discovery_configs where account_id=a) then raise exception 'Cursor not saved';end if;
 if (select count(*) from public.icash_cost_observations where provider='dealmachine' and event_key=k)<>1 then raise exception 'Receipt not saved';end if;

 select id into screening from public.icash_screening_jobs where account_id=a limit 1;
 update public.icash_screening_jobs set state='complete',completed_at=now(),result='{"financialCheck":{"status":"eligible"}}' where id=screening;
 update public.icash_discovery_configs set auto_enabled=true,contacts_enabled=true,contact_rate_id=r,next_run_at=now() where account_id=a;
 update public.icash_accounts set bot_paused=true where id=a;
 if public.icash_next_automation() is not null then raise exception 'Paused tenant scheduled';end if;
 update public.icash_accounts set bot_paused=false where id=a;
 update public.icash_wallets set reserved_cents=balance_cents where account_id=a;
 if public.icash_next_automation() is not null then raise exception 'Zero available scheduled';end if;
 update public.icash_wallets set reserved_cents=60 where account_id=a;
 ticket:=public.icash_next_automation();
 if ticket is null then raise exception 'Ticket missing';end if;
 consumed:=public.icash_consume_automation(ticket->>'token');
 if consumed->>'kind'<>'contacts' or (consumed->>'screeningId')::uuid<>screening then raise exception 'Owner enrichment not prioritized';end if;
 if public.icash_consume_automation(ticket->>'token') is not null then raise exception 'Ticket replay';end if;
 if public.icash_next_automation() is not null then raise exception 'Schedule ran too early';end if;
 perform public.icash_finish_automation((consumed->>'id')::uuid,true,'contacts_saved');
 -- This fixture reuses its dispatched operation only to exercise receipt persistence.
 begin
 perform public.icash_save_contacts(a,screening,k||':invalid','{"creditsUsed":1,"contacts":[]}');
 raise exception 'TEST_EXPECTED_DISPATCH_HOLD';
 exception when others then if sqlerrm<>'Dispatched enrichment required' then raise;end if;end;
 if exists(select 1 from public.icash_owner_contacts where account_id=a) then raise exception 'Unpaid contacts persisted';end if;
 if has_function_privilege('anon','public.icash_consume_automation(text)','EXECUTE') then raise exception 'Token API exposed';end if;
end $$;
rollback;
