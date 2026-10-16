-- A cancellation is a protective hold, not permission to resume the deal bot.
-- Only new owner requests create notices. Historical cancellations are not backfilled.
alter table public.icash_agreement_cancellations add column notifications_enabled boolean not null default false;
alter table public.icash_agreement_cancellations alter column notifications_enabled set default true;
create table public.icash_cancellation_notices (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 cancellation_id uuid not null references public.icash_agreement_cancellations(id),
 recipient_key text not null,recipient_name text not null,party text not null check(party in ('seller','buyer','title')),
 channel text not null check(channel in ('sms','email','voice')),phase text not null check(phase in ('requested','completed')),
 destination text not null default '',subject text not null,body text not null,
 state text not null default 'ready' check(state in ('ready','queued','held','superseded')),
 detail text not null default '',sms_id uuid unique references public.icash_text_messages(id),
 email_id uuid unique references public.icash_deal_emails(id),voice_job_id uuid unique references public.icash_voice_jobs(id),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),next_attempt_at timestamptz not null default now(),
 unique(cancellation_id,recipient_key,channel,phase),
 check(channel<>'voice' or party='seller'),check(channel<>'voice' or phase='requested')
);
create index icash_cancellation_notice_due on public.icash_cancellation_notices(next_attempt_at) where state in ('ready','held','queued');
alter table public.icash_cancellation_notices enable row level security;
revoke all on public.icash_cancellation_notices from public,anon,authenticated;
grant select,insert,update on public.icash_cancellation_notices to service_role;
alter table public.icash_voice_jobs add column cancellation_notice_id uuid unique references public.icash_cancellation_notices(id);
drop index public.icash_voice_first_once;
create unique index icash_voice_first_once on public.icash_voice_jobs(permission_id) where callback_id is null and sms_source_message_id is null and cancellation_notice_id is null;
drop index public.icash_voice_operational_first_once;
create unique index icash_voice_operational_first_once on public.icash_voice_jobs(operational_contact_id) where callback_id is null and cancellation_notice_id is null;

