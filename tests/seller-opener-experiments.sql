begin;
do $$
declare th uuid;msg uuid;incoming uuid;choice jsonb;again jsonb;original public.icash_text_threads;
begin
 select * into original from public.icash_text_threads where id='9f8e7737-bc2b-4d4a-8cc6-e40b4f6e1833';
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,paused,ai_mode)
 values(original.account_id,original.deal_id,original.sender,'+12025550199',now()+interval '1 hour','Rollback-only fixture, never dispatch',false,'auto') returning id into th;
 choice:=public.icash_assign_seller_opener(original.account_id,th);
 again:=public.icash_assign_seller_opener(original.account_id,th);
 if choice<>again then raise exception 'Variant changed mid-thread';end if;
 if public.icash_assign_seller_opener(gen_random_uuid(),th) is not null then raise exception 'Tenant leak';end if;
 msg:=public.icash_queue_seller_opener(original.account_id,th);
 if msg is null then raise exception 'Opener not queued';end if;
 if public.icash_queue_seller_opener(original.account_id,th) is not null then raise exception 'Duplicate opener';end if;
 if (select delivered_at from public.icash_seller_opener_assignments where thread_id=th) is not null then raise exception 'Queue counted as delivery';end if;
 update public.icash_text_messages set state='delivered' where id=msg;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,state,created_at) values(th,original.account_id,'incoming','Not interested','received',now()+interval '1 second') returning id into incoming;
 if not exists(select 1 from public.icash_seller_opener_assignments where thread_id=th and delivered_at is not null and first_reply_at is not null and opted_out) then raise exception 'Outcome tracking failed';end if;
 if public.icash_text_property_context(gen_random_uuid(),original.id) is not null then raise exception 'Property context leak';end if;
 if (public.icash_text_property_context(original.account_id,original.id)->>'ceilingCents')::bigint<>5410000 then raise exception 'Property ceiling not connected';end if;
 if has_function_privilege('anon','public.icash_queue_seller_opener(uuid,uuid)','execute') then raise exception 'Public sender access';end if;
end $$;
rollback;
