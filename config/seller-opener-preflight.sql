-- Filter unqueueable seller openers before the scheduler's LIMIT.
-- Reuse the exact current pre-assignment checks, without locks or mutations.
-- Final queue/send checks, invitations and all original receipts stay unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$
declare item record;
begin
 for item in select * from (values
  ('icash_next_before_sms_inbound_campaign()','4a937a7f00a6c4bb990a1df322b2bfe6'),
  ('icash_next_before_unstarted_sms_recovery()','f1d9bfb760d7bd436c0463428ec77a2c'),
  ('icash_queue_seller_opener(uuid,uuid)','603fc3af42d39343f19e0bafe571395c')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Seller opener preflight prerequisite changed: %',item.signature;
  end if;
 end loop;
end $guard$;

create function public.icash_seller_opener_candidate_body(p_account uuid,p_thread uuid)
returns text language plpgsql stable set search_path='' as $function$
declare t public.icash_text_threads;d public.icash_deal_files;principal text;buyer_description text;address text;seller text;greeting text:='Hi, ';message_body text;message uuid;choice jsonb;
begin
 if not public.icash_outreach_sms_current(p_account) then return null;end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto' and public.icash_sms_thread_review_current(p_account,id,false);
 if not found or exists(select 1 from public.icash_seller_opener_assignments where thread_id=t.id)
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and (state in ('ready','dispatching','needs_review') or created_at>now()-interval '1 day')) then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select trim(i.principal),case when nullif(trim(i.company_name),'') is null then 'an individual HomeOffer Network investor' else 'an independent HomeOffer Network cash buyer' end into principal,buyer_description from public.icash_customer_identities i where i.account_id=p_account;
 address:=public.icash_conversation_street(d.terms->>'address');
 if coalesce(length(address),0)=0 or coalesce(length(principal),0)=0 then return null;end if;
 -- A property-record owner is not necessarily the person replying. Use only
 -- a strict self-introduction from this same contact after an actually sent text.
 -- Capture the FIRST name, never disclose terms.seller or another recorded owner.
 select substring(m.body from '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$') into seller
 from public.icash_text_messages m
 where m.thread_id=t.id and m.account_id=p_account and m.direction='incoming' and m.state='received'
 and m.body ~ '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$'
 and exists(select 1 from public.icash_text_messages sent where sent.thread_id=t.id and sent.account_id=p_account and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<m.created_at)
 order by m.created_at desc,m.id desc limit 1;
 if lower(seller) in ('interested','owner','selling','ready','not','yes','no') then seller:=null;end if;
 if seller is not null then greeting:='Hi '||seller||', ';end if;
 if t.seller_intake_id is not null and public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient) is not null then
  select split_part(trim(l.name),' ',1) into seller from public.icash_seller_intakes l where l.id=t.seller_intake_id and l.phone=t.recipient;
  if seller is null or seller !~ '^[A-Za-z][A-Za-z]{0,30}$' then seller:=null;end if;
  message_body:=public.icash_seller_recipient_opener(p_account,t.id,seller,principal,address);
  if message_body is null then return null;end if;
 else
  message_body:='Is this '||case when seller is null then '' else seller||', ' end||'the owner of '||address||'? I am reaching out about a possible cash offer.';
 end if;
 -- Retain the existing one-segment rate. Never silently truncate identity/address or bill extra segments.
 if length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?]' then return null;end if;
 return message_body;
end $function$;
revoke all on function public.icash_seller_opener_candidate_body(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_opener_candidate_body(uuid,uuid) to service_role;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_next_before_unstarted_sms_recovery()'::regprocedure);
 needle:='not exists(select 1 from public.icash_text_messages where thread_id=th.id)';
 replacement:='(not exists(select 1 from public.icash_text_messages where thread_id=th.id) and public.icash_seller_opener_candidate_body(th.account_id,th.id) is not null)';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Seller invitation selector changed';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.icash_next_before_sms_inbound_campaign()'::regprocedure);
 needle:='and not exists(select 1 from public.icash_text_messages m where m.thread_id=t.id)';
 replacement:=needle||' and public.icash_seller_opener_candidate_body(t.account_id,t.id) is not null';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>2 then raise exception 'Seller opener selector changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;

