-- Role-bound texting, customer lifecycle enrollment, and factual low-credit updates.
alter table public.icash_webinar_text_senders add column preferred boolean not null default false;
create unique index icash_webinar_text_preferred on public.icash_webinar_text_senders(preferred) where preferred;
create function public.icash_webinar_prefer_sender(p_phone text) returns void language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(818,1);
 if not exists(select 1 from public.icash_webinar_text_senders where phone=p_phone and enabled and verified_at>now()-interval '2 minutes') then raise exception 'Verify an active SMS number first';end if;
 update public.icash_webinar_text_senders set preferred=false where preferred;
 update public.icash_webinar_text_senders set preferred=true where phone=p_phone;
 -- The selected number is also available for separately routed property threads.
 insert into public.icash_text_senders(phone,enabled) values(p_phone,true) on conflict(phone) do update set enabled=true;
end $$;
alter table public.icash_customer_update_preferences add column source_webinar_visitor uuid references public.icash_webinar_visitors(id);
create index icash_customer_update_source_visitor on public.icash_customer_update_preferences(source_webinar_visitor);
alter table public.icash_customer_update_deliveries alter column screening_id drop not null;
alter table public.icash_customer_update_deliveries add column sender text;
-- Historical delivery identity can be recovered only where there was one sender.
update public.icash_customer_update_deliveries set sender=(select min(phone) from public.icash_text_senders where enabled) where channel='sms' and sender is null and (select count(*) from public.icash_text_senders where enabled)=1;
create function public.icash_customer_update_consent_valid(p_version text) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(p_version in ('bot-updates-2026-10-03.1','bot-updates-2026-10-08.1','webinar-lifecycle-2026-10-08'),false);
$$;
do $$ declare c record;body text;sig text;begin
 for c in select conname from pg_constraint where conrelid='public.icash_customer_update_preferences'::regclass and contype='c' and pg_get_constraintdef(oid) like '%consent_version%' loop
 execute format('alter table public.icash_customer_update_preferences drop constraint %I',c.conname);end loop;
 alter table public.icash_customer_update_preferences add constraint icash_customer_update_consent_check check(not(email_enabled or sms_enabled) or (public.icash_customer_update_consent_valid(consent_version) and consented_at is not null));
 foreach sig in array array['public.icash_customer_update_preferences_save(uuid,uuid,boolean,boolean,text,text,text)','public.icash_claim_customer_update(uuid,boolean,boolean)'] loop
 select pg_get_functiondef(sig::regprocedure) into strict body;
 body:=replace(body,'p_consent is distinct from ''bot-updates-2026-10-03.1''' ,'not public.icash_customer_update_consent_valid(p_consent)');
 body:=replace(body,'p.consent_version is distinct from ''bot-updates-2026-10-03.1''' ,'not public.icash_customer_update_consent_valid(p.consent_version)');
 execute body;
 end loop;
end $$;
-- No backfill of people who agreed only to the former short campaign.
create function public.icash_webinar_activate_customers() returns integer language plpgsql security invoker set search_path='' as $$
declare r record;v public.icash_webinar_visitors;pref public.icash_customer_update_preferences;email_ok boolean;sms_ok boolean;total integer:=0;
begin
 if not exists(select 1 from public.icash_customer_update_settings where id=1 and enabled) then return 0;end if;
 for r in select distinct a.id account_id,a.owner_user_id,lower(u.email) email,a.contact_phone,m.payer_phone,m.guest_hash
 from public.icash_memberships m join public.icash_accounts a on a.id=m.account_id join auth.users u on u.id=a.owner_user_id
 where m.mode='live' and m.state='active' and m.paid_through>now() and u.email_confirmed_at is not null
 and exists(select 1 from public.icash_webinar_visitors w where (lower(w.email)=lower(u.email) or w.account_id=a.id or w.funding_guest_hash=m.guest_hash) and (w.consent_version='webinar-email-campaign-2026-10-08' or w.sms_consent_version='webinar-sms-campaign-2026-10-08'))
 and not exists(select 1 from public.icash_customer_update_preferences p where p.account_id=a.id and p.consented_at is not null)
 limit 100 loop
 perform pg_advisory_xact_lock(hashtextextended(r.account_id::text,819));
 select * into pref from public.icash_customer_update_preferences where account_id=r.account_id for update;
 if pref.consented_at is not null then continue;end if;
 select * into v from public.icash_webinar_visitors w where (lower(w.email)=r.email or w.account_id=r.account_id or w.funding_guest_hash=r.guest_hash) and (w.consent_version='webinar-email-campaign-2026-10-08' or w.sms_consent_version='webinar-sms-campaign-2026-10-08') order by w.last_seen_at desc limit 1;
 email_ok:=lower(v.email)=r.email and v.consent_version='webinar-email-campaign-2026-10-08' and v.email_consent_at is not null and v.opted_out_at is null and pref.email_suppressed_at is null and not exists(select 1 from public.icash_webinar_suppressions s where s.email=r.email);
 sms_ok:=v.sms_consent_version='webinar-sms-campaign-2026-10-08' and v.sms_consent_at is not null and v.sms_opted_out_at is null and v.phone is not null and v.phone in (r.contact_phone,r.payer_phone)
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=v.phone) and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=v.phone);
 if not coalesce(email_ok,false) and not coalesce(sms_ok,false) then continue;end if;
 perform public.icash_customer_update_preferences_save(r.account_id,r.owner_user_id,coalesce(email_ok,false),coalesce(sms_ok,false),v.phone,v.timezone,'webinar-lifecycle-2026-10-08');
 update public.icash_customer_update_preferences set source_webinar_visitor=v.id where account_id=r.account_id;
 update public.icash_webinar_outbox set state='canceled' where state in ('pending','claimed') and (visitor_id=v.id or channel='email' and recipient=r.email or channel='sms' and recipient=v.phone);
 total:=total+1;
 end loop;
 return total;