create function public.icash_enqueue_cancellation_notices() returns trigger language plpgsql set search_path='' as $$
declare d public.icash_deal_files;person record;ch text;v_phase text;principal text;addr text;shortname text;shortaddr text;sms text;body text;subject text;email text;
begin
 if not new.notifications_enabled or (tg_op='UPDATE' and new.state is not distinct from old.state) then return new;end if;
 select * into strict d from public.icash_deal_files where id=new.deal_id and account_id=new.account_id;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=new.account_id;
 principal:=coalesce(nullif(principal,''),'Your contract contact');addr:=coalesce(nullif(d.terms->>'address',''),'the property in your agreement');
 shortname:=left(regexp_replace(principal,'[^A-Za-z0-9 .,&#-]',' ','g'),20);shortaddr:=left(regexp_replace(addr,'[^A-Za-z0-9 .,&#-]',' ','g'),35);
 v_phase:=case when new.state='completed' then 'completed' else 'requested' end;
 if v_phase='completed' then
  -- Supersede only unclaimed requests. An accepted/uncertain send is never rearmed.
  update public.icash_cancellation_notices n set state='superseded',detail='Replaced by cancellation completion notice',updated_at=now()
   where cancellation_id=new.id and n.phase='requested' and channel<>'voice'
   and (sms_id is null or exists(select 1 from public.icash_text_messages m where m.id=n.sms_id and m.state='ready'))
   and (email_id is null or exists(select 1 from public.icash_deal_emails m where m.id=n.email_id and m.state='ready'));
  update public.icash_text_messages m set state='cancelled',updated_at=now() from public.icash_cancellation_notices n where n.sms_id=m.id and n.cancellation_id=new.id and n.state='superseded' and m.state='ready';
 end if;
 for person in
  select distinct on (case e.kind when 'purchase' then 'seller' else 'buyer' end,coalesce(nullif(r.value->>'phone',''),nullif(lower(r.value->>'email'),''),e.id||':'||r.n))
   case e.kind when 'purchase' then 'seller' else 'buyer' end party,
   coalesce(nullif(r.value->>'phone',''),nullif(lower(r.value->>'email'),''),e.id||':'||r.n) key,
   coalesce(nullif(r.value->>'name',''),'Agreement signer') name,coalesce(r.value->>'phone','') phone,coalesce(lower(r.value->>'email'),'') email,e.kind
  from jsonb_array_elements(new.snapshot) s join public.icash_signing_envelopes e on e.id=(s->>'id')::uuid and e.account_id=new.account_id and e.deal_id=new.deal_id
  cross join lateral jsonb_array_elements(e.recipients) with ordinality r(value,n)
  where not e.test_mode and r.n<jsonb_array_length(e.recipients)
  union all
  select 'title','title:'||lower(t.email),'Closing office','',lower(t.email),'title'
  from public.icash_title_contacts t where new.has_title and t.account_id=new.account_id and t.deal_id=new.deal_id and t.enabled and t.verified_until>now()
 loop
  email:=person.email;
  if email='' and person.party='seller' then
   select lower(l.email) into email from public.icash_seller_intakes l join public.icash_seller_matches m on m.lead_id=l.id
    where m.account_id=new.account_id and m.screening_id=d.screening_id and l.phone=person.phone and l.email_consented and l.email is not null and l.data_rights_until>now() order by l.created_at desc limit 1;
  end if;
  -- Keep an address explicitly supplied for this cancellation through completion.
  if coalesce(email,'')='' then select n.destination into email from public.icash_cancellation_notices n where n.cancellation_id=new.id and n.recipient_key=person.party||':'||person.key and n.channel='email' and n.destination<>'' order by n.created_at limit 1;end if;
  subject:=left('Cancellation '||case v_phase when 'completed' then 'recorded' else 'requested' end||': '||regexp_replace(addr,E'[\r\n]',' ','g'),180);
  body:=principal||case v_phase when 'completed' then ' has recorded cancellation of the ' else ' has requested cancellation of the ' end||case person.kind when 'assignment' then 'assignment agreement' when 'title' then 'agreement workflow' else 'purchase agreement' end||' for '||addr||E'.\n\n'||
   case v_phase when 'completed' then 'Please reply for the cancellation or release documents and confirmation of title and deposit arrangements. This update reports the account owner''s record; it is not an independent legal determination and does not return a deposit.'
    else 'Please reply to coordinate any required termination notice or release and confirm next steps with the closing office. This message does not itself terminate a signed agreement or release a deposit.' end||E'\n\nSent by iCash X on behalf of '||principal||'.';
  sms:=shortname||case v_phase when 'completed' then ': Cancellation recorded: ' else ': Cancellation requested: ' end||shortaddr||case v_phase when 'completed' then '. Reply for release documents and deposit steps. This text does not refund funds.' else '. Reply about required notices/releases. This text is not a signed release.' end;
  foreach ch in array case when person.party='title' then array['email'] when person.party='seller' and v_phase='requested' then array['sms','email','voice'] else array['sms','email'] end loop
   insert into public.icash_cancellation_notices(account_id,cancellation_id,recipient_key,recipient_name,party,channel,phase,destination,subject,body,state,detail)
   values(new.account_id,new.id,person.party||':'||person.key,person.name,person.party,ch,v_phase,case ch when 'email' then coalesce(email,'') else person.phone end,subject,case ch when 'sms' then sms else body end,
    case when (ch='email' and coalesce(email,'')='') or (ch<>'email' and person.phone='') then 'held' else 'ready' end,
    case when ch='email' and coalesce(email,'')='' then 'Add this signer''s email to send the notice.' when ch<>'email' and person.phone='' then 'No signing phone saved. Contact this signer yourself.' else '' end)
   on conflict(cancellation_id,recipient_key,channel,phase) do nothing;
  end loop;
 end loop;
 return new;
end $$;
create trigger icash_cancellation_notifications after insert or update of state on public.icash_agreement_cancellations for each row execute function public.icash_enqueue_cancellation_notices();

