-- Explicit, short-lived delivery tests to the verified account owner's own
-- contact details. This is not buyer consent, a DNC receipt, or a campaign release.
begin;
create table public.icash_owner_buyer_tests (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 owner_user_id uuid not null references auth.users(id),
 thread_id uuid not null unique references public.icash_text_threads(id) deferrable initially deferred,
 sender text not null references public.icash_text_senders(phone),
 phone text not null check(phone ~ '^[+][1-9][0-9]{7,14}$'),
 email text not null check(email=lower(email) and length(email) between 3 and 320),
 sms_rate_id uuid not null references public.icash_operation_rates(id),
 email_rate_id uuid not null references public.icash_operation_rates(id),
 asking_price_cents bigint not null check(asking_price_cents>0),
 approval_reference text not null check(length(trim(approval_reference)) between 10 and 500),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '4 hours'),
 revoked_at timestamptz,
 unique(account_id,deal_id)
);
alter table public.icash_owner_buyer_tests enable row level security;
revoke all on public.icash_owner_buyer_tests from public,anon,authenticated,service_role;
grant select on public.icash_owner_buyer_tests to service_role;

create function public.icash_owner_buyer_test_current(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.icash_owner_buyer_tests x
  join public.icash_accounts a on a.id=x.account_id and a.owner_user_id=x.owner_user_id and not a.bot_paused
  join auth.users u on u.id=a.owner_user_id and lower(u.email)=x.email and u.email_confirmed_at is not null
  join public.icash_owner_voice_acceptance_config v on v.account_id=a.id and v.owner_user_id=a.owner_user_id and v.phone=x.phone
  join public.icash_text_senders s on s.phone=x.sender and s.enabled
  join public.icash_operation_rates r on r.id=x.sms_rate_id and r.operation='sms_send' and r.enabled and r.verified_at<=now() and r.expires_at>now()
  join public.icash_deal_files d on d.id=x.deal_id and d.account_id=x.account_id
  join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
  where x.id=p_id and x.created_at<=now() and x.expires_at>now() and x.revoked_at is null
  and public.icash_buyer_outreach_held(x.account_id,x.deal_id)
  and (public.icash_buyer_package_data(x.account_id,x.deal_id)->>'askingPriceCents')::bigint=x.asking_price_cents
  and not exists(select 1 from public.icash_text_suppressions where phone=x.phone)
  and not exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(x.phone,'UTF8')),'hex'))
  and not exists(select 1 from public.icash_property_controls where account_id=x.account_id and property_id=sc.snapshot->>'propertyId' and manual)
 )
$$;

alter function public.icash_sms_thread_review_current(uuid,uuid,boolean) rename to icash_sms_review_before_owner_buyer_test;
create function public.icash_sms_thread_review_current(p_account uuid,p_thread uuid,p_check_hour boolean default true) returns boolean
language plpgsql security invoker set search_path='' as $$
declare x public.icash_owner_buyer_tests;
begin
 select * into x from public.icash_owner_buyer_tests where thread_id=p_thread;
 if found then
  return x.account_id=p_account and public.icash_owner_buyer_test_current(x.id) and exists(
   select 1 from public.icash_text_threads t where t.id=x.thread_id and t.account_id=x.account_id and t.deal_id=x.deal_id
   and t.sender=x.sender and t.recipient=x.phone and t.party='buyer' and t.sms_rate_id=x.sms_rate_id
   and t.sender_pool_assigned and t.retired_at is null and not t.paused and not t.manual_only and t.ai_mode='auto'
   and t.seller_intake_id is null and t.operational_contact_id is null and t.sms_review_request_id is null);
 end if;
 return public.icash_sms_review_before_owner_buyer_test(p_account,p_thread,p_check_hour);
end $$;

alter function public.icash_queue_buyer_package_text(uuid,uuid,text) rename to icash_queue_buyer_package_before_owner_test;
create function public.icash_queue_buyer_package_text(p_account uuid,p_thread uuid,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_owner_buyer_tests where thread_id=p_thread) then
  if not public.icash_sms_thread_review_current(p_account,p_thread,true) then return null;end if;
  return public.icash_queue_buyer_package_text_before_hold(p_account,p_thread,p_body);
 end if;
 return public.icash_queue_buyer_package_before_owner_test(p_account,p_thread,p_body);
