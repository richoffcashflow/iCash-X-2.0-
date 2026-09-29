begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();r uuid;under_rate uuid;tag text:=gen_random_uuid()::text;c jsonb;res jsonb;
begin
 insert into auth.users(id,email) values(u,tag||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,1600,0,'USD');
 update public.icash_operating_budget set enabled=true,require_company_reserve=false,funded_micros=0,spent_micros=0,reserved_micros=0,protected_micros=0 where id=1;
 select jsonb_object_agg(key,0) into c from jsonb_object_keys((select costs_micros from public.icash_operation_rates limit 1)) key;
 c:=c||'{"elevenlabs":1000000,"twilio":1000000}';
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values('sms_ai',tag,800,c,0,'rollback arithmetic fixture',now(),now()+interval '1 hour',true) returning id into r;
 res:=public.icash_reserve_operation(a,tag,r,now()+interval '1 hour');
 if (res->>'reservedMicros')::bigint<>2000000 then raise exception 'Incorrect cost reserve';end if;
 if not public.icash_claim_operation(tag) then raise exception 'Customer-funded job blocked by company cash';end if;
 if (select required_revenue_micros<>8000000 from public.icash_operation_spend where operation_key=tag) then raise exception 'Mixed multiplier failure';end if;
 perform public.icash_reserve_operation(a,tag,r,now()+interval '1 hour');
 if (select reserved_cents<>800 from public.icash_wallets where account_id=a) then raise exception 'Duplicate reservation';end if;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
 values('sms_ai',tag||'-under',799,c,0,'rollback arithmetic fixture',now(),now()+interval '1 hour',true) returning id into under_rate;
 begin
 perform public.icash_reserve_operation(a,tag||'-under',under_rate,now()+interval '1 hour');
 raise exception 'TEST margin bypass';
 exception when others then if sqlerrm<>'Price below provider cost multiplier' then raise;end if;end;
 update public.icash_accounts set bot_paused=true where id=a;
 begin
 perform public.icash_reserve_operation(a,tag||'-paused',r,now()+interval '1 hour');
 raise exception 'TEST pause bypass';
 exception when others then if sqlerrm<>'Bot paused' then raise;end if;end;
 update public.icash_accounts set bot_paused=false where id=a;
 update public.icash_wallets set balance_cents=800 where account_id=a;
 begin
 perform public.icash_reserve_operation(a,tag||'-empty',r,now()+interval '1 hour');
 raise exception 'TEST balance bypass';
 exception when others then if sqlerrm<>'Insufficient credits' then raise;end if;end;
 if has_function_privilege('anon','public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean)','EXECUTE') then raise exception 'Public financial access';end if;
end $$;
rollback;
