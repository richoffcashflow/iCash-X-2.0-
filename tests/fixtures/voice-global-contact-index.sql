-- Synthetic disposable inputs for the verbatim captured view and slot guard.
-- Capacity is stubbed open only here; this fixture cannot prove paid admission.
do $$begin
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
end$$;
create schema icash_recording_private;
create table public.icash_contact_permissions(
 id uuid primary key,account_id uuid,screening_id uuid,party text default 'seller',phone text,
 contact_key text,timezone text,local_start_hour int,local_end_hour int,permission_evidence text,
 permission_until timestamptz default now()+interval '1 day',dnc_checked_at timestamptz,dnc_clear boolean,
 revoked_at timestamptz,buyer_id uuid,review_request_id uuid,seller_intake_id uuid
);
create table public.icash_dnc_verification_receipts(id uuid primary key,checked_at timestamptz default now(),clear boolean default true);
create table public.icash_operational_contacts(
 id uuid primary key,account_id uuid,screening_id uuid,phone text,contact_key text,timezone text,
 local_start_hour int,local_end_hour int,eligibility_until timestamptz default now()+interval '1 day',
 revoked_at timestamptz,dnc_receipt_id uuid,channel text default 'voice',source_hash text,
 preserved_receipt jsonb default '{"original":"synthetic immutable source"}'::jsonb
);
create unique index icash_operational_contacts_account_id_screening_id_channel__key
 on public.icash_operational_contacts(account_id,screening_id,channel,phone,source_hash,dnc_receipt_id);
create unique index icash_contact_permissions_account_id_screening_id_party_con_key
 on public.icash_contact_permissions(account_id,screening_id,party,contact_key);
create index icash_contact_permissions_phone_route on public.icash_contact_permissions(phone,account_id,screening_id);
create table public.icash_voice_jobs(
 id uuid primary key,account_id uuid,permission_id uuid,operational_contact_id uuid,state text default 'ready',outcome text,
 preserved_receipt jsonb default '{"provider":"unknown","charged":null}'::jsonb
);
create index icash_voice_jobs_active_slot on public.icash_voice_jobs(account_id,permission_id,operational_contact_id)
 where state in ('issued','dispatching') or state='held' and outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry');
create table public.icash_voice_configs(account_id uuid primary key,agent_id text default 'offline_agent');
create table public.icash_live_conversations(id uuid primary key,account_id uuid,contact_key text,state text);
create function icash_recording_private.voice_capacity_from_snapshot(uuid,text,text,text,boolean,jsonb)
 returns boolean language sql stable set search_path='' as $$select true$$;
create table public.fixture_voice_contact_cases(label text primary key,job_id uuid,account_id uuid,contact_key text,expected_busy boolean,expected_slot boolean,target_id uuid);

insert into public.icash_dnc_verification_receipts(id) select md5('ordinary-dnc-'||n)::uuid from generate_series(1,30654) n;
insert into public.icash_operational_contacts(id,account_id,screening_id,phone,contact_key,dnc_receipt_id,source_hash)
 select md5('ordinary-contact-'||n)::uuid,md5('account-'||(n%100))::uuid,md5('screening-'||n)::uuid,
  '+1555'||lpad(n::text,7,'0'),'ordinary-key-'||n,md5('ordinary-dnc-'||n)::uuid,md5('source-'||n)
 from generate_series(1,30654) n;
insert into public.icash_contact_permissions(id,account_id,screening_id,contact_key)
 select md5('ordinary-permission-'||n)::uuid,md5('account-'||(n%100))::uuid,md5('screening-'||n)::uuid,'legacy-key-'||n
 from generate_series(1,1000) n;
insert into public.icash_voice_jobs(id,account_id,operational_contact_id,state,outcome)
 select md5('ordinary-job-'||n)::uuid,md5('account-'||(n%30654%100))::uuid,
  md5('ordinary-contact-'||((n-1)%30654+1))::uuid,'complete','original_terminal_receipt'
 from generate_series(1,300000) n;
insert into public.icash_voice_jobs(id,account_id,operational_contact_id,state,outcome)
 select md5('active-job-'||n)::uuid,md5('account-'||(n%100))::uuid,
  md5('ordinary-contact-'||n)::uuid,'held','provider_outcome_unknown_no_retry'
 from generate_series(1,191) n;

create function public.fixture_voice_contact_case(p_label text,p_mode text,p_state text default 'held',p_outcome text default 'provider_outcome_unknown_no_retry',p_busy boolean default true,p_slot boolean default false)
 returns void language plpgsql as $$
declare
 candidate uuid:=md5('candidate-'||p_label)::uuid;account uuid:=md5('candidate-account')::uuid;
 other_account uuid:=md5('other-account')::uuid;busy uuid:=md5('busy-'||p_label)::uuid;
 candidate_contact uuid:=md5('candidate-contact-'||p_label)::uuid;busy_contact uuid:=md5('busy-contact-'||p_label)::uuid;
 contact text:='case-'||p_label;