-- Record a missing transactional address; never change the original agreement or a dispatched notice.
create function public.icash_cancellation_notice_email(p_account uuid,p_actor uuid,p_notice uuid,p_email text) returns uuid language plpgsql set search_path='' as $$
declare n public.icash_cancellation_notices;c public.icash_agreement_cancellations;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 select * into strict n from public.icash_cancellation_notices where id=p_notice and account_id=p_account and channel='email' for update;
 select * into strict c from public.icash_agreement_cancellations where id=n.cancellation_id and account_id=p_account;
 if n.email_id is not null or n.destination<>'' or n.state='superseded' or n.created_at<now()-interval '7 days' then raise exception 'This notice cannot be changed';end if;
 if coalesce(length(trim(p_email)),0) not between 3 and 254 or lower(trim(p_email)) !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then raise exception 'Valid signer email required';end if;
 update public.icash_cancellation_notices set destination=lower(trim(p_email)),state='ready',detail='',next_attempt_at=now(),updated_at=now()
  where cancellation_id=c.id and recipient_key=n.recipient_key and channel='email' and destination='' and email_id is null and state<>'superseded';
 return c.deal_id;
end $$;

create function public.icash_cancellation_notice_current(p_account uuid,p_notice uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_cancellation_notices n join public.icash_agreement_cancellations c on c.id=n.cancellation_id and c.account_id=n.account_id
 join public.icash_accounts a on a.id=c.account_id and a.owner_user_id=c.actor_user_id
 join public.icash_deal_files d on d.id=c.deal_id and d.account_id=c.account_id
 where n.id=p_notice and n.account_id=p_account and c.notifications_enabled and n.state<>'superseded' and not c.late_activity
 and n.created_at>now()-interval '7 days' and coalesce(d.terms->>'practice','false')<>'true'
 and (n.channel='voice' or (n.phase='completed')=(c.state='completed'))
 and (n.party<>'title' or exists(select 1 from public.icash_title_contacts t where t.account_id=c.account_id and t.deal_id=c.deal_id and t.enabled and t.verified_until>now() and lower(t.email)=n.destination)));
$$;

-- Existing message and mail adapters retain delivery webhooks, reply routing and actual-use billing.
create function public.icash_prepare_cancellation_notice(p_account uuid,p_notice uuid) returns jsonb language plpgsql set search_path='' as $$
declare n public.icash_cancellation_notices;c public.icash_agreement_cancellations;d public.icash_deal_files;t public.icash_text_threads;p public.icash_voice_contact_targets;rate uuid;job uuid;reason text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict n from public.icash_cancellation_notices where id=p_notice and account_id=p_account for update;
 if not public.icash_cancellation_notice_current(p_account,n.id) then return null;end if;
 select * into strict c from public.icash_agreement_cancellations where id=n.cancellation_id and account_id=p_account;
 select * into strict d from public.icash_deal_files where id=c.deal_id and account_id=p_account;
 if n.destination='' then return null;end if;
 if n.channel='sms' and n.sms_id is null then
  select * into t from public.icash_text_threads where account_id=p_account and deal_id=d.id and recipient=n.destination and party=n.party and retired_at is null order by id limit 1;
  if t.id is null then reason:='Open Texts to set up this signer''s conversation.';
  else
   reason:=public.icash_manual_text_reason(p_account,t.id);
   if reason is null then
    job:=public.icash_queue_text(p_account,t.id,n.id,n.body,'{}');
    update public.icash_text_messages set customer_author_id=c.actor_user_id where id=job and account_id=p_account;
    update public.icash_cancellation_notices set sms_id=job,state='queued',detail='',updated_at=now() where id=n.id;
   end if;
  end if;
 elsif n.channel='email' and n.email_id is null then
  if exists(select 1 from public.icash_email_suppressions where account_id=p_account and email=lower(n.destination)) then reason:='Email is suppressed. Contact this signer another way.';
  else
   select id into rate from public.icash_operation_rates where operation='manual_email' and enabled and verified_at<=now() and expires_at>now() order by verified_at desc,id limit 1;
   if rate is null then reason:='Email setup needs attention.';
   else
    insert into public.icash_deal_emails(account_id,deal_id,direction,contact_key,recipient,subject,body_text,state,request_key,rate_id,permission_until,authored_by)
    values(p_account,d.id,'outgoing','cancellation:'||n.id,n.destination,n.subject,n.body,'ready',n.id,rate,n.created_at+interval '7 days',c.actor_user_id) returning id into job;
    update public.icash_cancellation_notices set email_id=job,state='queued',detail='',updated_at=now() where id=n.id;
   end if;
  end if;
 elsif n.channel='voice' and n.voice_job_id is null then
  select * into p from public.icash_voice_contact_targets where account_id=p_account and screening_id=d.screening_id and party='seller' and phone=n.destination and revoked_at is null and permission_until>now() order by permission_until desc,id limit 1;
  if p.id is null then reason:='Calling permission is unavailable. Contact the seller yourself.';
  else
   insert into public.icash_voice_jobs(account_id,permission_id,operational_contact_id,state,cancellation_notice_id)
   values(p_account,case when exists(select 1 from public.icash_contact_permissions where id=p.id and account_id=p_account) then p.id end,case when not exists(select 1 from public.icash_contact_permissions where id=p.id and account_id=p_account) then p.id end,'issued',n.id) returning id into job;
   update public.icash_cancellation_notices set voice_job_id=job,state='queued',detail='',updated_at=now() where id=n.id;
  end if;
 end if;
 if reason is not null then update public.icash_cancellation_notices set state='held',detail=reason,updated_at=now() where id=n.id;end if;
 select * into strict n from public.icash_cancellation_notices where id=p_notice;
 return to_jsonb(n);
