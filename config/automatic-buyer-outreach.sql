begin;
set local lock_timeout='5s';
-- Buyer outreach is automatic for every funded, running account. These are
-- workflow checks, not new recipient permission or proof-of-funds records.
create function public.icash_buyer_outreach_running(p_account uuid,p_deal uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_deal_files d
 join public.icash_accounts a on a.id=d.account_id and not a.bot_paused
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>0
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account
 and public.icash_membership_work_allowed(p_account)
 and public.icash_buyer_package_data(p_account,p_deal) is not null
 and not public.icash_buyer_outreach_held(p_account,p_deal)
 and not public.icash_buyer_is_reserved(p_account,p_deal)
 and not exists(select 1 from public.icash_property_controls c where c.account_id=p_account and c.property_id=s.snapshot->>'propertyId' and c.manual));
$$;

-- The legacy intake always inserted a paused thread. Its Run action only
-- released draft seller deals, so approved buyer contacts could never start.
-- Release ONLY that initial intake pause after checking the real SMS evidence.
create function public.icash_prepare_buyer_outreach(p_account uuid,p_deal uuid) returns integer
language plpgsql security invoker set search_path='' as $$
declare t public.icash_text_threads;n integer:=0;
begin
 perform 1 from public.icash_operating_budget budget where budget.id=1 for update;
 if not public.icash_buyer_outreach_running(p_account,p_deal) or not public.icash_outreach_sms_current(p_account) then return 0;end if;
 for t in select th.* from public.icash_text_threads th
 where th.account_id=p_account and th.deal_id=p_deal and th.party='buyer'
 and th.sms_intake_pending and th.paused and th.sms_review_request_id is not null
 and th.retired_at is null and not th.manual_only and th.ai_mode='auto'
 and not exists(select 1 from public.icash_text_messages m where m.thread_id=th.id)
 order by th.recipient,th.id limit 50
 loop
  perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
  perform 1 from public.icash_accounts where id=p_account and not bot_paused for share;
  if not found or not public.icash_buyer_outreach_running(p_account,p_deal) then return n;end if;
  perform 1 from public.icash_text_threads where id=t.id and sms_intake_pending and paused
   and retired_at is null and not manual_only and ai_mode='auto' for update;
  if found and public.icash_sms_thread_review_current(p_account,t.id,false) then
   update public.icash_text_threads set paused=false,sms_intake_pending=false where id=t.id;
   n:=n+1;
  end if;
 end loop;
 return n;
end $$;

-- Filter eligibility BEFORE the batch limit. Five stale/opted-out contacts
-- must not permanently hide the sixth contact that is actually eligible.
create or replace function public.icash_buyer_package_text_targets(p_account uuid,p_deal uuid) returns table(id uuid)
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget budget where budget.id=1 for update;
 if not public.icash_buyer_outreach_running(p_account,p_deal) or not public.icash_outreach_sms_current(p_account) then return;end if;
 return query select t.id from public.icash_text_threads t
 join public.icash_buyer_package_links l on l.account_id=t.account_id and l.deal_id=t.deal_id and l.revoked_at is null
 where t.account_id=p_account and t.deal_id=p_deal and t.party='buyer'
 and not t.paused and not t.manual_only and t.ai_mode='auto' and t.retired_at is null
 and public.icash_sms_thread_review_current(p_account,t.id,true)
 and not exists(select 1 from public.icash_buyer_package_texts sent join public.icash_text_messages m on m.id=sent.message_id
  where sent.link_id=l.id and sent.thread_id=t.id and m.state<>'ready')
 order by t.id limit 5;
end $$;

-- Preserve the previously deployed deterministic request keys. Accepted,
-- dispatching and uncertain sends never become new requests on a retry.
create function public.icash_buyer_package_email_key(p_account uuid,p_deal uuid,p_purchase uuid,p_email text) returns uuid
language sql immutable security invoker set search_path='' as $$
 select (substr(h,1,8)||'-'||substr(h,9,4)||'-5'||substr(h,14,3)||'-a'||substr(h,18,3)||'-'||substr(h,21,12))::uuid
 from (select encode(sha256(convert_to(p_account::text||':'||p_deal::text||':'||p_purchase::text||':'||lower(p_email),'UTF8')),'hex') h) hash;
$$;

create function public.icash_buyer_package_email_targets(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,request_key uuid,message_id uuid)
language sql stable security invoker set search_path='' as $$
 with contacts as (
  select distinct on (lower(c.email)) c.contact_key,lower(c.email) email
  from public.icash_deal_email_contacts(p_account,p_deal) c
  where c.party='buyer' and c.contact_key like 'buyer-request:%' and c.verified_until>now()
  and not exists(select 1 from public.icash_email_suppressions s where s.account_id=p_account and s.email=lower(c.email))
  order by lower(c.email),c.contact_key
 ), keyed as (
  select c.*,public.icash_buyer_package_email_key(p_account,p_deal,a.purchase_envelope_id,c.email) request_key
  from contacts c join public.icash_disposition_authorities a on a.account_id=p_account and a.deal_id=p_deal
 )
 select k.contact_key,k.email,k.request_key,m.id
 from keyed k left join public.icash_deal_emails m on m.account_id=p_account and m.request_key=k.request_key
 where public.icash_buyer_outreach_running(p_account,p_deal)
 and (m.id is null or (m.state='ready' and m.subject=public.icash_buyer_outreach_content(p_account,p_deal)->>'subject'
  and m.body_text=public.icash_buyer_outreach_content(p_account,p_deal)->>'email'))
 order by m.created_at nulls last,k.email limit 3;
$$;

