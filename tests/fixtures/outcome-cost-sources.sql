-- Supplemental synthetic columns used by the actual outcome-source SQL.
-- Load shared-learning-schema.sql and seller-contact-cost-sources.sql first.
create schema if not exists icash_research_private;
create table public.icash_discovery_inventory_receipts(operation_key text,account_id uuid,property_ids text[],returned_properties integer,created_at timestamptz);
create table public.icash_discovery_results(operation_key text,account_id uuid,result jsonb,created_at timestamptz);
create table public.icash_owner_contacts(screening_id uuid,account_id uuid,operation_key text,result jsonb,created_at timestamptz);
create table icash_research_private.owner_batches(id uuid,account_id uuid,primary_screening uuid,created_at timestamptz,state text,items jsonb,preview_receipt jsonb,paid_receipt jsonb,results jsonb);
create table icash_research_private.owner_batch_items(screening_id uuid,batch_id uuid,operation_key text);
create table public.icash_seller_matches(lead_id uuid,account_id uuid,screening_id uuid,operation_key text,assigned_at timestamptz);
create table public.icash_seller_research_refreshes(id uuid,lead_id uuid,claimed_at timestamptz,completed_at timestamptz,state text,applied_screenings uuid[]);
create table icash_research_private.requests(id uuid,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz,finished_at timestamptz,result jsonb);
create table public.icash_title_requests(id uuid,account_id uuid,deal_id uuid,state text,provider_id text,created_at timestamptz,updated_at timestamptz);
create table public.icash_title_tasks(id uuid,account_id uuid,deal_id uuid,request_id uuid,kind text,email_state text,email_provider_id text,created_at timestamptz,updated_at timestamptz);
create table public.icash_title_search_results(operation_key text,account_id uuid,deal_id uuid,created_at timestamptz);
create table public.icash_title_qualification_jobs(id uuid,account_id uuid,state text,provider_id text,created_at timestamptz,updated_at timestamptz);
create table icash_learning_private.title_qualification_origins(job_id uuid,account_id uuid,deal_id uuid,screening_id uuid,property_id text,assigned_at timestamptz);
create table icash_learning_private.title_qualification_reuses(job_id uuid,account_id uuid,deal_id uuid,screening_id uuid,property_id text,reused_at timestamptz);