end $$;

-- Only the canonical package or a factual response bound to an actual received
-- message may use this authorization. All other buyer send claims retain the hold.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_owner_buyer_test;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare x public.icash_owner_buyer_tests;m public.icash_text_messages;t public.icash_text_threads;
 j public.icash_text_ai_jobs;incoming public.icash_text_messages;expected text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select test.* into x from public.icash_owner_buyer_tests test join public.icash_text_messages msg on msg.thread_id=test.thread_id
 where msg.id=p_message;
 if not found then return public.icash_claim_text_before_owner_buyer_test(p_account,p_message,p_sender);end if;
 if x.account_id is distinct from p_account or x.sender is distinct from p_sender then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(x.phone,74));
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account for update;
 select * into t from public.icash_text_threads where id=x.thread_id and account_id=p_account for update;
 if m.id is null or t.id is null or m.state<>'ready' or m.direction<>'outgoing' or cardinality(m.asset_ids)<>0 or m.attachments<>'[]'::jsonb
 or not public.icash_sms_thread_review_current(p_account,t.id,false) or not public.icash_sms_message_route_current(p_account,m.id) then return null;end if;
 select 'Under contract. Buyer price $'||to_char(x.asking_price_cents::numeric/100,'FM999,999,999,990.00')||' + closing costs. Deal package: https://www.geticashx.com/d/'||l.token into expected
 from public.icash_buyer_package_texts p join public.icash_buyer_package_links l on l.id=p.link_id
 where p.message_id=m.id and p.thread_id=t.id and l.account_id=p_account and l.deal_id=x.deal_id and l.revoked_at is null
 and l.asking_price_cents=x.asking_price_cents;
 if expected is null then
  select * into j from public.icash_text_ai_jobs where account_id=p_account and thread_id=t.id and outgoing_id=m.id
  and state='queued' and analysis->>'action'='buyer_factual' and analysis->>'factualPolicy'='approved-package-v1';
  if not found then return null;end if;
  select * into incoming from public.icash_text_messages where id=j.message_id and account_id=p_account and thread_id=t.id
  and direction='incoming' and state='received' and event_id is not null and created_at>=x.created_at;
  if not found or exists(select 1 from public.icash_text_messages other where other.thread_id=t.id
   and other.id not in(incoming.id,m.id) and other.created_at>=incoming.created_at) then return null;end if;
  expected:=public.icash_buyer_factual_text(p_account,t.id,incoming.body);
 end if;
 if expected is null or m.body is distinct from expected then return null;end if;
 perform public.icash_reserve_operation(p_account,'text:'||m.id,t.sms_rate_id,x.expires_at);
 if not public.icash_claim_operation('text:'||m.id) then return null;end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=m.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',m.body,'attachments',m.attachments);
end $$;

alter function public.icash_deal_email_contacts(uuid,uuid) rename to icash_email_contacts_before_owner_buyer_test;
create function public.icash_deal_email_contacts(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz)
language sql stable security invoker set search_path='' as $$
 select * from public.icash_email_contacts_before_owner_buyer_test(p_account,p_deal)
 union all
 select 'owner-buyer-test:'||x.id,x.email,'Account owner delivery test','buyer',x.expires_at
 from public.icash_owner_buyer_tests x where x.account_id=p_account and x.deal_id=p_deal and public.icash_owner_buyer_test_current(x.id)
$$;

