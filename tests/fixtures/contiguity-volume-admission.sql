-- Deterministic local substitutes for pre-existing provider/funding and identity
-- adapters. The outer live claim, sender trigger, deferral, and rollback run as SQL.
create function public.icash_claim_text_before_progress(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql as $$
begin
 if not exists(select 1 from public.icash_text_messages m join public.icash_text_threads t on t.account_id=m.account_id and t.id=m.thread_id
   where m.account_id=p_account and m.id=p_message and m.state='ready' and t.sender=p_sender) then return null;end if;
 insert into public.icash_operation_spend(operation_key,account_id,dispatched_at) values('text:'||p_message,p_account,clock_timestamp());
 update public.icash_text_messages set state='dispatching' where account_id=p_account and id=p_message and state='ready';
 return jsonb_build_object('from',p_sender);
end $$;
create function public.icash_legacy_admit(uuid,text) returns boolean language sql as $$select true$$;
create function public.icash_webinar_campaign_sender(text) returns text language sql as $$select '+14155550100'::text$$;
create function public.icash_phone_access_target(text,text) returns jsonb language sql as $$select jsonb_build_object('membershipId',md5('membership')::uuid)$$;
create function public.icash_purchase_access_followup_allowed(uuid) returns boolean language sql as $$select true$$;
insert into public.icash_accounts(id,bot_paused) values(md5('owner')::uuid,false);
insert into public.icash_screening_jobs(id,account_id,snapshot) values(md5('screen')::uuid,md5('owner')::uuid,'{"raw":{"data":{"state":"TX"}}}');
insert into public.icash_deal_files(id,account_id,screening_id) values(md5('deal')::uuid,md5('owner')::uuid,md5('screen')::uuid);
create function fixture_thread(k text,s text default '+14155550100') returns uuid language plpgsql as $$
declare t uuid:=md5('thread'||k)::uuid;
begin
 insert into public.icash_text_threads(id,account_id,deal_id,sender,recipient,party,paused,ai_mode)
 values(t,md5('owner')::uuid,md5('deal')::uuid,s,'+1202'||lpad((abs(hashtextextended(k,1))%10000000)::text,7,'0'),'seller',false,'auto');
 return t;
end $$;
create function fixture_message(k text,t uuid) returns uuid language plpgsql as $$
declare m uuid:=md5('message'||k)::uuid;
begin
 insert into public.icash_text_messages(id,thread_id,account_id,direction,state,body,created_at,updated_at)
 values(m,t,md5('owner')::uuid,'outgoing','ready','Are you interested in an offer?',now(),now());
 return m;
end $$;
create function public.icash_seller_progress_gate(uuid,uuid) returns boolean language sql as $$select true$$;

create function icash_text_receipt_private.sender_opener_available(text) returns boolean language sql stable as $$select true$$;