end $$;
create function public.icash_customer_credit_low(p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$
 with history as (select price_cents from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at>now()-interval '30 days' and not coalesce(auto_recharge,false) and price_cents between 1000 and 100000 order by credited_at desc limit 5),
 typical as (select coalesce(percentile_disc(.5) within group(order by price_cents),1000) amount from history)
 select coalesce((select w.balance_cents-w.reserved_cents<greatest(500,ceil(t.amount*.2)) from public.icash_wallets w cross join typical t where w.account_id=p_account),false)
 and exists(select 1 from public.icash_memberships m where m.account_id=p_account and m.mode='live' and m.state='active' and m.paid_through>now())
 and not exists(select 1 from public.icash_auto_recharges a where a.account_id=p_account and a.mode='live' and (a.enabled or a.pending_order is not null));
$$;
alter function public.icash_customer_update_sources(uuid) rename to icash_customer_update_sources_before_credit_reminders;
create function public.icash_customer_update_sources(p_account uuid)
returns table(source_key text,kind text,screening_id uuid,event_at timestamptz,priority integer)
language sql stable security invoker set search_path='' as $$
 select * from public.icash_customer_update_sources_before_credit_reminders(p_account)
 union all
 select 'credits-low:'||to_char(now() at time zone 'UTC','YYYY-MM-DD'),'credits_low',null::uuid,greatest(date_trunc('day',now()),p.consented_at),3
 from public.icash_customer_update_preferences p where p.account_id=p_account and p.consent_version in ('bot-updates-2026-10-08.1','webinar-lifecycle-2026-10-08') and public.icash_customer_credit_low(p_account);
$$;
-- Both phases share the advertised per-contact limit, including uncertain sends.
create function public.icash_lifecycle_frequency_ok(p_channel text,p_recipient text,p_update uuid default null,p_followup uuid default null) returns boolean language sql stable security invoker set search_path='' as $$
 select count(*)<case when p_channel='sms' then 1 else 2 end and not coalesce(bool_or(at>now()-interval '1 hour'),false) from (
 select authorized_at at from public.icash_customer_update_deliveries where channel=p_channel and recipient=p_recipient and id is distinct from p_update and authorized_at>now()-interval '24 hours'
 union all select coalesce(sent_at,first_attempt_at) from public.icash_webinar_outbox where channel=p_channel and recipient=p_recipient and id is distinct from p_followup and (sent_at>now()-interval '24 hours' or state in ('sending','unknown') and first_attempt_at>now()-interval '24 hours')
 ) deliveries;
$$;
-- Tighten channel frequency for new lifecycle subscribers and dedupe low-credit reminders.
do $$ declare body text;begin
 select pg_get_functiondef('public.icash_claim_customer_update(uuid,boolean,boolean)'::regprocedure) into strict body;
 body:=replace(body,'if chosen=''sms'' and not(p_sms_ready and p.sms_enabled and p.phone is not null) then continue;end if;','if chosen=''sms'' and (not(p_sms_ready and p.sms_enabled and p.phone is not null) or exists(select 1 from public.icash_text_suppressions where phone=p.phone) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=p.phone) or public.icash_webinar_campaign_sender(p.phone) is null) then continue;end if;');
 body:=replace(body,'created_at>now()-interval ''24 hours'')>=3','created_at>now()-interval ''24 hours'')>=(case when chosen=''sms'' then 1 else 2 end)');
 body:=replace(body,'select * into s from public.icash_customer_update_sources', 'if not public.icash_lifecycle_frequency_ok(chosen,case when chosen=''email'' then email_address else p.phone end) then continue;end if;select * into s from public.icash_customer_update_sources');
 body:=replace(body,'and (x.kind<>''research_complete''', 'and (x.kind<>''credits_low'' or not exists(select 1 from public.icash_customer_update_deliveries n where n.account_id=p_account and n.channel=chosen and n.kind=''credits_low'' and n.created_at>now()-interval ''24 hours'')) and (x.kind<>''research_complete''');
 execute body;
 select pg_get_functiondef('public.icash_authorize_customer_update(uuid,uuid)'::regprocedure) into strict body;
 body:=replace(body,'s.screening_id=n.screening_id','s.screening_id is not distinct from n.screening_id');
 body:=replace(body,'declare p public.icash_customer_update_preferences;', 'declare sender_phone text;p public.icash_customer_update_preferences;');
 body:=replace(body,'update public.icash_customer_update_deliveries set authorized_at=now() where id=n.id;',
 'perform pg_advisory_xact_lock(hashtextextended((case when n.channel=''email'' then ''email:'' else ''phone:'' end)||n.recipient,815));if not public.icash_lifecycle_frequency_ok(n.channel,n.recipient,n.id) or n.channel=''sms'' and extract(hour from now() at time zone p.timezone) not between 9 and 19 then update public.icash_customer_update_deliveries set state=''canceled'' where id=n.id;return null;end if;if n.channel=''sms'' then sender_phone:=public.icash_webinar_campaign_sender(n.recipient);if sender_phone is null or exists(select 1 from public.icash_text_suppressions where phone=n.recipient) or exists(select 1 from public.icash_webinar_phone_suppressions where phone=n.recipient) then update public.icash_customer_update_deliveries set state=''canceled'' where id=n.id;return null;end if;end if;update public.icash_customer_update_deliveries set authorized_at=now(),sender=sender_phone where id=n.id;');
 body:=replace(body,'''unsubscribeToken'',p.unsubscribe_token)','''unsubscribeToken'',p.unsubscribe_token,''sender'',sender_phone)');
 execute body;
end $$;
create table public.icash_lifecycle_text_inbox(
 event_id text primary key,role text not null check(role in ('customer','prospect','ambiguous','unknown')),
 sender text not null,recipient text not null,body text not null,attachments jsonb not null default '[]',
 state text not null default 'open' check(state in ('open','closed')),created_at timestamptz not null default now()
);
alter table public.icash_lifecycle_text_inbox enable row level security;
revoke all on public.icash_lifecycle_text_inbox from public,anon,authenticated;
grant select,insert,update on public.icash_lifecycle_text_inbox to service_role;
create index icash_lifecycle_text_inbox_open on public.icash_lifecycle_text_inbox(created_at desc) where state='open';
create function public.icash_text_role_conflict(p_sender text,p_recipient text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_webinar_text_assignments where sender=p_sender and recipient=p_recipient) or exists(select 1 from public.icash_customer_update_deliveries where sender=p_sender and recipient=p_recipient and channel='sms' and authorized_at is not null) or exists(select 1 from public.icash_webinar_outbox where channel='sms' and recipient=p_recipient and payload->>'from'=p_sender and first_attempt_at is not null);
$$;
-- Never assign a lead/customer a sender already used for their property conversation.
create or replace function public.icash_webinar_campaign_sender(p_recipient text) returns text language plpgsql security invoker set search_path='' as $$
declare chosen text;
begin
 if p_recipient!~'^\+[1-9][0-9]{7,14}$' then return null;end if;
 perform pg_advisory_xact_lock(818,1);
 select a.sender into chosen from public.icash_webinar_text_assignments a where a.recipient=p_recipient;
 if chosen is not null then
 return case when exists(select 1 from public.icash_webinar_text_senders where phone=chosen and enabled) and not exists(select 1 from public.icash_text_threads where sender=chosen and recipient=p_recipient and retired_at is null) then chosen else null end;
 end if;
 select s.phone into chosen from public.icash_webinar_text_senders s left join public.icash_webinar_text_assignments a on a.sender=s.phone where s.enabled and not exists(select 1 from public.icash_text_threads t where t.sender=s.phone and t.recipient=p_recipient and t.retired_at is null) group by s.phone order by s.preferred desc,count(a.recipient),s.phone limit 1;
 if chosen is not null then insert into public.icash_webinar_text_assignments(recipient,sender) values(p_recipient,chosen);end if;
 return chosen;
end $$;
-- Recheck the same conversation role inside the atomic property send grant.
do $$ declare body text;needle text;begin
 select pg_get_functiondef('public.icash_sms_message_route_current(uuid,uuid)'::regprocedure) into strict body;
 needle:='if t.id is null or t.retired_at is not null then return false;end if;';
 if position(needle in body)=0 then raise exception 'Property routing prerequisite changed';end if;
 body:=replace(body,needle,needle||'perform pg_advisory_xact_lock(818,1);if public.icash_text_role_conflict(t.sender,t.recipient) then update public.icash_text_messages set state=''needs_review'',updated_at=now() where id=m.id and state=''ready'';return false;end if;');
 execute body;
 select pg_get_functiondef('public.icash_webinar_authorize_followup(uuid,jsonb)'::regprocedure) into strict body;
 needle:='candidate:=coalesce(f.payload,p_payload);';
 if position(needle in body)=0 then raise exception 'Campaign authorization prerequisite changed';end if;
 body:=replace(body,needle,'if not public.icash_lifecycle_frequency_ok(f.channel,f.recipient,null,f.id) then update public.icash_webinar_outbox set state=''pending'',due_at=now()+interval ''1 hour'',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;'||needle);
 needle:='update public.icash_webinar_outbox set state=''sending'',payload=candidate';
 if position(needle in body)=0 then raise exception 'Campaign send prerequisite changed';end if;
 body:=replace(body,needle,'if f.channel=''sms'' then perform pg_advisory_xact_lock(818,1);if exists(select 1 from public.icash_text_threads where sender=candidate->>''from'' and recipient=f.recipient and retired_at is null) then update public.icash_webinar_outbox set state=''pending'',due_at=now()+interval ''1 hour'',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;end if;'||needle);
 execute body;
end $$;
create function public.icash_route_lifecycle_text(p_event jsonb,p_optout boolean) returns text language plpgsql security invoker set search_path='' as $$
declare data jsonb:=p_event->'data';property_role boolean;customer_role boolean;prospect_role boolean;role_name text;
begin
 if p_event->>'type' not in ('text.incoming.sms','text.incoming.mms') then raise exception 'Incoming text required';end if;
 if p_optout then
 insert into public.icash_text_suppressions(phone,reason) values(data->>'from','Incoming opt-out') on conflict do nothing;
 perform public.icash_webinar_text_reply(data->>'from',true);perform public.icash_stop_customer_update_phone(data->>'from');
 update public.icash_text_messages m set state='cancelled',updated_at=now() from public.icash_text_threads t where m.thread_id=t.id and t.recipient=data->>'from' and m.direction='outgoing' and m.state='ready';
 end if;
 property_role:=exists(select 1 from public.icash_text_threads where sender=data->>'to' and recipient=data->>'from' and retired_at is null);
 customer_role:=exists(select 1 from public.icash_customer_update_deliveries where channel='sms' and sender=data->>'to' and recipient=data->>'from' and authorized_at is not null)
 or exists(select 1 from public.icash_webinar_text_assignments a join public.icash_customer_update_preferences p on p.phone=a.recipient where a.sender=data->>'to' and a.recipient=data->>'from');
 prospect_role:=exists(select 1 from public.icash_webinar_text_assignments a where a.sender=data->>'to' and a.recipient=data->>'from') or exists(select 1 from public.icash_webinar_outbox f where f.channel='sms' and f.recipient=data->>'from' and f.payload->>'from'=data->>'to' and f.first_attempt_at is not null);
 role_name:=case when property_role and (customer_role or prospect_role) then 'ambiguous' when property_role then 'property' when customer_role then 'customer' when prospect_role then 'prospect' else 'unknown' end;
 if role_name<>'property' then
 insert into public.icash_lifecycle_text_inbox(event_id,role,sender,recipient,body,attachments,state)
 values(p_event->>'id',role_name,data->>'from',data->>'to',coalesce(data->>'body',''),coalesce(data->'attachments','[]'::jsonb),case when p_optout then 'closed' else 'open' end) on conflict do nothing;
 perform public.icash_webinar_text_reply(data->>'from',p_optout);
 end if;
 return role_name;
end $$;
do $$ declare signature text;begin
 foreach signature in array array['icash_lifecycle_frequency_ok(text,text,uuid,uuid)','icash_webinar_prefer_sender(text)','icash_customer_update_consent_valid(text)','icash_webinar_activate_customers()','icash_customer_credit_low(uuid)','icash_customer_update_sources(uuid)','icash_customer_update_sources_before_credit_reminders(uuid)','icash_text_role_conflict(text,text)','icash_route_lifecycle_text(jsonb,boolean)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';execute 'grant execute on function public.'||signature||' to service_role';end loop;
end $$;
