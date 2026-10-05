CREATE OR REPLACE FUNCTION public.icash_queue_text(p_account uuid, p_thread uuid, p_key uuid, p_body text, p_assets uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;m public.icash_text_messages;urls jsonb;total bigint;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account) then raise exception 'Thread not available';end if;
 if length(trim(p_body))=0 and cardinality(p_assets)=0 then raise exception 'Message required';end if;
 if length(p_body)>1000 or cardinality(p_assets)>3 then raise exception 'Message too large';end if;
 -- One SMS segment per reviewed rate; MMS has its own independent rate.
 if cardinality(p_assets)=0 and (length(p_body)>160 or (p_body ~ '[^A-Za-z0-9 .,!?]' and length(p_body)>35)) then raise exception 'Shorten the message';end if;
 select coalesce(jsonb_agg(url order by id),'[]'),coalesce(sum(bytes),0) into urls,total from public.icash_text_assets where id=any(p_assets) and account_id=p_account and deal_id=t.deal_id and verified_until>now();
 if jsonb_array_length(urls)<>cardinality(p_assets) or total>5000000 then raise exception 'Verified attachments required';end if;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,asset_ids,attachments,state,request_key) values(t.id,p_account,'outgoing',p_body,p_assets,urls,'ready',p_key) on conflict(request_key) do nothing;
 select * into m from public.icash_text_messages where request_key=p_key;
 -- Insert uses the caller's idempotency key below; no cross-account lookup may return an ID.
 if m.id is null then raise exception 'Message key missing';end if;
 if m.account_id<>p_account or m.thread_id<>p_thread or m.body<>p_body or m.asset_ids<>p_assets then raise exception 'Message key conflict';end if;
 return m.id;
end $function$

