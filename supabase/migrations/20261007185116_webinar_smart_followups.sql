alter table public.icash_webinar_visitors add column sms_consent_at timestamptz,add column sms_consent_version text,add column sms_opted_out_at timestamptz,add column sms_replied_at timestamptz;
create table public.icash_webinar_outbox (
 id uuid primary key default gen_random_uuid(), visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 session_id uuid not null references public.icash_webinar_sessions(id) on delete cascade,
 channel text not null check(channel in ('email','sms')),recipient text not null check(length(recipient) between 3 and 254),
 step integer not null check(step between 0 and 4),state text not null default 'pending' check(state in ('pending','claimed','sending','sent','delivered','canceled','failed','unknown')),
 due_at timestamptz not null,created_at timestamptz not null default now(),claimed_at timestamptz,first_attempt_at timestamptz,attempts integer not null default 0,
 payload jsonb,provider_id text,sent_at timestamptz,last_error text,unique(channel,recipient,step)
);
create index icash_webinar_outbox_due on public.icash_webinar_outbox(state,due_at);
create index icash_webinar_outbox_visitor on public.icash_webinar_outbox(visitor_id,created_at);
create index icash_webinar_outbox_session on public.icash_webinar_outbox(session_id);
create index icash_webinar_outbox_provider on public.icash_webinar_outbox(channel,provider_id) where provider_id is not null;
create table public.icash_webinar_delivery_receipts(channel text not null,provider_id text not null,kind text not null,created_at timestamptz not null default now(),primary key(channel,provider_id));
create table public.icash_webinar_phone_suppressions(phone text primary key,created_at timestamptz not null default now());
do $$ declare t text;begin
 foreach t in array array['icash_webinar_outbox','icash_webinar_delivery_receipts','icash_webinar_phone_suppressions'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;
create function public.icash_webinar_has_paid(p_visitor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select v.funded_at is not null or v.account_id is not null
 or exists(select 1 from public.icash_funding_orders f where f.mode='live' and f.state='paid' and (f.guest_hash=v.funding_guest_hash or lower(f.payer_email)=lower(v.email)))
 or exists(select 1 from public.icash_memberships m where m.mode='live' and m.paid_through is not null and (m.guest_hash=v.funding_guest_hash or lower(m.payer_email)=lower(v.email)))
 from public.icash_webinar_visitors v where v.id=p_visitor),true);
$$;
create function public.icash_webinar_followup_allowed(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce((select not public.icash_webinar_has_paid(v.id) and case when f.channel='email' then
 v.email_consent_at is not null and v.opted_out_at is null and lower(v.email)=f.recipient and not exists(select 1 from public.icash_webinar_suppressions s where s.email=f.recipient)
 else v.sms_consent_at is not null and v.sms_opted_out_at is null and v.sms_replied_at is null and v.phone=f.recipient
 and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=f.recipient)
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=f.recipient) end
 from public.icash_webinar_outbox f join public.icash_webinar_visitors v on v.id=f.visitor_id where f.id=p_id),false);