begin
 insert into public.icash_voice_configs(account_id) values(account) on conflict do nothing;
 insert into public.icash_dnc_verification_receipts(id) values(candidate_contact),(busy_contact);
 insert into public.icash_operational_contacts(id,account_id,contact_key,dnc_receipt_id)
  values(candidate_contact,account,contact,candidate_contact),(busy_contact,other_account,contact,busy_contact);
 insert into public.icash_voice_jobs(id,account_id,operational_contact_id,state,outcome)
  values(candidate,account,candidate_contact,'ready',null),(busy,other_account,busy_contact,p_state,p_outcome);
 if p_mode='legacy' then
  insert into public.icash_contact_permissions(id,account_id,contact_key) values(busy_contact,other_account,contact);
  update public.icash_voice_jobs set permission_id=busy_contact,operational_contact_id=null where id=busy;
 elsif p_mode='same_account' then
  update public.icash_operational_contacts set account_id=account where id=busy_contact;
  update public.icash_voice_jobs set account_id=account where id=busy;
 elsif p_mode='wrong_busy_account' then update public.icash_voice_jobs set account_id=account where id=busy;
 elsif p_mode='both_sources' then update public.icash_voice_jobs set permission_id=busy_contact where id=busy;
 elsif p_mode='neither_source' then update public.icash_voice_jobs set operational_contact_id=null where id=busy;
 elsif p_mode='wrong_source' then update public.icash_voice_jobs set permission_id=busy_contact,operational_contact_id=null where id=busy;
 elsif p_mode='missing_dnc' then delete from public.icash_dnc_verification_receipts where id=busy_contact;
 elsif p_mode='dnc_not_clear' then update public.icash_dnc_verification_receipts set clear=false,checked_at=now()-interval '2 years' where id=busy_contact;
 elsif p_mode='revoked_expired' then update public.icash_operational_contacts set revoked_at=now()-interval '1 year',eligibility_until=now()-interval '1 year' where id=busy_contact;
 elsif p_mode='not_voice' then update public.icash_operational_contacts set channel='sms' where id=busy_contact;
 elsif p_mode='candidate_wrong_account' then update public.icash_operational_contacts set account_id=other_account where id=candidate_contact;
 elsif p_mode='candidate_both_sources' then update public.icash_voice_jobs set permission_id=candidate_contact where id=candidate;
 elsif p_mode='candidate_wrong_source' then update public.icash_voice_jobs set permission_id=candidate_contact,operational_contact_id=null where id=candidate;
 elsif p_mode='candidate_missing_dnc' then delete from public.icash_dnc_verification_receipts where id=candidate_contact;
 elsif p_mode='candidate_not_voice' then update public.icash_operational_contacts set channel='sms' where id=candidate_contact;
 elsif p_mode='candidate_legacy' then
  insert into public.icash_contact_permissions(id,account_id,contact_key) values(candidate_contact,account,contact);
  update public.icash_voice_jobs set permission_id=candidate_contact,operational_contact_id=null where id=candidate;
 elsif p_mode in ('live_waiting','live_review') then
  insert into public.icash_live_conversations values(md5('live-'||p_label)::uuid,other_account,contact,replace(p_mode,'live_',''));
 end if;
 insert into public.fixture_voice_contact_cases values(p_label,candidate,account,contact,p_busy,p_slot,candidate_contact);
end$$;
select public.fixture_voice_contact_case(label,mode,state,outcome,busy,slot) from (values
 ('unmatched','none','complete','original_terminal_receipt',false,true),
 ('cross_account_unknown','operational','held','provider_outcome_unknown_no_retry',true,false),
 ('cross_account_reconciliation','operational','held','provider_receipt_needs_reconciliation',true,false),
 ('cross_account_issued','operational','issued',null,true,false),
 ('cross_account_dispatching','operational','dispatching',null,true,false),
 ('legacy_unknown','legacy','held','provider_outcome_unknown_no_retry',true,false),
 ('same_account_unknown','same_account','held','provider_outcome_unknown_no_retry',true,false),
 ('wrong_busy_account','wrong_busy_account','held','provider_outcome_unknown_no_retry',false,true),
 ('both_sources','both_sources','held','provider_outcome_unknown_no_retry',false,true),
 ('neither_source','neither_source','held','provider_outcome_unknown_no_retry',false,true),
 ('wrong_source','wrong_source','held','provider_outcome_unknown_no_retry',false,true),
 ('missing_dnc','missing_dnc','held','provider_outcome_unknown_no_retry',false,true),
 ('dnc_not_clear','dnc_not_clear','held','provider_outcome_unknown_no_retry',true,false),
 ('revoked_expired','revoked_expired','held','provider_outcome_unknown_no_retry',true,false),
 ('not_voice','not_voice','held','provider_outcome_unknown_no_retry',false,true),
 ('ordinary_held','operational','held','production_agent_review_required',false,true),
 ('terminal','operational','complete','original_terminal_receipt',false,true),
 ('ready','operational','ready',null,false,true),
 ('candidate_wrong_account','candidate_wrong_account','complete',null,false,false),
 ('candidate_both_sources','candidate_both_sources','complete',null,false,false),
 ('candidate_wrong_source','candidate_wrong_source','complete',null,false,false),
 ('candidate_missing_dnc','candidate_missing_dnc','complete',null,false,false),
 ('candidate_not_voice','candidate_not_voice','complete',null,false,false),
 ('candidate_legacy','candidate_legacy','complete',null,false,true),
 ('live_waiting','live_waiting','complete',null,false,false),
 ('live_review','live_review','complete',null,false,false)
) cases(label,mode,state,outcome,busy,slot);
-- Sample the full synthetic status distribution consistently: only about 200
-- of 300,000 jobs are busy. Default sampling otherwise changes join order
-- between runs. This fixture statistic setting is never installed in production.
alter table public.icash_voice_jobs alter column state set statistics 1000;
alter table public.icash_voice_jobs alter column outcome set statistics 1000;
analyze;
