-- Complements the account-work foundation with legacy handler evidence.
alter table icash_automation_tickets add column id uuid primary key default gen_random_uuid();
alter table icash_automation_tickets add column outcome text;
alter table icash_automation_tickets add column completed_at timestamptz;
create table icash_research_private.settings(id integer primary key,enabled boolean,stalled_search_continuation_enabled boolean,exclusions_enabled boolean);
insert into icash_research_private.settings values(1,true,true,false);
create table icash_research_private.requests(operation_key text);
create table icash_research_private.query_claims(operation_key text);
create table icash_discovery_filter_pages(operation_key text,account_id uuid,revision uuid,sequence integer,zip text,state text);
alter table icash_research_private.stalled_searches alter column request_id set not null;
create function icash_research_zip_known(text) returns boolean language sql stable as $$select $1 in ('75201','75202','75203')$$;
create function icash_inventory_scope_allowed(uuid,text) returns boolean language sql stable as $$select $2 in ('75201','75202')$$;
insert into icash_accounts(id,bot_paused) values('00000000-0000-4000-8000-000000000021',false);
insert into icash_wallets(account_id,balance_cents,reserved_cents) values('00000000-0000-4000-8000-000000000021',1000,0);
insert into icash_operation_rates(id,operation,version,enabled,expires_at,charge_cents)
 values('00000000-0000-4000-8000-000000000001','property_search','fixture-search',true,'2026-10-29 14:41:50.348487+00',100),
 ('00000000-0000-4000-8000-000000000002','owner_enrichment','fixture-contacts',true,'2026-10-29 14:41:50.348487+00',100);
insert into icash_operation_rates select (jsonb_populate_record(null::icash_operation_rates,to_jsonb(r)||jsonb_build_object(
 'id',case when r.operation='property_search' then '00000000-0000-4000-8000-000000000011' else '00000000-0000-4000-8000-000000000012' end,
 'version',version||':standing-research-20261026','expires_at','9999-12-31T23:59:59Z'))).* from icash_operation_rates r;
insert into icash_owner_review_private.changes(kind,record_key,before_row,after_row,authority)
 select 'rate',a.id::text,to_jsonb(a),to_jsonb(b),'fixture approval' from icash_operation_rates a join icash_operation_rates b on b.version=a.version||':standing-research-20261026';
insert into icash_discovery_configs(account_id,enabled,auto_enabled,contacts_enabled,rate_id,contact_rate_id,zip,revision,next_page,per_page,property_credit_micros,data_rights_until,next_run_at,research_version)
 values('00000000-0000-4000-8000-000000000021',true,true,true,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','75201','00000000-0000-4000-8000-000000000121',7,5,10000,'2026-10-29 14:41:50.348487+00',now()-interval '1 day',0);
insert into icash_research_private.account_rates values('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001');
insert into icash_inventory_markets(account_id,zip,priority,eligible_until)
 select '00000000-0000-4000-8000-000000000021',zip,1,'2026-10-29 14:41:50.348487+00'::timestamptz from unnest(array['75201','75202','75203'])zip;
insert into icash_operation_spend(operation_key,account_id,rate_id,state,charge_cap_cents,permission_until,created_at,dispatched_at)
 values('discovery:00000000-0000-4000-8000-000000000021:00000000-0000-4000-8000-000000000121:7','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000001','dispatched',100,'2026-10-29 14:41:50.348487+00','2026-10-24T12:00:30Z','2026-10-24T12:00:30Z');
insert into icash_automation_tickets(id,account_id,kind,state,outcome,created_at,expires_at,completed_at)
 values('00000000-0000-4000-8000-000000000221','00000000-0000-4000-8000-000000000021','discovery','held','held_for_reconciliation','2026-10-24T12:00:00Z','2026-10-24T12:02:00Z','2026-10-24T12:01:00Z');
