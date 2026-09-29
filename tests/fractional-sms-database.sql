begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();sk uuid;d uuid;t uuid;r uuid;m uuid;k text;tag text:=gen_random_uuid()::text;tz text;components jsonb;i integer;
begin
 insert into auth.users(id,email) values(u,tag||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,1000);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,tag,'{"propertyId":"fixture-fractional"}','complete') returning id into sk;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,sk,'{}','under_contract') returning id into d;
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 update public.icash_operating_budget set enabled=true,funded_micros=100000000,protected_micros=0,spent_micros=0,reserved_micros=0,daily_limit_micros=null,minimum_margin_bps=8000 where id=1;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
 select 'sms_send',tag,charge_cents,costs_micros,'rollback fixture only',now(),now()+interval '1 hour',true from public.icash_operation_rates where operation='title_email' limit 1 returning id into r;
 select name into tz from pg_timezone_names where extract(hour from now() at time zone name)=12 limit 1;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,paused,permission_until,permission_evidence,dnc_checked_at,dnc_clear,sms_rate_id,timezone)
 values(a,d,'+14243948384','+12125550197',false,now()+interval '1 hour','Rollback-only explicit SMS permission',now(),true,r,tz) returning id into t;
 select jsonb_object_agg(key,jsonb_build_object('amountMicros',0,'evidenceRef','Rollback fixture zero cost only')) into components from jsonb_object_keys((select costs_micros from public.icash_operation_rates where id=r)) key;
 for i in 1..13 loop
 m:=public.icash_queue_text(a,t,gen_random_uuid(),'Fixture message','{}');k:='text:'||m;
 if (select customer_price_micros from public.icash_text_messages where id=m)<>20800 then raise exception 'Price snapshot mismatch';end if;
 if public.icash_claim_text(a,m,'+14243948384') is null then raise exception 'Valid send claim failed';end if;
 perform public.icash_settle_complete_costs(k,25,components,'Rollback fixture full cost evidence');
 perform public.icash_settle_complete_costs(k,25,components,'Rollback fixture full cost evidence');
 end loop;
 if (select sum(price_micros) from public.icash_fractional_usage where account_id=a)<>270400 then raise exception 'Exact total incorrect';end if;
 if (select sum(charged_cents) from public.icash_fractional_usage where account_id=a)<>27 then raise exception 'Per-message rounding or duplicate debit';end if;
 if (select remaining_micros from public.icash_fractional_credit_carry where account_id=a)<>400 then raise exception 'Remainder lost';end if;
 if (select balance_cents from public.icash_wallets where account_id=a)<>9973 then raise exception 'Wallet mismatch';end if;
 if has_table_privilege('authenticated','public.icash_fractional_usage','SELECT') then raise exception 'Public cost access';end if;
end $$;
rollback;