end $$;

alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_email_before_cancellation;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare n public.icash_cancellation_notices;m public.icash_deal_emails;principal text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into n from public.icash_cancellation_notices where account_id=p_account and email_id=p_id;
 if not found then return public.icash_claim_email_before_cancellation(p_account,p_id);end if;
 select * into m from public.icash_deal_emails where id=p_id and account_id=p_account for update;
 if not public.icash_cancellation_notice_current(p_account,n.id) or m.state<>'ready' or m.direction<>'outgoing' or m.permission_until<=now()
 or row(m.recipient,m.subject,m.body_text,m.request_key,m.contact_key) is distinct from row(n.destination,n.subject,n.body,n.id,'cancellation:'||n.id)
 or exists(select 1 from public.icash_email_suppressions where account_id=p_account and email=lower(m.recipient)) then return null;end if;
 if not exists(select 1 from public.icash_operation_rates where id=m.rate_id and operation='manual_email' and enabled and verified_at<=now() and expires_at>now()) then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if coalesce(length(trim(principal)),0)=0 then return null;end if;
 perform public.icash_reserve_operation(p_account,'deal-email:'||m.id,m.rate_id,m.permission_until);
 if not public.icash_claim_operation('deal-email:'||m.id) then return null;end if;
 update public.icash_deal_emails set state='dispatching',updated_at=now() where id=m.id;
 return jsonb_build_object('id',m.id,'to',m.recipient,'subject',m.subject,'text',m.body_text,'principal',principal);
end $$;

-- The manual sender is allowed to pause a property and send its exact cancellation.
-- Recheck the immutable notice before dispatch, including after a completion race.
alter function public.icash_claim_customer_text(uuid,uuid,text) rename to icash_claim_customer_text_before_cancellation;
create function public.icash_claim_customer_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
declare n public.icash_cancellation_notices;m public.icash_text_messages;t public.icash_text_threads;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into n from public.icash_cancellation_notices where account_id=p_account and sms_id=p_message;
 if found then
  select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
  select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
  if not public.icash_cancellation_notice_current(p_account,n.id) or row(m.body,t.recipient,t.sender) is distinct from row(n.body,n.destination,p_sender) then return null;end if;
 end if;
 return public.icash_claim_customer_text_before_cancellation(p_account,p_message,p_sender);
end $$;

alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_cancellation;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.icash_cancellation_notices where account_id=p_account and sms_id=p_message) then return public.icash_claim_customer_text(p_account,p_message,p_sender);end if;
 return public.icash_claim_text_before_cancellation(p_account,p_message,p_sender);
end $$;