$$;
create function public.icash_webinar_contact_followups(p_visitor uuid,p_session uuid,p_name text,p_email text,p_phone text,p_email_consent boolean,p_sms_consent boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare v public.icash_webinar_visitors; normalized text; n integer; ch text; recipient text;
begin
 select * into v from public.icash_webinar_visitors where id=p_visitor for update;
 if not found or not exists(select 1 from public.icash_webinar_sessions where id=p_session and visitor_id=p_visitor and not is_preview) then return;end if;
 normalized:=regexp_replace(coalesce(p_phone,''),'[ ()-]','','g');
 if normalized~'^[0-9]{10}$' then normalized:='+1'||normalized;elsif normalized~'^1[0-9]{10}$' then normalized:='+'||normalized;end if;
 if normalized<>'' and normalized!~'^\+[1-9][0-9]{7,14}$' then raise exception 'Use a valid phone number including country code';end if;
 perform public.icash_webinar_contact(p_visitor,p_name,p_email,normalized,p_email_consent);
 -- The former email-only scheduler is replaced by this bounded cross-channel sequence.
 update public.icash_webinar_followups set state='canceled' where visitor_id=p_visitor and state='pending';
 update public.icash_webinar_visitors set sms_consent_at=case when p_sms_consent and normalized<>'' then case when normalized=v.phone then coalesce(v.sms_consent_at,now()) else now() end else null end,
 sms_consent_version=case when p_sms_consent and normalized<>'' then 'webinar-sms-2026-10-07' else null end where id=p_visitor;
 update public.icash_webinar_outbox f set state='canceled' where visitor_id=p_visitor and state in ('pending','claimed') and not public.icash_webinar_followup_allowed(f.id);
 if public.icash_webinar_has_paid(p_visitor) then return;end if;
 for n in 0..4 loop
 ch:=case when n in (1,3) then 'sms' else 'email' end;recipient:=case when ch='sms' then normalized else lower(p_email) end;
 if (ch='email' and p_email_consent and recipient<>'' and v.opted_out_at is null and not exists(select 1 from public.icash_webinar_suppressions where email=recipient))
 or (ch='sms' and p_sms_consent and recipient<>'' and v.sms_opted_out_at is null and not exists(select 1 from public.icash_webinar_phone_suppressions where phone=recipient) and not exists(select 1 from public.icash_text_suppressions where phone=recipient)) then
 insert into public.icash_webinar_outbox(visitor_id,session_id,channel,recipient,step,due_at)
 values(p_visitor,p_session,ch,recipient,n,now()+case n when 0 then interval '20 minutes' when 1 then interval '90 minutes' when 2 then interval '24 hours' when 3 then interval '48 hours' else interval '72 hours' end) on conflict do nothing;
 end if;end loop;
end $$;
create function public.icash_webinar_claim_followups(p_email_ready boolean,p_sms_ready boolean) returns setof public.icash_webinar_outbox language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_webinar_outbox set state='unknown',last_error='Delivery unconfirmed; not retried' where channel='sms' and state='sending' and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox set state='failed',last_error='Retry window ended' where (state='pending' or (state in ('claimed','sending') and claimed_at<now()-interval '5 minutes')) and (attempts>=4 or first_attempt_at<now()-interval '20 hours');
 update public.icash_webinar_outbox set state='pending' where (state='claimed' or (state='sending' and channel='email')) and claimed_at<now()-interval '5 minutes';
 update public.icash_webinar_outbox f set state='canceled' where state in ('pending','claimed') and (not public.icash_webinar_followup_allowed(f.id) or created_at<now()-interval '7 days');
 return query with candidates as (
 select f.id from public.icash_webinar_outbox f join public.icash_webinar_visitors v on v.id=f.visitor_id
 where f.state='pending' and f.due_at<=now() and v.last_seen_at<=now()-interval '15 minutes'
 and ((f.channel='email' and p_email_ready) or (f.channel='sms' and p_sms_ready))
 order by f.due_at for update of f skip locked limit 25
 ) update public.icash_webinar_outbox f set state='claimed',claimed_at=now(),attempts=attempts+1 from candidates c where f.id=c.id returning f.*;
end $$;
create function public.icash_webinar_authorize_followup(p_id uuid,p_payload jsonb) returns public.icash_webinar_outbox language plpgsql security invoker set search_path='' as $$
declare f public.icash_webinar_outbox; v public.icash_webinar_visitors; config jsonb; recent integer;
begin
 select * into f from public.icash_webinar_outbox where id=p_id for update;
 if not found or f.state<>'claimed' then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(f.visitor_id::text,815));
 select * into v from public.icash_webinar_visitors where id=f.visitor_id;
 select s.config into config from public.icash_webinar_settings s where id=1;
 if not public.icash_webinar_followup_allowed(f.id) then update public.icash_webinar_outbox set state='canceled' where id=f.id;return null;end if;
 if not coalesce((config->>case when f.channel='email' then 'enabled' else 'smsEnabled' end)::boolean,false)
 or v.last_seen_at>now()-interval '15 minutes' then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '20 minutes',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 select count(*) into recent from public.icash_webinar_outbox x where x.visitor_id=f.visitor_id and x.id<>f.id and (x.sent_at>now()-interval '24 hours' or (x.state in ('sending','unknown') and x.first_attempt_at>now()-interval '24 hours'));
 if recent>=2 or exists(select 1 from public.icash_webinar_outbox x where x.visitor_id=f.visitor_id and x.id<>f.id and (x.sent_at>now()-interval '1 hour' or x.state='sending')) then
 update public.icash_webinar_outbox set state='pending',due_at=now()+interval '1 hour',attempts=greatest(0,attempts-1) where id=f.id;return null;end if;
 if f.payload is null and (p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16000) then raise exception 'Invalid follow-up content';end if;
 update public.icash_webinar_outbox set state='sending',payload=coalesce(payload,p_payload),first_attempt_at=coalesce(first_attempt_at,now()),claimed_at=now() where id=f.id returning * into f;
 return f;
