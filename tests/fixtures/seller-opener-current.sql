-- Narrow read-only snapshot of the current opener, 2026-10-07.
-- Used only in the isolated synthetic recipient-variants test.
CREATE OR REPLACE FUNCTION public.icash_queue_seller_opener(p_account uuid, p_thread uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;principal text;buyer_description text;address text;seller text;greeting text:='Hi, ';message_body text;message uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
perform 1 from public.icash_operating_budget where id=1 for update;
 if not public.icash_outreach_sms_current(p_account) then return null;end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto' and public.icash_sms_thread_review_current(p_account,id,false) for update;
 if not found or exists(select 1 from public.icash_seller_opener_assignments where thread_id=t.id)
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and (state in ('ready','dispatching','needs_review') or created_at>now()-interval '1 day')) then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select trim(i.principal),case when nullif(trim(i.company_name),'') is null then 'an individual HomeOffer Network investor' else 'an independent HomeOffer Network cash buyer' end into principal,buyer_description from public.icash_customer_identities i where i.account_id=p_account;
 address:=trim(d.terms->>'address');
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
  message_body:='Hi, is this '||case when seller is null then '' else seller||', ' end||'the owner of '||address||'?';
 else
  message_body:=greeting||'AI for '||principal||'. Is this the owner of '||address||'? Reply STOP to opt out.';
 end if;
 -- Retain the existing one-segment rate. Never silently truncate identity/address or bill extra segments.
 if length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?]' then return null;end if;
 if public.icash_assign_seller_opener(p_account,t.id) is null then return null;end if;
 update public.icash_seller_opener_assignments a set body=message_body where a.thread_id=t.id and a.account_id=p_account and a.message_id is null;
 message:=public.icash_queue_text(p_account,t.id,t.id,message_body,'{}');
 insert into public.icash_sms_seller_openings(thread_id,account_id,owner_question_id) values(t.id,p_account,message);
 return message;
end $function$
;
