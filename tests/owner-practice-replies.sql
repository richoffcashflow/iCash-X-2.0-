begin;
do $$
declare u uuid:=gen_random_uuid();a uuid:=gen_random_uuid();sk uuid;d uuid;t uuid;m uuid;tag text:=gen_random_uuid()::text;j jsonb;r jsonb;
begin
 insert into auth.users(id,email) values(u,tag||'@example.invalid');
 insert into public.icash_accounts(id,owner_user_id,assistant_name,bot_paused,daily_limit_cents) values(a,u,'Fixture',true,1000);
 insert into public.icash_screening_jobs(account_id,event_key,snapshot,state) values(a,tag,'{"propertyId":"fixture-owner"}','complete') returning id into sk;
 insert into public.icash_deal_files(account_id,screening_id,terms,stage) values(a,sk,'{"practice":true,"address":"Fixture"}','draft') returning id into d;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,paused,permission_until) values(a,d,'+14243948384','+12125550197',true,now()+interval '1 hour') returning id into t;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,state,event_id,created_at) values(t,a,'incoming','The house needs a roof','received',tag,now()-interval '1 minute') returning id into m;
 if public.icash_claim_owner_reply(tag) is not null then raise exception 'Unauthorized diagnostic';end if;
 insert into public.icash_owner_reply_sessions(thread_id,enabled,expires_at,remaining,authorization_ref) values(t,true,now()+interval '1 hour',1,'Explicit rollback fixture authorization');
 j:=public.icash_claim_owner_reply(tag);
 if j is null then raise exception 'Claim failed';end if;
 if public.icash_claim_owner_reply(tag) is not null then raise exception 'Replay bypass';end if;
 r:=public.icash_prepare_owner_reply((j->>'id')::uuid,'ask_price','{"analysis":{"action":"ask_price"}}');
 if r->>'message' not like 'iCash X AI practice.%' then raise exception 'Unlabeled practice';end if;
 if public.icash_prepare_owner_reply((j->>'id')::uuid,'ask_price','{}') is not null then raise exception 'Repeated send';end if;
 if (select remaining from public.icash_owner_reply_sessions where thread_id=t)<>0 then raise exception 'Cap not decremented';end if;
 if has_table_privilege('anon','public.icash_owner_reply_sessions','SELECT') or has_function_privilege('authenticated','public.icash_claim_owner_reply(text)','EXECUTE') then raise exception 'Public diagnostic access';end if;
end $$;
rollback;