create function public.icash_cancellation_voice_context(p_account uuid,p_job uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('address',coalesce(d.terms->>'address','the property in your agreement'),'body',coalesce(done.body,n.body),'completed',c.state='completed')
 from public.icash_voice_jobs j join public.icash_cancellation_notices n on n.id=j.cancellation_notice_id and n.voice_job_id=j.id and n.account_id=j.account_id
 join public.icash_agreement_cancellations c on c.id=n.cancellation_id and c.account_id=n.account_id
 join public.icash_deal_files d on d.id=c.deal_id and d.account_id=c.account_id
 join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id and p.screening_id=d.screening_id and p.phone=n.destination and p.party='seller'
 left join lateral(select nn.body from public.icash_cancellation_notices nn where nn.cancellation_id=c.id and nn.recipient_key=n.recipient_key and nn.channel='email' and nn.phase='completed' limit 1) done on c.state='completed'
 where j.id=p_job and j.account_id=p_account and n.channel='voice' and n.party='seller' and public.icash_cancellation_notice_current(p_account,n.id);
$$;

create function public.icash_cancellation_voice_current(p_account uuid,p_operation text) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
 join public.icash_accounts a on a.id=j.account_id and not a.bot_paused
 join public.icash_voice_configs cfg on cfg.account_id=a.id and cfg.enabled and cfg.reviewed_until>now()
 where j.account_id=p_account and 'voice:'||j.id=p_operation and j.cancellation_notice_id is not null
 and public.icash_cancellation_voice_context(p_account,j.id) is not null and p.party='seller' and p.revoked_at is null and p.permission_until>now()
 and (public.icash_seller_voice_permission_current(p_account,p.id) or (p.dnc_clear and p.dnc_checked_at between now()-interval '30 days' and now()))
 and (j.operational_contact_id is null or public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',true))
 and exists(select 1 from pg_timezone_names where name=p.timezone)
 and extract(hour from now() at time zone p.timezone)>=greatest(9,p.local_start_hour)
 and extract(hour from now() at time zone p.timezone)<least(case when public.icash_seller_voice_permission_current(p_account,p.id) then 20 else 18 end,p.local_end_hour)
 and not exists(select 1 from public.icash_text_suppressions where phone=p.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key));
$$;

create function public.icash_reserve_cancellation_voice(p_account uuid,p_job uuid,p_context jsonb) returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;r public.icash_operation_rates;b public.icash_operating_budget;parts jsonb;total numeric;price bigint;op text:='voice:'||p_job;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or public.icash_cancellation_voice_context(p_account,p_job) is distinct from p_context or not public.icash_cancellation_voice_current(p_account,op) then return null;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 select rate.* into r from public.icash_voice_configs cfg join public.icash_operation_rates rate on rate.id=cfg.seller_rate_id
 where cfg.account_id=p_account and cfg.enabled and cfg.reviewed_until>now() and rate.operation='seller_call' and rate.enabled and rate.verified_at<=now() and rate.expires_at>now()
 and rate.voice_max_duration_seconds=600 and rate.charge_cents=977 and rate.version like 'required-audio-30d-speech-v1:%';
 if not found then return null;end if;
 -- Wait before reserving when another call is active or being admitted. A wait
 -- keeps this unused job retryable; it must not consume a one-use dispatch.
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets cp on cp.id=coalesce(v.permission_id,v.operational_contact_id) and cp.account_id=v.account_id
  left join public.icash_operation_spend os on os.operation_key='voice:'||v.id
  where v.id<>j.id and (v.account_id=p_account or cp.phone=p.phone) and (v.state='dispatching' or os.state='reserved' or (v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))))
 or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then return null;end if;
 if not exists(select 1 from public.icash_operation_spend where operation_key=op) then
  if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
  parts:=public.icash_voice_bounded_costs(r.costs_micros,120);select sum(value::numeric) into total from jsonb_each_text(parts);
  price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
  insert into public.icash_voice_credit_bounds(operation_key,account_id,rate_id,max_seconds,charge_cents,costs_micros) values(op,p_account,r.id,120,price,parts) on conflict(operation_key) do nothing;
 end if;
 -- No invented financial eligibility: this exact call only reports cancellation.
 perform public.icash_reserve_operation(p_account,op,r.id,least(p.permission_until,now()+interval '10 minutes'));
 update public.icash_cancellation_notices set body=p_context->>'body',updated_at=now() where id=j.cancellation_notice_id and account_id=p_account;
 return jsonb_build_object('maxSeconds',120);
