-- Additional offline downstream boundaries. Seller progress and signature
-- verification use their real SQL; no model, signing or message provider exists.
alter table icash_signing_envelopes add column terms_hash text,add column recipients jsonb,add column provider_evidence jsonb,add column updated_at timestamptz default now();
create table icash_handoffs(account_id uuid,screening_id uuid,state text);
create table icash_fulfillment_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid unique,purchase_envelope_id uuid,state text default 'ready',result jsonb,updated_at timestamptz default now());
create table icash_deal_journeys(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,state text default 'collecting',buyer_details jsonb,next_run_at timestamptz default now(),last_progress_at timestamptz default now(),updated_at timestamptz default now());
create table icash_title_requests(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,state text default 'ready',provider_id text,created_at timestamptz default now(),updated_at timestamptz default now());
create table icash_title_replies(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,sender_verified boolean default false,received_at timestamptz default now());
create table icash_closing_updates(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,reply_id uuid,kind text,effective_date date,amount_cents bigint,confirmed_by uuid,confirmation_source text,created_at timestamptz default now());
create table icash_proceeds_receipts(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,closing_update_id uuid,amount_cents bigint,received_date date,confirmed_by uuid,created_at timestamptz default now());
create table fixture_supervisor_flags(allowed boolean default true,fail_deal uuid);insert into fixture_supervisor_flags default values;
create function icash_journey_allowed(a uuid,d uuid) returns boolean language sql set search_path=public as $$select f.allowed and not a.bot_paused and d.stage in ('under_contract','buyer_selected','title_open','closing') from fixture_supervisor_flags f,icash_accounts a join icash_deal_files d on d.account_id=a.id where a.id=$1 and d.id=$2$$;
create function icash_journey_current(j uuid) returns boolean language sql set search_path=public as $$select icash_journey_allowed(account_id,deal_id) and state<>'needs_review' from icash_deal_journeys where id=j$$;
create table fixture_journey_actions(journey_id uuid primary key);
create function icash_advance_journey(j uuid) returns void language plpgsql set search_path=public as $$begin
 if exists(select 1 from icash_deal_journeys jn,fixture_supervisor_flags f where jn.id=j and jn.deal_id=f.fail_deal) then raise exception 'PRIVATE fixture failure';end if;
 insert into fixture_journey_actions values(j) on conflict do nothing;
 update icash_deal_journeys set next_run_at=now()+interval '15 minutes' where id=j;
end$$;
