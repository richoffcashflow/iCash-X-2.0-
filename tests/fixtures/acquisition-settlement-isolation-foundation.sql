-- Synthetic dependency boundaries shared by local and native fixtures.
 alter table icash_automation_tickets add column id uuid primary key default gen_random_uuid(),
  add column token text unique default gen_random_uuid()::text||gen_random_uuid()::text,
  add column screening_id uuid unique,add column outcome text,add column completed_at timestamptz,
  add column owner_preview_deferrals int default 0,add column owner_preview_retry_until timestamptz,
  add column issue_attempts int default 1,
  add constraint icash_automation_tickets_kind_check check(kind<>'account_reconcile');
 alter table icash_automation_tickets alter column state set default 'issued',
  alter column created_at set default now(),alter column expires_at set default now()+interval '2 minutes';
 create table fixture_acquisition(quota boolean,search_due boolean,backlog int);insert into fixture_acquisition values(true,true,0);
 create function icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable as $$select quota from public.fixture_acquisition$$;
 create function icash_new_user_request_reserve_eligible(uuid) returns boolean language sql stable as $$select false$$;
 create function icash_owner_active_export_capacity(uuid) returns text language sql stable as $$select 'export_busy'::text$$;
 create function icash_owner_preflight_due_at(uuid,uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function icash_owner_retry_due_at(uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
 create function icash_daily_work_target(uuid) returns jsonb language sql stable as $$select '{"priorityRatio":1}'::jsonb$$;
 create function icash_owner_enrichment_unstarted(uuid,uuid,text) returns boolean language sql stable as $$select false$$;
 create function icash_prepare_research_efficiency(uuid) returns void language sql as $$select null::void$$;
 create function icash_refresh_opportunity_outcomes(uuid) returns void language sql as $$select null::void$$;
 create function icash_pending_opportunity_count(uuid) returns integer language sql stable as $$select backlog from public.fixture_acquisition$$;
 create function icash_outbound_search_due(uuid) returns boolean language sql stable as $$select search_due from public.fixture_acquisition$$;
 create function icash_enrichment_candidate(uuid) returns uuid language sql stable as $$select null::uuid$$;