end $$;
create function public.icash_claim_cancellation_voice(p_account uuid,p_job uuid,p_context jsonb) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or public.icash_cancellation_voice_context(p_account,p_job) is distinct from p_context or not public.icash_cancellation_voice_current(p_account,'voice:'||j.id) then return false;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 perform pg_advisory_xact_lock(hashtextextended(p.phone,74));
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets cp on cp.id=coalesce(v.permission_id,v.operational_contact_id) and cp.account_id=v.account_id
  where v.id<>j.id and (v.state='dispatching' or (v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))) and (v.account_id=p_account or cp.phone=p.phone))
 or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',operation_key='voice:'||id,updated_at=now() where id=j.id;
 return true;
end $$;
-- Exempt only the cancellation-purpose call from acquisition underwriting; retain
-- billing, positive-credit, membership, configuration, consent and pause checks.
do $patch$ declare definition text;needle text;fn text;begin
 foreach fn in array array['icash_reserve_before_fractional','icash_claim_before_activation'] loop
  definition:=pg_get_functiondef(case fn when 'icash_reserve_before_fractional' then 'public.icash_reserve_before_fractional(uuid,text,uuid,timestamptz,timestamptz,boolean)'::regprocedure else 'public.icash_claim_before_activation(text)'::regprocedure end);
  needle:=case fn when 'icash_reserve_before_fractional' then 'not public.icash_limited_seller_voice(p_account,p_operation)' else 'not public.icash_limited_seller_voice(o.account_id,p_operation)' end;
  if position(needle in definition)=0 then raise exception 'Cancellation voice underwriting boundary changed';end if;
  definition:=replace(definition,needle,needle||case fn when 'icash_reserve_before_fractional' then ' and not public.icash_cancellation_voice_current(p_account,p_operation)' else ' and not public.icash_cancellation_voice_current(o.account_id,p_operation)' end);execute definition;
 end loop;
end $patch$;

-- Manual signature delivery preserves all source consent/rate checks while the
-- owner has control. No automation permission is written or unpaused.
do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_seller_sms_permission_current(uuid,uuid,boolean)'::regprocedure);
 definition:=replace(definition,'public.icash_seller_sms_permission_current(','public.icash_seller_sms_permission_manual(');
 needle:=' or t.paused or t.manual_only or t.ai_mode<>''auto''';
 if position(needle in definition)=0 then raise exception 'Manual signing thread boundary changed';end if;
 definition:=replace(definition,needle,'');
 needle:=$n$ if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=d.screening_id and s.account_id=p_account and pc.manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=d.screening_id and state<>'resolved') then return false;end if;$n$;
 if position(needle in definition)=0 then raise exception 'Manual signing ownership boundary changed';end if;
 definition:=replace(definition,needle,'');execute definition;
end $patch$;
create function public.icash_manual_signing_sms_current(p_account uuid,p_thread uuid,p_actor uuid) returns boolean language plpgsql set search_path='' as $$
declare t public.icash_text_threads;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then return false;end if;
 select * into t from public.icash_text_threads where account_id=p_account and id=p_thread and retired_at is null;
 if not found or exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage in ('cancellation_pending','cancelled','closed'))
 or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
 or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')) then return false;end if;
 return case when t.seller_intake_id is not null then public.icash_seller_sms_permission_manual(p_account,t.id,true) else public.icash_sms_thread_review_current(p_account,t.id,true) end;
end $$;

