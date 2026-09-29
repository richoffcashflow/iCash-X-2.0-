begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); rate uuid; costs jsonb; n bigint; msg text; screening uuid; call_id uuid; h uuid; result jsonb; key text:='cost-test:'||gen_random_uuid();
begin
 insert into auth.users(id,email) values(u,'cost-test-'||u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 select jsonb_object_agg(c,case when c='elevenlabs' then 100000 else 0 end) into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled) values('seller_call',key,100,costs,'fixture:rollback-only',now()-interval '1 minute',now()+interval '1 hour',true) returning id into rate;
 update public.icash_operating_budget set enabled=true,funded_micros=10000000,protected_micros=1000000,reserved_micros=0,spent_micros=0,daily_limit_micros=5000000 where id=1;

 perform public.icash_reserve_operation(a,key,rate,now()+interval '1 hour',now(),true);
 if not public.icash_claim_operation(key) then raise exception 'Claim failed';end if;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,key,'{"propertyId":"prop_123"}','complete') returning id into screening;
 insert into public.icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,tool_token_hash,tool_expires_at)
 values(a,screening,'seller','agent_fixture','conv_fixture'||replace(a::text,'-',''),key,'fixture-contact-key','cash_interest',repeat('a',64),now()+interval '1 hour') returning id into call_id;
 h:=public.icash_open_handoff(call_id,'Requested person','Fixture summary','Follow up personally.');
 if public.icash_open_handoff(call_id,'Requested person','Fixture summary','Follow up personally.')<>h then raise exception 'Duplicate handoff';end if;
 if not exists(select 1 from public.icash_property_controls where account_id=a and property_id='prop_123' and manual) then raise exception 'Property not paused';end if;
 perform public.icash_acknowledge_handoff(u,a,h);
 if not exists(select 1 from public.icash_property_controls where account_id=a and manual) then raise exception 'Acknowledgement resumed bot';end if;
 result:=jsonb_build_object('party','seller','summary','Confirmed callback and handoff','transcript','[]'::jsonb,'humanRequested',true,'optedOut',false,'nextAction','Follow up personally.','callbackDueAt',now()+interval '1 day','callbackTimezone','America/Chicago','callbackQuote','Tomorrow at 2');
 perform public.icash_save_live_result(call_id,result);
 perform public.icash_save_live_result(call_id,result);
 if (select count(*) from public.icash_live_callbacks where conversation_id=call_id)<>1 then raise exception 'Duplicate callback';end if;
 if not exists(select 1 from public.icash_live_callbacks where conversation_id=call_id and state='held_for_human') then raise exception 'Handoff callback not held';end if;
 perform public.icash_set_work_control(u,a,'return_to_bot',screening);
 if exists(select 1 from public.icash_handoffs where id=h and state<>'resolved') then raise exception 'Handoff unresolved';end if;
 if has_function_privilege('anon','public.icash_live_handoff_tool(text,text,text)','EXECUTE') or has_table_privilege('authenticated','public.icash_live_conversations','SELECT') then raise exception 'Private data exposed';end if;
end $$;
rollback;
