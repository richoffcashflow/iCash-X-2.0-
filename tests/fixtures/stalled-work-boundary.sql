-- Synthetic rows on captured schema, with read-only boundary dependencies.
create table fixture_work_policy(member boolean not null,candidate uuid);
insert into fixture_work_policy values(true,null);
create or replace function public.icash_membership_work_allowed(uuid) returns boolean language sql stable set search_path='' as $$select member from public.fixture_work_policy$$;
create function public.icash_enrichment_before_prospecting_budget(uuid) returns uuid language sql stable set search_path='' as $$select candidate from public.fixture_work_policy$$;
create function icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz) returns boolean language sql stable as $$select false$$;
grant select on fixture_work_policy to service_role;
insert into icash_accounts(id,owner_user_id,bot_paused,created_at,workspace_ack_version) values('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',false,now()-interval '2 days','fixture');
insert into icash_wallets(account_id,balance_cents,reserved_cents) values('00000000-0000-4000-8000-000000000001',250,0);
insert into icash_operation_rates(id,operation,enabled,expires_at,charge_cents) values
 ('00000000-0000-4000-8000-000000000002','property_search',true,now()+interval '1 day',300),
 ('00000000-0000-4000-8000-000000000003','owner_enrichment',true,now()+interval '1 day',100);
insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,rate_id,contact_rate_id,data_rights_until)
 values('00000000-0000-4000-8000-000000000001',true,true,true,'00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003',now()+interval '1 day');
insert into icash_operation_spend(operation_key,account_id,state,charge_cap_cents,created_at)
 select 'synthetic-original:'||n,'00000000-0000-4000-8000-000000000001','dispatched',10,now()-interval '1 day' from generate_series(1,9) n;
create function fixture_work_evidence() returns jsonb language sql stable set search_path=public as $$select jsonb_build_object(
 'operations',(select jsonb_agg(to_jsonb(o) order by operation_key) from icash_operation_spend o),
 'wallets',(select jsonb_agg(to_jsonb(w)) from icash_wallets w),
 'controls',(select jsonb_agg(to_jsonb(c)) from icash_control_events c),
 'receipts',(select jsonb_agg(to_jsonb(r)) from icash_discovery_results r))$$;
