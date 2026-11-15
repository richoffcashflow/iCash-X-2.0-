-- Fictional identities and provider data. The base fixture executes the real
-- monetary reserve/claim/ledger and refresh scheduler; no network calls occur.
alter table icash_seller_recovery_private.contact_refreshes add column receipt_id uuid,add column successor_contact_id uuid;
alter table icash_research_private.requests add column finished_at timestamptz,add column result jsonb;

-- Produce the historical reservation through the real admission path first.
select public.icash_claim_seller_contact_refresh();
update icash_operation_rates set verified_at='2026-11-01T00:00:00Z';
update icash_operation_spend set created_at='2026-11-08T00:14:50Z',dispatched_at='2026-11-08T00:14:50Z';
update icash_research_private.requests set created_at='2026-11-08T00:14:50Z',finished_at='2026-11-08T00:14:53Z',
 result='{"outcome":"response","httpStatus":200,"returned":1,"creditsUsed":2}';
update icash_seller_recovery_private.contact_refreshes set requested_at='2026-11-08T00:14:52Z',response_at='2026-11-08T00:14:54Z',
 state='processed',outcome='cost_review',http_status=200,
 response='{"data":[{"input":{"number":"+12145550123"},"matched":true,"do_not_call":false}],"totals":{"submitted":1,"matched":1,"unmatched":0},"credits":{"used":2,"people":1,"deduplicated":1}}';

-- A second due gap in the original account must remain excluded. Independent
-- account two has two candidates to test fresh unknown/cost-review barriers.
insert into icash_accounts(id,owner_user_id,bot_paused) values('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000010',false);
insert into icash_wallets(account_id,balance_cents,reserved_cents) values('00000000-0000-4000-8000-000000000010',1000,0);
insert into icash_prospecting_budgets(id,account_id) values(2,'00000000-0000-4000-8000-000000000010');
insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,contact_rate_id,property_credit_micros,data_rights_until)
 select '00000000-0000-4000-8000-000000000010',enabled,auto_enabled,contacts_enabled,contact_rate_id,property_credit_micros,data_rights_until from icash_discovery_configs limit 1;
insert into icash_operational_contacts(id,account_id,phone) values('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000010','+12145550234');
insert into icash_text_threads(id,account_id,operational_contact_id) values('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011');
insert into icash_seller_gaps(id,account_id,reason,state,review_reason,stage,thread_id,due_at) values
 ('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','no_response','needs_review','contact_checks_expired','draft','00000000-0000-4000-8000-000000000003',now()-interval '1 hour'),
 ('00000000-0000-4000-8000-000000000014','00000000-0000-4000-8000-000000000010','no_response','needs_review','contact_checks_expired','draft','00000000-0000-4000-8000-000000000012',now()-interval '30 minutes'),
 ('00000000-0000-4000-8000-000000000015','00000000-0000-4000-8000-000000000010','no_response','needs_review','contact_checks_expired','draft','00000000-0000-4000-8000-000000000012',now()-interval '20 minutes');
update icash_seller_recovery_private.contact_refresh_policy set scan_due_at=null,scan_gap_id=null;
