-- Synthetic rows on the captured column types; no customer/provider data.
create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,state text,created_at timestamptz,paid_receipt jsonb,items jsonb,results jsonb);
create table icash_research_private.owner_batch_items(batch_id uuid,screening_id uuid,operation_key text);
create index fixture_progress_batch_item on icash_research_private.owner_batch_items(screening_id,operation_key);
create table icash_research_private.owner_exports(id uuid primary key,completed_at timestamptz,csv text,artifact_sha256 text,receipt jsonb);
create table public.icash_call_recordings(id uuid primary key,account_id uuid,voice_job_id uuid,operation_key text,call_sid text,dial_claimed_at timestamptz,provider_started_at timestamptz,state text,created_at timestamptz);
create table public.icash_voice_jobs(id uuid primary key,account_id uuid,operation_key text,provider_call_sid text,outcome text);
alter table public.icash_text_messages add column direction text,add column created_at timestamptz;
create index fixture_progress_research on public.icash_discovery_results(account_id,created_at desc);
create index fixture_progress_owner on public.icash_owner_contacts(account_id,created_at desc);
create unique index fixture_progress_owner_screening on public.icash_owner_contacts(screening_id);
create index fixture_progress_recording on public.icash_call_recordings(account_id,created_at desc);
create index fixture_progress_messages on public.icash_text_messages(account_id);
create index fixture_progress_operation on public.icash_operation_spend(account_id,created_at);
grant usage on schema public to service_role;
grant select on public.icash_call_recordings,public.icash_voice_jobs to service_role;
create function public.fixture_progress_evidence() returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('original',public.fixture_work_evidence(),
 'ownerContacts',(select jsonb_agg(to_jsonb(x) order by operation_key) from public.icash_owner_contacts x),
 'batches',(select jsonb_agg(to_jsonb(x) order by id) from icash_research_private.owner_batches x),
 'recordings',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_call_recordings x),
 'voiceJobs',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_voice_jobs x),
 'texts',(select jsonb_agg(to_jsonb(x) order by id) from public.icash_text_messages x));
$$;