-- Compose both channels from the current signed package. The email request key
-- is the test ID, so repeated deployment/test attempts cannot make duplicates.
create function public.icash_owner_buyer_test_content(p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('sms',
  'Under contract. Buyer price $'||to_char(x.asking_price_cents::numeric/100,'FM999,999,999,990.00')||' + closing costs. Deal package: https://www.geticashx.com/d/'||l.token,
  'subject','Buyer package: '||(p.data->>'address'),
  'email','Here is the buyer package you requested.'||chr(10)||chr(10)||
  'Property: '||(p.data->>'address')||chr(10)||
  'Buyer price: $'||to_char(x.asking_price_cents::numeric/100,'FM999,999,999,990.00')||' plus closing costs.'||chr(10)||
  'Includes the $'||to_char((p.data->>'assignmentFeeCents')::numeric/100,'FM999,999,999,990.00')||' assignment fee.'||chr(10)||
  'Closing date: '||coalesce(p.data->>'closingDate','To be confirmed')||chr(10)||chr(10)||
  'Deal package: https://www.geticashx.com/d/'||l.token||chr(10)||chr(10)||
  'Contract interest offered for assignment. Buyer pays closing costs allocated to Buyer in the signed agreements.'||chr(10)||
  'Reply with questions or your preferred showing time. Access must be confirmed before visiting.')
 from public.icash_owner_buyer_tests x
 join public.icash_buyer_package_links l on l.account_id=x.account_id and l.deal_id=x.deal_id and l.revoked_at is null and l.asking_price_cents=x.asking_price_cents
 cross join lateral(select public.icash_buyer_package_data(x.account_id,x.deal_id) data) p
 where x.id=p_id and public.icash_owner_buyer_test_current(x.id)
$$;

alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_email_before_owner_buyer_test;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_deal_emails;x public.icash_owner_buyer_tests;content jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_deal_emails where id=p_id and account_id=p_account;
 if m.contact_key like 'owner-buyer-test:%' then
  select * into x from public.icash_owner_buyer_tests where 'owner-buyer-test:'||id=m.contact_key and account_id=p_account and deal_id=m.deal_id;
  if not found or not public.icash_owner_buyer_test_current(x.id) then return null;end if;
  content:=public.icash_owner_buyer_test_content(x.id);
  if content is null or row(m.recipient,m.request_key,m.rate_id,m.authored_by,m.subject,m.body_text)
   is distinct from row(x.email,x.id,x.email_rate_id,x.owner_user_id,content->>'subject',content->>'email') then return null;end if;
 end if;
 return public.icash_claim_email_before_owner_buyer_test(p_account,p_id);
end $$;

revoke all on function public.icash_owner_buyer_test_current(uuid),public.icash_owner_buyer_test_content(uuid),
 public.icash_sms_thread_review_current(uuid,uuid,boolean),public.icash_queue_buyer_package_text(uuid,uuid,text),
 public.icash_claim_text(uuid,uuid,text),public.icash_deal_email_contacts(uuid,uuid),public.icash_claim_deal_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_owner_buyer_test_current(uuid),public.icash_owner_buyer_test_content(uuid),
 public.icash_sms_thread_review_current(uuid,uuid,boolean),public.icash_queue_buyer_package_text(uuid,uuid,text),
 public.icash_claim_text(uuid,uuid,text),public.icash_deal_email_contacts(uuid,uuid),public.icash_claim_deal_email(uuid,uuid) to service_role;

-- Buyer replies were intercepted by the seller acquisition campaign and returned
-- before an AI job could be created. Keep that branch exclusively on sellers.
do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_enqueue_text_ai()'::regprocedure);
 needle:='if public.icash_outreach_sms_current(new.account_id) then perform public.icash_prepare_sms_inbound_reply';
 if position(needle in definition)=0 then needle:='if public.icash_sms_inbound_campaign_current(new.account_id) then perform public.icash_prepare_sms_inbound_reply';end if;
 if position(needle in definition)=0 then raise exception 'Incoming SMS campaign prerequisite changed';end if;
 definition:=replace(definition,needle,replace(needle,' then perform',' and exists(select 1 from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and party=''seller'') then perform'));
 needle:=$old$ if new.direction<>'incoming' or new.account_id is null or new.thread_id is null then return new;end if;$old$;
 if position(needle in definition)=0 then raise exception 'Incoming SMS entry prerequisite changed';end if;
 definition:=replace(definition,needle,needle||$new$
 if exists(select 1 from public.icash_owner_buyer_tests where thread_id=new.thread_id)
 and not public.icash_sms_thread_review_current(new.account_id,new.thread_id,false) then return new;end if;$new$);
 execute definition;
end $patch$;
commit;
