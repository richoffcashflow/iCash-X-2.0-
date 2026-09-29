begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();r uuid;s uuid;s2 uuid;p uuid;p2 uuid;j uuid;j2 uuid;lc uuid;costs jsonb;z text;k text:='voice-fixture:'||gen_random_uuid();due timestamptz:=date_trunc('second',now()+interval '1 hour');cb jsonb;d uuid;th uuid;ir uuid;answer jsonb;callid text:='CA'||replace(gen_random_uuid()::text,'-','');conversation text:='conv_'||replace(gen_random_uuid()::text,'-','');before_balance bigint;a2 uuid;u2 uuid;s3 uuid;d2 uuid;th2 uuid;
begin
 insert into auth.users(id,email) values(u,u||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,10000);
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 select jsonb_object_agg(c,case when c='elevenlabs' then 100000 else 0 end) into costs from unnest(array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) c;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds) values('seller_call',k,100,costs,'rollback fixture only',now()-interval '1 minute',now()+interval '1 hour',true,600) returning id into r;
 update public.icash_operating_budget set enabled=true,funded_micros=10000000,protected_micros=1000000,reserved_micros=0,spent_micros=0,daily_limit_micros=null where id=1;
 insert into public.icash_voice_configs(account_id,enabled,agent_id,phone_number_id,agent_config_hash,reviewed_until,seller_rate_id,required_tool_ids) values(a,true,'agent_fixture','fixture',repeat('a',64),now()+interval '1 hour',r,array['callback','handoff']);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,result) values(a,k,'{"propertyId":"prop_123"}','complete','{"financialCheck":{"status":"eligible"}}') returning id into s;
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,result) values(a,k||'2','{"propertyId":"prop_124"}','complete','{"financialCheck":{"status":"eligible"}}') returning id into s2;
 select name into z from pg_timezone_names where extract(hour from now() at time zone name) between 11 and 15 limit 1;
 insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values(a,s,'seller','+12125550123',repeat('b',64),z,'rollback permission fixture',now()+interval '1 day',now(),true) returning id into p;
 insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear) values(a,s2,'seller','+12125550124',repeat('c',64),z,'rollback permission fixture',now()+interval '1 day',now(),true) returning id into p2;

 insert into public.icash_text_senders(phone,enabled) values('+12025550199',false);
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,s,'{"address":"Fixture only","practice":false}','draft') returning id into d;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,paused,ai_mode) values(a,d,'+12025550199','+12125550123',false,'off') returning id into th;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
 values('incoming_call',k||'-inbound',100,costs,'Rollback fixture, no provider traffic',now()-interval '1 minute',now()+interval '1 hour',true,600) returning id into ir;
 insert into public.icash_inbound_voice_routes(called_number,business_number,agent_id,rate_id,enabled,reviewed_until) values('+12025550198','+12025550199','agent_fixture',ir,true,now()+interval '1 hour');
 update public.icash_accounts set bot_paused=true where id=a;
 if public.icash_begin_inbound_voice('+12125550123','+12025550198','agent_fixture',callid,conversation,repeat('d',64),repeat('e',64),repeat('a',64)) is not null then raise exception 'Paused inbound accepted';end if;
 update public.icash_accounts set bot_paused=false where id=a;
 if public.icash_begin_inbound_voice('+12125550125','+12025550198','agent_fixture',callid,conversation,repeat('d',64),repeat('e',64),repeat('a',64)) is not null then raise exception 'Unknown caller matched';end if;
 if public.icash_begin_inbound_voice('+12125550123','+12025550198','agent_wrong',callid,conversation,repeat('d',64),repeat('e',64),repeat('a',64)) is not null then raise exception 'Wrong agent accepted';end if;
 if public.icash_begin_inbound_voice('+12125550123','+12025550198','agent_fixture',callid,conversation,repeat('d',64),repeat('e',64),repeat('f',64)) is not null then raise exception 'Changed agent accepted';end if;
 -- Ambiguous seller/buyer binding must not pick an arbitrary role.
 insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at,dnc_clear)
 values(a,s,'buyer','+12125550123',repeat('b',64),z,'Rollback ambiguity fixture',now()+interval '1 day',now(),true) returning id into p2;
 if public.icash_begin_inbound_voice('+12125550123','+12025550198','agent_fixture',callid,conversation,repeat('d',64),repeat('e',64),repeat('a',64)) is not null then raise exception 'Ambiguous party selected';end if;
 delete from public.icash_contact_permissions where id=p2;
 answer:=public.icash_begin_inbound_voice('+12125550123','+12025550198','agent_fixture',callid,conversation,repeat('d',64),repeat('e',64),repeat('a',64));
 if answer is null or (answer->>'maxSeconds')::integer<>600 then raise exception 'Incoming route not bound';end if;
 if (select account_id from public.icash_live_conversations where conversation_id=conversation)<>a then raise exception 'Wrong tenant';end if;
 before_balance:=(select reserved_cents from public.icash_wallets where account_id=a);
 if public.icash_begin_inbound_voice('+12125550123','+12025550198','agent_fixture',callid,conversation,repeat('d',64),repeat('e',64),repeat('a',64)) is distinct from answer then raise exception 'Replay not idempotent';end if;
 if (select reserved_cents from public.icash_wallets where account_id=a)<>before_balance then raise exception 'Duplicate reservation';end if;
 if public.icash_begin_inbound_voice('+12125550123','+12025550198','agent_fixture',callid,conversation,repeat('f',64),repeat('e',64),repeat('a',64)) is not null then raise exception 'Conflicting replay';end if;
 if (select count(*) from public.icash_inbound_voice_receipts where call_sid=callid)<>1 then raise exception 'Duplicate receipt';end if;
 if has_function_privilege('anon','public.icash_begin_inbound_voice(text,text,text,text,text,text,text,text)','execute') or has_table_privilege('authenticated','public.icash_inbound_voice_receipts','select') then raise exception 'Private route exposed';end if;
end $$;
rollback;
