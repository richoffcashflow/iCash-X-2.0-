begin;
-- Isolated Oct3 owner acceptance allowance. No customer contact, job, wallet or legacy-probe writes.
create schema icash_owner_recording_private;
revoke all on schema icash_owner_recording_private from public,anon,authenticated,service_role;
create function icash_owner_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select pg_catalog.clock_timestamp()$$;
create table public.icash_owner_recording_test_config(
 id integer primary key check(id=1), account_id uuid not null references public.icash_accounts(id),owner_user_id uuid not null references auth.users(id),
 phone text not null check(phone~'^\+[1-9][0-9]{7,14}$' and right(phone,4)='5280'),from_phone text not null check(from_phone='+14243948384'),phone_number_id text not null,
 review jsonb not null,quote jsonb not null,enabled boolean not null default false,
 approval_ref text not null check(approval_ref='owner-recording-approval-v1:7f122011e069c5d71aba3135f16598e172ee51df3cf709bb0e39d74531a5ffbc'),approved_at timestamptz not null check(approved_at='2026-10-03T03:23:39.205285Z'::timestamptz),
 prior_attempts integer not null check(prior_attempts between 0 and 3),prior_spend_micros bigint not null check(prior_spend_micros between 0 and 3000000),
 max_attempts integer not null default 3 check(max_attempts=3),total_cap_micros bigint not null default 3000000 check(total_cap_micros=3000000),max_seconds integer not null default 60 check(max_seconds=60),
 created_at timestamptz not null default icash_owner_recording_private.clock_now(),expires_at timestamptz not null check(isfinite(expires_at)),
 check(expires_at>created_at and expires_at<=created_at+interval '24 hours')
);
create table public.icash_owner_recording_test_runs(
 id uuid primary key default gen_random_uuid(),config_id integer not null references public.icash_owner_recording_test_config(id),account_id uuid not null references public.icash_accounts(id),owner_user_id uuid not null references auth.users(id),
 configuration jsonb not null,attempt integer not null check(attempt between 1 and 3),unique(config_id,attempt),
 nonce_hash text not null check(nonce_hash~'^[a-f0-9]{64}$'),stop_token_hash text not null check(stop_token_hash~'^[a-f0-9]{64}$'),reserved_micros bigint not null check(reserved_micros between 1 and 1000000),
 state text not null default 'consent_pending' check(state in ('consent_pending','starting','recording','stopping','processing','available','absent','failed','declined','deleted')),
 row_version bigint not null default 1,created_at timestamptz not null default icash_owner_recording_private.clock_now(),updated_at timestamptz not null default icash_owner_recording_private.clock_now(),
 call_sid text unique check(call_sid~'^CA[0-9a-fA-F]{32}$'),call_started_at timestamptz,recording_sid text unique check(recording_sid~'^RE[0-9a-fA-F]{32}$'),conversation_id text unique check(conversation_id~'^conv_[A-Za-z0-9]+$'),
 consent_at timestamptz,consent_evidence jsonb,start_claimed_at timestamptz,registration_claimed_at timestamptz,
 end_requested_at timestamptz,call_ended_at timestamptz,provider_started_at timestamptz,audio_expires_at timestamptz,duration_seconds integer check(duration_seconds between 0 and 60),recording_price_micros bigint check(recording_price_micros>=0),
 settled_micros bigint check(settled_micros>=0),settlement jsonb,settled_at timestamptz,deleted_at timestamptz,
 contact_opted_out boolean not null default false,
 next_work_at timestamptz not null default icash_owner_recording_private.clock_now(),lease_token uuid,lease_until timestamptz,last_error text,
 check((consent_at is null)=(consent_evidence is null)),check(start_claimed_at is null or consent_at is not null),check(registration_claimed_at is null or recording_sid is not null),check(call_ended_at is null or end_requested_at is not null),
 check(audio_expires_at is not distinct from provider_started_at+interval '720 hours'),check((settled_micros is null)=(settlement is null))
);
create table icash_owner_recording_private.events(id bigint generated always as identity primary key,run_id uuid not null,version bigint not null,action text not null,created_at timestamptz not null default icash_owner_recording_private.clock_now(),unique(run_id,version));
alter table icash_owner_recording_private.events enable row level security;
revoke all on icash_owner_recording_private.events from public,anon,authenticated,service_role;
revoke all on all sequences in schema icash_owner_recording_private from public,anon,authenticated,service_role;
create function icash_owner_recording_private.audit_immutable() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Owner recording audit is append only';end $$;
create trigger icash_owner_recording_audit_no_change before update or delete on icash_owner_recording_private.events for each row execute function icash_owner_recording_private.audit_immutable();
create trigger icash_owner_recording_audit_no_truncate before truncate on icash_owner_recording_private.events for each statement execute function icash_owner_recording_private.audit_immutable();
alter table public.icash_owner_recording_test_config enable row level security;
alter table public.icash_owner_recording_test_runs enable row level security;
revoke all on public.icash_owner_recording_test_config,public.icash_owner_recording_test_runs from public,anon,authenticated,service_role;
grant select on public.icash_owner_recording_test_config,public.icash_owner_recording_test_runs to service_role;
create function icash_owner_recording_private.guard() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP in ('DELETE','TRUNCATE') then raise exception 'Owner acceptance evidence cannot be erased';end if;
 if TG_OP='UPDATE' then
  if TG_TABLE_NAME='icash_owner_recording_test_config' then
   if (to_jsonb(old)-array['enabled','review','quote']) is distinct from (to_jsonb(new)-array['enabled','review','quote']) then raise exception 'Owner allowance/configuration is immutable';end if;
   if old.review->>'stopToolId' is not null and new.review->>'stopToolId' is distinct from old.review->>'stopToolId' or old.review->>'stopToolId' is null and new.review->>'stopToolId' is not null and (new.review->>'stopToolId')!~'^tool_[A-Za-z0-9]+$' then raise exception 'Established stop tool target is immutable';end if;
   if row(old.review,old.quote) is distinct from row(new.review,new.quote) and (old.enabled or new.enabled or exists(select 1 from public.icash_owner_recording_test_runs where config_id=old.id) or (old.review-array['configHash','versionId','reviewedAt','reviewedUntil','stopToolId']) is distinct from (new.review-array['configHash','versionId','reviewedAt','reviewedUntil','stopToolId'])) then raise exception 'Provider review can only be completed disabled, before any attempt, with the same fixed targets';end if;
  else
   if row(new.id,new.config_id,new.account_id,new.owner_user_id,new.configuration,new.attempt,new.nonce_hash,new.stop_token_hash,new.reserved_micros,new.created_at) is distinct from row(old.id,old.config_id,old.account_id,old.owner_user_id,old.configuration,old.attempt,old.nonce_hash,old.stop_token_hash,old.reserved_micros,old.created_at)
    or old.call_sid is not null and new.call_sid is distinct from old.call_sid or old.call_started_at is not null and new.call_started_at is distinct from old.call_started_at or old.start_claimed_at is not null and new.start_claimed_at is distinct from old.start_claimed_at or old.registration_claimed_at is not null and new.registration_claimed_at is distinct from old.registration_claimed_at or old.end_requested_at is not null and new.end_requested_at is distinct from old.end_requested_at or old.call_ended_at is not null and new.call_ended_at is distinct from old.call_ended_at or old.duration_seconds is not null and row(new.duration_seconds,new.recording_price_micros) is distinct from row(old.duration_seconds,old.recording_price_micros) or old.recording_sid is not null and new.recording_sid is distinct from old.recording_sid
    or old.conversation_id is not null and new.conversation_id is distinct from old.conversation_id or old.consent_at is not null and row(new.consent_at,new.consent_evidence) is distinct from row(old.consent_at,old.consent_evidence)
    or old.provider_started_at is not null and row(new.provider_started_at,new.audio_expires_at) is distinct from row(old.provider_started_at,old.audio_expires_at)
    or old.settlement is not null and row(new.settlement,new.settled_micros) is distinct from row(old.settlement,old.settled_micros)
    or old.contact_opted_out and not new.contact_opted_out or old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at then raise exception 'Owner test binding/evidence is immutable';end if;
   if new.row_version<>old.row_version+1 then raise exception 'Owner test CAS required';end if;
  end if;
 end if;
 if TG_TABLE_NAME='icash_owner_recording_test_config' then
  if not exists(select 1 from public.icash_owner_voice_acceptance_config c join public.icash_accounts a on a.id=c.account_id where c.account_id=new.account_id and c.owner_user_id=new.owner_user_id and c.phone=new.phone and c.phone_number_id=new.phone_number_id and a.owner_user_id=new.owner_user_id) then raise exception 'Existing verified owner binding required';end if;
 else insert into icash_owner_recording_private.events(run_id,version,action) values(new.id,new.row_version,new.state);end if;
 return new;
