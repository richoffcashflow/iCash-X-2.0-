begin;
do $$
declare original public.icash_text_threads;deal public.icash_deal_files;th uuid;permission uuid;msg uuid;opener uuid;ctx jsonb;
begin
 select * into original from public.icash_text_threads where id='9f8e7737-bc2b-4d4a-8cc6-e40b4f6e1833';
 select * into deal from public.icash_deal_files where id=original.deal_id;
 -- Temporarily remove the practice marker within this rolled-back fixture only.
 update public.icash_deal_files set terms=terms-'practice' where id=deal.id;
 insert into public.icash_text_threads(account_id,deal_id,sender,recipient,paused,ai_mode)
 values(original.account_id,deal.id,original.sender,'+12025550198',true,'off') returning id into th;
 insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,permission_evidence,permission_until,dnc_checked_at)
 values(original.account_id,deal.screening_id,'seller','+12025550198','0b764ff05f25759b8ab040872abaf0084f465951b34f02ce98dc028f847c1cfd','America/Chicago','Rollback-only fixture; not authorized to dial',now()-interval '1 hour',now()) returning id into permission;
 perform public.icash_assign_seller_opener(original.account_id,th);
 insert into public.icash_text_messages(account_id,thread_id,direction,body,state,created_at)
 select original.account_id,th,'outgoing',body,'accepted',now()-interval '1 minute' from public.icash_seller_opener_assignments where thread_id=th returning id into opener;
 insert into public.icash_text_messages(account_id,thread_id,direction,body,state) values(original.account_id,th,'incoming','Yes call me','received') returning id into msg;
 if (select count(*) from public.icash_sms_call_requests where thread_id=th and state='needs_review')<>1 then raise exception 'Request lost';end if;
 insert into public.icash_text_messages(account_id,thread_id,direction,body,state) values(original.account_id,th,'incoming','Please call me back','received');
 if (select count(*) from public.icash_sms_call_requests where thread_id=th and state='needs_review')<>1 then raise exception 'Duplicate request';end if;
 if (select first_reply_at from public.icash_seller_opener_assignments where thread_id=th) is not null then raise exception 'Unconfirmed delivery counted';end if;
 update public.icash_text_messages set state='delivered' where id=opener;
 if (select first_reply_at from public.icash_seller_opener_assignments where thread_id=th) is null then raise exception 'Late delivery lost response';end if;
 ctx:=public.icash_voice_sms_context(original.account_id,permission);
 if jsonb_array_length(ctx->'messages')<>3 then raise exception 'Context not connected: %',ctx;end if;
 if public.icash_voice_sms_context(gen_random_uuid(),permission) is not null then raise exception 'Tenant leak';end if;
 update public.icash_contact_permissions set phone='+12025550197' where id=permission;
 if public.icash_voice_sms_context(original.account_id,permission) is not null then raise exception 'Wrong phone history';end if;
 update public.icash_contact_permissions set phone='+12025550198' where id=permission;
 insert into public.icash_text_messages(account_id,thread_id,direction,body,state) values(original.account_id,th,'incoming','Cancel my call','received');
 if exists(select 1 from public.icash_sms_call_requests where thread_id=th and state='needs_review') then raise exception 'Cancellation ignored';end if;
 insert into public.icash_text_messages(account_id,thread_id,direction,body,state) values(original.account_id,th,'incoming','Do not call me','received');
 if exists(select 1 from public.icash_sms_call_requests where thread_id=th and state='needs_review') then raise exception 'Negated request became active';end if;
 insert into public.icash_text_messages(account_id,thread_id,direction,body,state) values(original.account_id,th,'incoming','Not interested','received');
 if not (select opted_out from public.icash_seller_opener_assignments where thread_id=th) then raise exception 'Decline counted as success';end if;
 update public.icash_deal_files set terms=terms||'{"practice":true}'::jsonb where id=deal.id;
 if public.icash_voice_sms_context(original.account_id,permission) is not null then raise exception 'Practice leaked into production';end if;
 if has_function_privilege('anon','public.icash_voice_sms_context(uuid,uuid)','execute') or has_table_privilege('authenticated','public.icash_sms_call_requests','select') then raise exception 'Public history access';end if;
 if exists(select 1 from public.icash_voice_jobs where permission_id=permission) then raise exception 'Request created unauthorized call';end if;
end $$;
rollback;