end $$;
create function public.icash_webinar_followup_delivery(p_channel text,p_provider text,p_kind text) returns void language plpgsql security invoker set search_path='' as $$
declare f public.icash_webinar_outbox; blocked boolean;
begin
 if p_channel not in ('email','sms') or p_provider is null or length(p_provider)>200 or p_kind not in ('delivered','failed','bounced','complained','suppressed') then raise exception 'Invalid delivery receipt';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_channel||':'||p_provider,816));
 blocked:=p_kind in ('bounced','complained','suppressed');
 insert into public.icash_webinar_delivery_receipts(channel,provider_id,kind) values(p_channel,p_provider,p_kind)
 on conflict(channel,provider_id) do update set kind=case when public.icash_webinar_delivery_receipts.kind in ('bounced','complained','suppressed') then public.icash_webinar_delivery_receipts.kind else excluded.kind end;
 for f in select * from public.icash_webinar_outbox where channel=p_channel and provider_id=p_provider loop
 update public.icash_webinar_outbox set state=case when p_kind='delivered' and not blocked then 'delivered' else 'failed' end where id=f.id and state not in ('canceled','failed');
 if p_channel='email' and blocked then perform public.icash_webinar_unsubscribe(f.visitor_id,p_kind);update public.icash_webinar_outbox set state='canceled' where channel='email' and recipient=f.recipient and state in ('pending','claimed');end if;
 end loop;
end $$;
create function public.icash_webinar_finish_followup(p_id uuid,p_provider text) returns void language plpgsql security invoker set search_path='' as $$
declare f public.icash_webinar_outbox; receipt text;
begin
 if p_provider is null or length(p_provider) not between 1 and 200 then raise exception 'Invalid provider reference';end if;
 select * into f from public.icash_webinar_outbox where id=p_id;
 if not found then return;end if;
 -- Same lock order as the delivery webhook: a receipt may arrive before send returns.
 perform pg_advisory_xact_lock(hashtextextended(f.channel||':'||p_provider,816));
 update public.icash_webinar_outbox set state='sent',provider_id=p_provider,sent_at=coalesce(sent_at,now()),last_error=null where id=p_id and state='sending';
 select kind into receipt from public.icash_webinar_delivery_receipts where channel=f.channel and provider_id=p_provider;
 if receipt is not null then perform public.icash_webinar_followup_delivery(f.channel,p_provider,receipt);end if;
end $$;
create function public.icash_webinar_text_reply(p_phone text,p_stop boolean) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_stop then insert into public.icash_webinar_phone_suppressions(phone) values(p_phone) on conflict do nothing;end if;
 update public.icash_webinar_visitors set sms_opted_out_at=case when p_stop then coalesce(sms_opted_out_at,now()) else sms_opted_out_at end,sms_replied_at=now() where phone=p_phone;
 update public.icash_webinar_outbox set state='canceled' where channel='sms' and recipient=p_phone and state in ('pending','claimed');
end $$;
create function public.icash_webinar_followup_stats() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('emailSent',count(*) filter(where channel='email' and state in ('sent','delivered')),'textsSent',count(*) filter(where channel='sms' and state in ('sent','delivered')),'pending',count(*) filter(where state in ('pending','claimed')),'needsReview',count(*) filter(where state in ('failed','unknown'))) from public.icash_webinar_outbox;
$$;
do $$ declare signature text;begin
 foreach signature in array array['icash_webinar_has_paid(uuid)','icash_webinar_followup_allowed(uuid)','icash_webinar_contact_followups(uuid,uuid,text,text,text,boolean,boolean)','icash_webinar_claim_followups(boolean,boolean)','icash_webinar_authorize_followup(uuid,jsonb)','icash_webinar_followup_delivery(text,text,text)','icash_webinar_text_reply(text,boolean)','icash_webinar_followup_stats()','icash_webinar_finish_followup(uuid,text)'] loop
 execute 'revoke all on function public.'||signature||' from public,anon,authenticated';execute 'grant execute on function public.'||signature||' to service_role';end loop;
end $$;
-- This request enables the bounded sequence. Email remains gated on its mailing address.
update public.icash_webinar_settings set config=jsonb_set(config||'{"enabled":true,"smsEnabled":true,"smartFollowups":true}'::jsonb,'{routing}',coalesce(config->'routing','{"nightStartsAt":18,"nightEndsAt":6}'::jsonb)||'{"checkoutWindowHours":8}'::jsonb),updated_at=now() where id=1;
update public.icash_webinar_settings set config=jsonb_set(config,'{fromEmail}','"sessions@geticashx.com"'::jsonb) where id=1 and coalesce(config->>'fromEmail','')='';
