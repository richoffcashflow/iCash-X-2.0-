-- Display/count/order only. Raw Meta response_at remains a historical stop
-- barrier for unanswered follow-ups, cancellation and outreach admission.
-- Install after the shared classifier and response-text projection migrations.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.icash_meta_display_response_at(p_account uuid,p_lead uuid) returns timestamptz
language plpgsql stable security invoker set search_path='' as $fn$
declare m public.icash_meta_leads;response_time timestamptz;
begin
 select * into m from public.icash_meta_leads where account_id=p_account and lead_id=p_lead;
 if not found then return null;end if;
 -- Do not infer absence from missing legacy source records. Change only an SMS
 -- timestamp exactly attributable to a known whole notice on this lead's own
 -- account/property thread. A matching phone or a later notice is insufficient.
 if m.response_at is null or m.response_channel is distinct from 'sms' or not exists(
  select 1 from public.icash_text_threads t
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_text_messages notice on notice.thread_id=t.id and notice.account_id=t.account_id
  where t.account_id=m.account_id and t.seller_intake_id=m.lead_id and t.party='seller'
   and d.screening_id=m.screening_id and notice.direction='incoming' and notice.state='received'
   and notice.created_at=m.response_at and public.icash_is_carrier_text_notice(notice.body,notice.attachments)
 ) then return m.response_at;end if;

 -- response_at is the first response, not the latest notice. Preserve original
 -- source times and independent SMS, voice, confirmed-address and seller-email
 -- evidence. Retired threads and legacy incoming texts lacking provider IDs
 -- still count here: the historical Meta observer did not exclude either.
 select min(e.at_time) into response_time from (
  select msg.created_at at_time
  from public.icash_text_threads t
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_response_text_messages msg on msg.thread_id=t.id and msg.account_id=t.account_id
  where t.account_id=m.account_id and t.seller_intake_id=m.lead_id and t.party='seller'
   and d.screening_id=m.screening_id and msg.direction='incoming' and msg.state='received'
  union all
  select c.completed_at from public.icash_live_conversations c
  join public.icash_seller_intakes l on l.id=m.lead_id
  where c.account_id=m.account_id and c.screening_id=m.screening_id and c.party='seller'
   and c.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex')
   and c.state='complete' and c.completed_at is not null and public.icash_meta_call_outcome(c.result)='responded'
  union all
  select m.address_confirmed_at
  union all
  select mail.created_at from public.icash_deal_files d
  join public.icash_seller_email_openers opener on opener.deal_id=d.id and opener.account_id=d.account_id
  join public.icash_deal_emails mail on mail.account_id=opener.account_id and mail.deal_id=opener.deal_id
   and lower(mail.recipient)=opener.recipient and mail.reply_to_id=opener.email_id
  where d.account_id=m.account_id and d.screening_id=m.screening_id
   and mail.direction='incoming' and mail.state='received' and mail.provider_id is not null
 ) e;
 return response_time;
end $fn$;
revoke all on function public.icash_meta_display_response_at(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_meta_display_response_at(uuid,uuid) to service_role;

-- Patch only reviewed display consumers. The original response field and all
-- raw-table eligibility/stop readers retain their exact definitions and behavior.
-- Keep current reply joins, pagination, scope, search, ACL and invoker semantics.
do $patch$
declare signature text;definition text;expected integer;needle text:='m.response_at';
begin
 for signature,expected in select * from (values
  ('public.icash_meta_workspace_response_leads(uuid,text,integer,integer,uuid,boolean)',3),
  ('public.icash_meta_workspace_leads(uuid,text,integer,integer,uuid)',1),
  ('public.icash_workspace_response_counts(uuid)',1)
 ) targets(signature,expected) loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>expected
   or position('public.icash_meta_leads m' in definition)=0
   or (signature='public.icash_workspace_response_counts(uuid)' and
    (position('m.screening_id=s.id and m.account_id=s.account_id' in definition)=0
     or position('public.icash_workspace_seller_texts(p_account,null)' in definition)=0))
   or (signature<>'public.icash_workspace_response_counts(uuid)' and
    (position('m.account_id=p_account' in definition)=0 or position('offset greatest(0,least(60000,p_offset))' in definition)=0))
  then raise exception 'Carrier Meta response display prerequisite changed: %',signature;end if;
  execute replace(definition,needle,'public.icash_meta_display_response_at(m.account_id,m.lead_id)');
 end loop;
end $patch$;
commit;