-- Diagnostics use real contact checks and delivery records, not a count of
-- purchased prospects or a pre-seeded qualified-buyer fixture. No provider IO.
create function public.icash_buyer_outreach_status(p_account uuid,p_deal uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;prospects integer;eligible integer:=0;ready_now integer:=0;pending integer:=0;sent_texts integer;sent_emails integer;requested integer;blocking text[]:='{}';t public.icash_text_threads;
begin
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account;
 if not found then return null;end if;
 perform 1 from public.icash_operating_budget budget where budget.id=1 for update;
 if public.icash_buyer_outreach_held(p_account,p_deal) then blocking:=array_append(blocking,'owner_hold');end if;
 if exists(select 1 from public.icash_accounts where id=p_account and bot_paused) then blocking:=array_append(blocking,'account_paused');end if;
 if not public.icash_membership_work_allowed(p_account) then blocking:=array_append(blocking,'membership_required');end if;
 if not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>0) then blocking:=array_append(blocking,'credits_required');end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where pc.account_id=p_account and pc.manual) then blocking:=array_append(blocking,'property_paused');end if;
 if public.icash_buyer_is_reserved(p_account,p_deal) then blocking:=array_append(blocking,'buyer_reserved');end if;
 if public.icash_buyer_package_data(p_account,p_deal) is null then blocking:=array_append(blocking,'signed_package_required');end if;
 if not public.icash_outreach_sms_current(p_account) then blocking:=array_append(blocking,'sms_disabled');end if;
 select count(*) into prospects from public.icash_buyer_candidates c join public.icash_buyer_profiles b on b.id=c.buyer_id and b.account_id=p_account where c.deal_id=p_deal and c.rights_until>now();
 for t in select * from public.icash_text_threads where account_id=p_account and deal_id=p_deal and party='buyer' and retired_at is null loop
  if t.sms_intake_pending then pending:=pending+1;end if;
  if not t.manual_only and t.ai_mode='auto' and (not t.paused or t.sms_intake_pending)
   and public.icash_sms_thread_review_current(p_account,t.id,false) then
   eligible:=eligible+1;
   if public.icash_sms_thread_review_current(p_account,t.id,true) then ready_now:=ready_now+1;end if;
  end if;
 end loop;
 select count(distinct lower(c.email)) into requested from public.icash_deal_email_contacts(p_account,p_deal) c where c.party='buyer' and c.contact_key like 'buyer-request:%' and c.verified_until>now();
 select count(*) into sent_texts from public.icash_buyer_package_texts p join public.icash_text_messages m on m.id=p.message_id where m.account_id=p_account and m.state in ('accepted','delivered') and m.provider_id is not null and exists(select 1 from public.icash_text_threads th where th.id=p.thread_id and th.deal_id=p_deal);
 select count(*) into sent_emails from public.icash_deal_emails where account_id=p_account and deal_id=p_deal and direction='outgoing' and state='accepted' and provider_id is not null and (contact_key like 'buyer-request:%' or contact_key like 'network:%');
 if eligible=0 and requested=0 and sent_texts+sent_emails=0 then blocking:=array_append(blocking,'no_direct_buyer_contacts');end if;
 return jsonb_build_object('automatic',true,'candidates',prospects,'smsContacts',eligible,'smsReadyNow',ready_now,'intakePending',pending,'requestedEmails',requested,'textsAccepted',sent_texts,'emailsAccepted',sent_emails,'blockers',to_jsonb(blocking));
end $$;

-- New buyer requests and initial SMS releases should not wait for tomorrow's
-- document refresh. Never reset a held job or retry an uncertain provider send.
alter function public.icash_queue_fulfillment() rename to icash_queue_fulfillment_before_automatic_buyers;
create function public.icash_queue_fulfillment() returns void
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget budget where budget.id=1 for update;
 perform public.icash_queue_fulfillment_before_automatic_buyers();
 update public.icash_fulfillment_jobs j set state='ready',updated_at=now()
 where j.state='complete' and j.updated_at<now()-interval '5 minutes'
 and public.icash_buyer_outreach_running(j.account_id,j.deal_id)
 and (exists(select 1 from public.icash_buyer_package_email_targets(j.account_id,j.deal_id))
  or (public.icash_outreach_sms_current(j.account_id) and exists(select 1 from public.icash_text_threads t
   where t.account_id=j.account_id and t.deal_id=j.deal_id and t.party='buyer'
   and t.retired_at is null and not t.manual_only and t.ai_mode='auto' and (not t.paused or t.sms_intake_pending)
   and public.icash_sms_thread_review_current(j.account_id,t.id,true)
   and not exists(select 1 from public.icash_buyer_package_texts p join public.icash_text_messages m on m.id=p.message_id where p.thread_id=t.id and m.state<>'ready'))));
end $$;

revoke all on function public.icash_buyer_outreach_running(uuid,uuid),public.icash_prepare_buyer_outreach(uuid,uuid),public.icash_buyer_package_text_targets(uuid,uuid),public.icash_buyer_package_email_key(uuid,uuid,uuid,text),public.icash_buyer_package_email_targets(uuid,uuid),public.icash_buyer_outreach_status(uuid,uuid),public.icash_queue_fulfillment(),public.icash_queue_fulfillment_before_automatic_buyers() from public,anon,authenticated;
grant execute on function public.icash_buyer_outreach_running(uuid,uuid),public.icash_prepare_buyer_outreach(uuid,uuid),public.icash_buyer_package_text_targets(uuid,uuid),public.icash_buyer_package_email_key(uuid,uuid,uuid,text),public.icash_buyer_package_email_targets(uuid,uuid),public.icash_buyer_outreach_status(uuid,uuid),public.icash_queue_fulfillment(),public.icash_queue_fulfillment_before_automatic_buyers() to service_role;
commit;