create function public.icash_due_cancellation_notices(p_limit integer default 12) returns table(id uuid,account_id uuid) language plpgsql set search_path='' as $$
begin
 return query with due as (
  select n.id from public.icash_cancellation_notices n left join public.icash_text_messages s on s.id=n.sms_id left join public.icash_deal_emails e on e.id=n.email_id left join public.icash_voice_jobs v on v.id=n.voice_job_id
  where n.state<>'superseded' and n.next_attempt_at<=now() and n.created_at>now()-interval '7 days' and n.destination<>''
  and (n.sms_id is null or s.state='ready') and (n.email_id is null or e.state='ready')
  and (n.voice_job_id is null or (v.state in ('ready','issued','held') and v.provider_call_sid is null and v.conversation_id is null and v.due_at<=now()
    and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||v.id)
    and not exists(select 1 from public.icash_call_recordings r where r.voice_job_id=v.id)))
  order by n.next_attempt_at,n.id for update of n skip locked limit greatest(1,least(coalesce(p_limit,12),20)))
 update public.icash_cancellation_notices n set next_attempt_at=now()+interval '5 minutes' from due where n.id=due.id returning n.id,n.account_id;
end $$;

alter function public.icash_cancellation_preview(uuid,uuid,uuid) rename to icash_cancellation_preview_before_notices;
create function public.icash_cancellation_preview(p_account uuid,p_actor uuid,p_deal uuid) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb;notices jsonb;
begin
 result:=public.icash_cancellation_preview_before_notices(p_account,p_actor,p_deal);
 select coalesce(jsonb_agg(jsonb_build_object('id',n.id,'cancellationId',n.cancellation_id,'name',n.recipient_name,'party',n.party,'channel',n.channel,'phase',n.phase,'destination',n.destination,
  'state',case when n.state='superseded' then 'superseded' when n.created_at<=now()-interval '7 days' and coalesce(s.state,e.state,v.state,'ready') in ('ready','held','issued') then 'expired' when s.id is not null then s.state when e.id is not null then coalesce(e.delivery_state,e.state) when r.call_ended_at is not null then 'call_ended' when r.call_sid is not null then 'calling' when v.state in ('dispatching','dispatched') then v.state when n.created_at<=now()-interval '7 days' then 'expired' else n.state end,
  'detail',case when s.state in ('accepted','delivered') or e.state='accepted' or r.call_sid is not null then '' else n.detail end,'body',n.body,'createdAt',n.created_at) order by n.created_at,n.recipient_key,n.channel),'[]') into notices
 from public.icash_cancellation_notices n join public.icash_agreement_cancellations c on c.id=n.cancellation_id and c.account_id=n.account_id
 left join public.icash_text_messages s on s.id=n.sms_id left join public.icash_deal_emails e on e.id=n.email_id left join public.icash_voice_jobs v on v.id=n.voice_job_id
 left join public.icash_call_recordings r on r.voice_job_id=v.id
 where c.deal_id=p_deal and n.account_id=p_account and exists(select 1 from jsonb_array_elements(result->'requests') item where item->>'id'=c.id::text);
 return result||jsonb_build_object('notices',notices);
end $$;

-- All new functions remain server-only, including helper clones.
do $$ declare f record;begin
 for f in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace and proname in (
 'icash_enqueue_cancellation_notices','icash_cancellation_notice_email','icash_cancellation_notice_current','icash_prepare_cancellation_notice',
 'icash_claim_deal_email','icash_claim_customer_text','icash_claim_text','icash_cancellation_voice_context','icash_cancellation_voice_current','icash_reserve_cancellation_voice','icash_claim_cancellation_voice',
 'icash_seller_sms_permission_manual','icash_manual_signing_sms_current','icash_due_cancellation_notices','icash_cancellation_preview') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;

create function public.icash_retry_cancellation_voice(p_account uuid,p_job uuid) returns boolean language plpgsql set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if public.icash_cancellation_voice_context(p_account,p_job) is null
 or exists(select 1 from public.icash_operation_spend where operation_key='voice:'||p_job)
 or exists(select 1 from public.icash_call_recordings where voice_job_id=p_job) then return false;end if;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=p_job and account_id=p_account and cancellation_notice_id is not null and state in ('ready','issued','held') and due_at<=now() and provider_call_sid is null and conversation_id is null;
 return found;
end $$;
revoke all on function public.icash_retry_cancellation_voice(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_retry_cancellation_voice(uuid,uuid) to service_role;
