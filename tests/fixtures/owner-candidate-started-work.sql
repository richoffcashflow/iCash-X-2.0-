-- Extend the existing isolated preflight fixture for the installed selector.
alter table public.icash_automation_tickets
 add column id uuid default gen_random_uuid(),add column account_id uuid,
 add column kind text default 'contacts',add column state text default 'held',
 add column outcome text,add column issue_attempts integer default 1,
 add column owner_preview_deferrals integer default 0,
 add column owner_preview_retry_after timestamptz,add column owner_preview_retry_until timestamptz,
 add column owner_preview_screening_hash text;
create function public.icash_opportunity_score(uuid,jsonb,text) returns numeric language sql as $$select coalesce(($2->>'score')::numeric,0)$$;
create function public.icash_owner_enrichment_screening_hash(public.icash_screening_jobs) returns text language sql as $$select md5(to_jsonb($1)::text)$$;
create function public.icash_owner_enrichment_retry_current(uuid,uuid) returns boolean language sql as $$
 select not bot_paused from public.icash_accounts where id=$1
$$;
