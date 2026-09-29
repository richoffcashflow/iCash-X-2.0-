begin;
do $$
declare u uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); sk uuid;d uuid;t uuid;m uuid;j uuid;o uuid;r uuid;tag text:=gen_random_uuid()::text;result jsonb;
begin
 insert into auth.users(id,email) values(u,tag||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',false,1000);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,tag,'{"propertyId":"fixture-ai"}','complete') returning id into sk;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,sk,'{"address":"Fixture"}','under_contract') returning id into d;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,paused) values(a,d,'+14243948384','+12125550198',false) returning id into t;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,state,created_at) values(t,a,'incoming','The house needs a roof','received',now()-interval '1 minute') returning id into m;
 select id into j from public.icash_text_ai_jobs where message_id=m;
 if j is null then raise exception 'Missing AI job';end if;
 update public.icash_text_ai_jobs set state='issued' where id=j;
 if public.icash_claim_text_ai(gen_random_uuid(),j) is not null then raise exception 'Tenant bypass';end if;
 if public.icash_claim_text_ai(a,j) is not null then raise exception 'Unfunded AI bypass';end if;
 insert into public.icash_wallets(account_id,balance_cents,reserved_cents,currency) values(a,10000,0,'USD');
 update public.icash_operating_budget set enabled=true,funded_micros=100000000,protected_micros=0,spent_micros=0,reserved_micros=0,daily_limit_micros=null,minimum_margin_bps=8000 where id=1;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,evidence_ref,verified_at,expires_at,enabled)
 select 'sms_ai',tag,charge_cents,costs_micros,'rollback fixture only',now(),now()+interval '1 hour',true from public.icash_operation_rates where operation='title_email' limit 1 returning id into r;
 update public.icash_text_ai_settings set rate_id=r where id=1;
 result:=public.icash_claim_text_ai(a,j);
 if result is null then raise exception 'Valid AI claim failed';end if;
 if public.icash_claim_text_ai(a,j) is not null then raise exception 'Duplicate model claim';end if;
 perform public.icash_save_text_ai(a,j,'{"action":"ask_price","humanRequested":false,"callbackRequested":false}','Draft','fixture','{"prompt_tokens":10}');
 if public.icash_queue_ai_reply(a,j,'Your offer is 100000') is not null then raise exception 'Unapproved auto prose';end if;
 o:=public.icash_queue_ai_reply(a,j,'What price did you have in mind?');
 if o is null then raise exception 'Safe question failed';end if;
 if public.icash_queue_ai_reply(a,j,'What price did you have in mind?') is not null then raise exception 'Duplicate outgoing';end if;
 if (select body not like 'I am the AI assistant%' from public.icash_text_messages where id=o) then raise exception 'Missing disclosure';end if;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,state) values(t,a,'incoming','Please call me tomorrow','received');
 if not (select paused from public.icash_text_threads where id=t) then raise exception 'Handoff did not pause';end if;
 if not exists(select 1 from public.icash_text_ai_jobs where thread_id=t and state='handoff') then raise exception 'Missing callback review';end if;
 if public.icash_claim_text(a,o,'+14243948384') is not null then raise exception 'Handoff send bypass';end if;
 insert into public.icash_text_messages(direction,body,state) values('incoming','Unknown sender','received') returning id into m;
 if exists(select 1 from public.icash_text_ai_jobs where message_id=m) then raise exception 'Unknown sender processed';end if;
 if has_table_privilege('anon','public.icash_text_ai_jobs','SELECT') or has_function_privilege('authenticated','public.icash_queue_ai_reply(uuid,uuid,text)','EXECUTE') then raise exception 'Public AI access';end if;
end $$;
rollback;