end $$;
create trigger icash_owner_recording_config_guard before insert or update or delete on public.icash_owner_recording_test_config for each row execute function icash_owner_recording_private.guard();
create trigger icash_owner_recording_run_guard before insert or update or delete on public.icash_owner_recording_test_runs for each row execute function icash_owner_recording_private.guard();
create trigger icash_owner_recording_config_no_truncate before truncate on public.icash_owner_recording_test_config for each statement execute function icash_owner_recording_private.guard();
create trigger icash_owner_recording_run_no_truncate before truncate on public.icash_owner_recording_test_runs for each statement execute function icash_owner_recording_private.guard();
create function public.icash_claim_owner_recording_test(p_account uuid,p_user uuid,p_expected jsonb,p_run uuid,p_nonce_hash text,p_stop_hash text) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.icash_owner_recording_test_config;r public.icash_owner_recording_test_runs;n integer;used bigint;hold bigint;t timestamptz:=icash_owner_recording_private.clock_now();
begin
 select * into c from public.icash_owner_recording_test_config where id=1 and account_id=p_account and owner_user_id=p_user for update;
 t:=icash_owner_recording_private.clock_now();
 if not found or not c.enabled or c.expires_at<=t or to_jsonb(c) is distinct from p_expected or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then return null;end if;
 if p_nonce_hash!~'^[a-f0-9]{64}$' or p_stop_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid owner capability';end if;
 hold:=(c.quote->>'maxAttemptMicros')::bigint;if hold is null or hold not between 1 and 1000000 then return null;end if;
 select count(*)::integer,coalesce(sum(coalesce(settled_micros,reserved_micros)),0) into n,used from public.icash_owner_recording_test_runs where config_id=c.id;
 if n+c.prior_attempts>=3 or used+c.prior_spend_micros+hold>3000000 or exists(select 1 from public.icash_owner_recording_test_runs where config_id=c.id and (settled_at is null or call_ended_at is null or contact_opted_out or settled_micros>reserved_micros)) then return null;end if;
 insert into public.icash_owner_recording_test_runs(id,config_id,account_id,owner_user_id,configuration,attempt,nonce_hash,stop_token_hash,reserved_micros)
 values(p_run,c.id,p_account,p_user,to_jsonb(c),n+c.prior_attempts+1,p_nonce_hash,p_stop_hash,hold) returning * into r;return to_jsonb(r);
end $$;
create function public.icash_transition_owner_recording_test(p_id uuid,p_version bigint,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_recording_test_runs;t timestamptz:=icash_owner_recording_private.clock_now();s text;started timestamptz;amount bigint;
begin
 select * into r from public.icash_owner_recording_test_runs where id=p_id and row_version=p_version for update;if not found then return null;end if;t:=icash_owner_recording_private.clock_now();
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Owner test payload required';end if;
 if p_action in ('consent','claim_start','claim_register') and (r.end_requested_at is not null or not exists(select 1 from public.icash_owner_recording_test_config c join public.icash_accounts a on a.id=c.account_id where c.id=r.config_id and c.enabled and c.expires_at>t and a.owner_user_id=r.owner_user_id)) then return null;end if;
 if p_action='bind_call' then
  if r.call_sid is not null or coalesce(p_payload->>'callSid','')!~'^CA[0-9a-fA-F]{32}$' or p_payload->>'accountSid' is distinct from r.configuration->'review'->>'providerAccountSid' or p_payload->>'from' is distinct from r.configuration->>'from_phone' or p_payload->>'to' is distinct from r.configuration->>'phone' then return null;end if;
  r.call_sid:=p_payload->>'callSid';r.call_started_at:=(p_payload->>'startedAt')::timestamptz;if r.call_started_at is not null and (not isfinite(r.call_started_at) or r.call_started_at<r.created_at-interval '5 seconds' or r.call_started_at>t+interval '1 minute') then return null;end if;
 elsif p_action='answered' then
  started:=(p_payload->>'startedAt')::timestamptz;if r.call_sid is null or r.call_started_at is not null or started is null or not isfinite(started) or started<r.created_at-interval '5 seconds' or started>t+interval '1 minute' then return null;end if;r.call_started_at:=started;
 elsif p_action='consent' then
  s:=lower(trim(regexp_replace(trim(p_payload->>'utterance'),'[.!]+$','','g')));
  if r.state<>'consent_pending' or r.consent_at is not null or r.call_sid is null or r.call_started_at is null or t>r.call_started_at+interval '45 seconds' or p_payload->>'nonceHash' is distinct from r.nonce_hash or p_payload->>'source' is distinct from 'twilio_gather_speech' or jsonb_typeof(p_payload->'confidence') is distinct from 'number' or (p_payload->>'confidence')::numeric not between 0.9 and 1 or s not in ('yes','yeah','yep','sure','yes please','yes that''s okay','yes you can record','yes i agree','i agree','i consent','yes you may record') then return null;end if;
  r.consent_at:=t;r.consent_evidence:=jsonb_build_object('utterance',p_payload->>'utterance','confidence',p_payload->'confidence','source','twilio_gather_speech','disclosureVersion','owner-recorded-60s-v1');
 elsif p_action='claim_start' then
  if r.state<>'consent_pending' or r.consent_at is null or r.start_claimed_at is not null or r.end_requested_at is not null or t>r.call_started_at+interval '50 seconds' then return null;end if;r.start_claimed_at:=t;r.state:='starting';
 elsif p_action='started' then
  if r.start_claimed_at is null or r.consent_at is null or coalesce(p_payload->>'recordingSid','')!~'^RE[0-9a-fA-F]{32}$' or r.recording_sid is not null and r.recording_sid is distinct from p_payload->>'recordingSid' then return null;end if;
  started:=(p_payload->>'startedAt')::timestamptz;if not isfinite(started) or started<r.consent_at-interval '1 second' or started>t+interval '1 minute' then return null;end if;
  r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=started;r.audio_expires_at:=started+interval '720 hours';if r.end_requested_at is null then r.state:='recording';end if;
 elsif p_action='claim_register' then
  if r.state<>'recording' or r.recording_sid is null or r.registration_claimed_at is not null or r.end_requested_at is not null then return null;end if;r.registration_claimed_at:=t;
 elsif p_action='end_request' then r.end_requested_at:=coalesce(r.end_requested_at,t);if r.state not in ('available','deleted','declined','failed','absent') then r.state:='stopping';end if;
 elsif p_action='ended' then
  if r.call_sid is null or r.end_requested_at is null or r.call_sid is distinct from p_payload->>'callSid' or p_payload->>'accountSid' is distinct from r.configuration->'review'->>'providerAccountSid' or p_payload->>'status' not in ('completed','failed','busy','no-answer','canceled') then return null;end if;r.call_ended_at:=coalesce(r.call_ended_at,t);
 elsif p_action='contact_opt_out' then
  if r.start_claimed_at is not null then return null;end if;r.contact_opted_out:=true;r.state:='declined';
 elsif p_action in ('decline','fail') then
  if r.start_claimed_at is not null then return null;end if;r.state:=case when p_action='decline' then 'declined' else 'failed' end;r.last_error:=left(p_payload->>'reason',160);
 elsif p_action='conversation' then
  if r.registration_claimed_at is null or r.recording_sid is null or coalesce(p_payload->>'conversationId','')!~'^conv_[A-Za-z0-9]+$' or r.conversation_id is not null and r.conversation_id is distinct from p_payload->>'conversationId' then return null;end if;r.conversation_id:=p_payload->>'conversationId';
 elsif p_action='absent_audio' then
  if r.recording_sid is null or r.recording_sid is distinct from p_payload->>'recordingSid' or r.deleted_at is not null or r.end_requested_at is null then return null;end if;r.state:='absent';
 elsif p_action='completed_audio' then
  if r.recording_sid is null or p_payload->>'recordingSid' is distinct from r.recording_sid or jsonb_typeof(p_payload->'durationSeconds') is distinct from 'number' or (p_payload->>'durationSeconds')::numeric<>trunc((p_payload->>'durationSeconds')::numeric) or (p_payload->>'durationSeconds')::integer not between 0 and 60 then return null;end if;
  r.duration_seconds:=(p_payload->>'durationSeconds')::integer;r.recording_price_micros:=(p_payload->>'priceMicros')::bigint;r.state:='available';
 elsif p_action='settle' then
  amount:=(p_payload->>'totalMicros')::bigint;
  if r.call_ended_at is null or amount is null or amount<0 or jsonb_typeof(p_payload->'items') is distinct from 'array' or r.registration_claimed_at is not null and r.conversation_id is null then return null;end if;
  if jsonb_array_length(p_payload->'items') not between 2 and 6 or exists(select 1 from jsonb_array_elements(p_payload->'items') x where jsonb_typeof(x->'micros') is distinct from 'number' or (x->>'micros')::numeric<0 or (x->>'micros')::numeric<>trunc((x->>'micros')::numeric) or coalesce(x->>'provider','') not in ('twilio','elevenlabs') or coalesce(x->>'basis','') not in ('observed','estimated','not_applicable')) then return null;end if;
  if (select sum((x->>'micros')::bigint) from jsonb_array_elements(p_payload->'items') x) is distinct from amount then return null;end if;
  if p_payload->'carrier'->>'callSid' is distinct from r.call_sid or p_payload->'carrier'->>'accountSid' is distinct from r.configuration->'review'->>'providerAccountSid' or p_payload->'carrier'->>'from' is distinct from r.configuration->>'from_phone' or p_payload->'carrier'->>'to' is distinct from r.configuration->>'phone' or p_payload->'carrier'->>'currency' is distinct from 'USD' or coalesce(p_payload->'carrier'->>'status','') not in ('completed','failed','busy','no-answer','canceled') then return null;end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items') x where x->>'provider'='twilio' and x->>'label'='Call' and x->>'basis'='observed' and x->>'receipt'=r.call_sid and x->'micros'=p_payload->'carrier'->'priceMicros')<>1 then return null;end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items') x where x->>'provider'='elevenlabs' and case when r.registration_claimed_at is null then x->>'basis'='not_applicable' and (x->>'micros')::bigint=0 else x->>'basis'='observed' and x->>'receipt'=r.conversation_id end)<>1 then return null;end if;
  if r.settlement is not null then if r.settlement is distinct from p_payload then raise exception 'Owner cost receipt conflict';end if;return to_jsonb(r);end if;
  r.settled_micros:=amount;r.settlement:=p_payload;r.settled_at:=t;if amount>r.reserved_micros then r.last_error:='cost_exceeded_reviewed_allowance';end if;
 elsif p_action='deleted' then
  if r.recording_sid is null or r.audio_expires_at>t then return null;end if;r.deleted_at:=coalesce(r.deleted_at,t);r.state:='deleted';
 elsif p_action='retry' then r.last_error:=left(p_payload->>'reason',160);
 else raise exception 'Invalid owner recording transition';end if;
 update public.icash_owner_recording_test_runs set state=r.state,call_sid=r.call_sid,call_started_at=r.call_started_at,recording_sid=r.recording_sid,conversation_id=r.conversation_id,consent_at=r.consent_at,consent_evidence=r.consent_evidence,start_claimed_at=r.start_claimed_at,registration_claimed_at=r.registration_claimed_at,end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,provider_started_at=r.provider_started_at,audio_expires_at=r.audio_expires_at,duration_seconds=r.duration_seconds,recording_price_micros=r.recording_price_micros,settled_micros=r.settled_micros,settlement=r.settlement,settled_at=r.settled_at,deleted_at=r.deleted_at,last_error=r.last_error,contact_opted_out=r.contact_opted_out,row_version=row_version+1,updated_at=t,next_work_at=case when p_action='retry' then t+interval '1 minute' else t end where id=r.id returning * into r;return to_jsonb(r);
end $$;
create function public.icash_claim_owner_recording_work() returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_recording_test_runs;t timestamptz:=icash_owner_recording_private.clock_now();
begin
 select * into r from public.icash_owner_recording_test_runs where next_work_at<=t and (lease_until is null or lease_until<=t) and (call_ended_at is null or settled_at is null or recording_sid is not null and deleted_at is null and audio_expires_at<=t) order by next_work_at,id for update skip locked limit 1;
 if not found then return '[]';end if;
 update public.icash_owner_recording_test_runs set lease_token=gen_random_uuid(),lease_until=t+interval '2 minutes',row_version=row_version+1,updated_at=t where id=r.id returning * into r;return jsonb_build_array(to_jsonb(r));
end $$;
revoke all on all functions in schema icash_owner_recording_private from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_owner_recording_test(uuid,uuid,jsonb,uuid,text,text),public.icash_transition_owner_recording_test(uuid,bigint,text,jsonb),public.icash_claim_owner_recording_work() from public,anon,authenticated;
grant execute on function public.icash_claim_owner_recording_test(uuid,uuid,jsonb,uuid,text,text),public.icash_transition_owner_recording_test(uuid,bigint,text,jsonb),public.icash_claim_owner_recording_work() to service_role;
commit;
