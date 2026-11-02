-- Explicit, source-bound recovery for pre-request-ledger searches. Local handler
-- evidence is preserved as local evidence, never fabricated provider proof.
begin;
set local lock_timeout='5s';
alter table icash_research_private.settings add column legacy_continuation_enabled boolean not null default false;
alter table icash_research_private.stalled_searches alter column request_id drop not null;
alter table icash_research_private.stalled_searches add column legacy_evidence jsonb;
alter table icash_research_private.stalled_searches add constraint stalled_search_source_required check((
 (request_id is not null and legacy_evidence is null) or
 (request_id is null and legacy_evidence is not null and legacy_evidence->>'policy'='legacy-handler-v1'
  and jsonb_typeof(legacy_evidence->'ticket')='object' and legacy_evidence->'ticket'->>'id' is not null)) is true);

create function public.icash_continue_legacy_research(p_account uuid,p_operation text,p_config_hash text,p_operation_hash text,p_ticket uuid) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $fn$
declare c public.icash_discovery_configs;o public.icash_operation_spend;t public.icash_automation_tickets;
 m public.icash_inventory_markets;quote bigint;after_value jsonb;
 old_until constant timestamptz:='2026-10-29 14:41:50.348487+00';
begin
 if not exists(select 1 from icash_research_private.settings where id=1 and enabled and legacy_continuation_enabled
  and stalled_search_continuation_enabled and not exclusions_enabled) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or p_account='48dfb798-8c1a-404f-88c0-c396cc067062'
  or not public.icash_membership_work_allowed(p_account)
  or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from public.icash_support_cancel_requests where account_id=p_account and confirmed_at is not null)
  then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or md5(to_jsonb(c)::text) is distinct from p_config_hash or not c.enabled or not c.auto_enabled or not c.contacts_enabled
  or c.research_version is distinct from 0 or c.research_list_id is not null or c.data_rights_until is distinct from old_until
  or p_operation is distinct from 'discovery:'||p_account||':'||c.revision||':'||c.next_page then return false;end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update skip locked;
 if not found or md5((to_jsonb(o)-array['estimate_checked_at','financial_checked_at'])::text) is distinct from p_operation_hash
  or o.state is distinct from 'dispatched' or o.rate_id is distinct from c.rate_id or o.permission_until is distinct from old_until
  or o.dispatched_at is null or o.dispatched_at>='2026-10-25T00:00:00Z' or o.dispatched_at>now()-interval '1 day'
  or o.created_at<>o.dispatched_at
  or exists(select 1 from public.icash_discovery_results where operation_key=p_operation)
  or exists(select 1 from public.icash_cost_observations where provider='dealmachine' and event_key=p_operation)
  or exists(select 1 from icash_research_private.requests where operation_key=p_operation)
  or exists(select 1 from icash_research_private.query_claims where operation_key=p_operation)
  or exists(select 1 from public.icash_discovery_filter_pages where operation_key=p_operation and
   (account_id is distinct from p_account or revision is distinct from c.revision or sequence is distinct from c.next_page or zip is distinct from c.zip or state is distinct from 'claimed'))
  or exists(select 1 from public.icash_operation_spend x join public.icash_operation_rates r on r.id=x.rate_id
   where x.account_id=p_account and r.operation='property_search' and x.state in ('reserved','dispatched') and x.operation_key<>p_operation
    and not exists(select 1 from icash_research_private.stalled_searches s where s.operation_key=x.operation_key and s.account_id=p_account and s.zip<>c.zip))
  or exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind in ('discovery','contacts')
   and (state='issued' and expires_at>now() or state='consumed' and greatest(created_at,expires_at)>now()-interval '5 minutes'))
  then return false;end if;
 select * into t from public.icash_automation_tickets where id=p_ticket and account_id=p_account and kind='discovery'
  and state='held' and outcome='held_for_reconciliation' and created_at<=o.dispatched_at and expires_at>=o.dispatched_at
  and completed_at>=o.dispatched_at and completed_at<=now()-interval '1 day' for update skip locked;
 if not found or (select count(*) from public.icash_automation_tickets where account_id=p_account and kind='discovery'
  and state='held' and outcome='held_for_reconciliation' and created_at<=o.dispatched_at and expires_at>=o.dispatched_at
  and completed_at>=o.dispatched_at)<>1 then return false;end if;
 select public.icash_research_admission_quote(p_account,'property_search',charge_cents) into quote
  from public.icash_operation_rates where id=c.rate_id and operation='property_search' and enabled and expires_at=old_until;
 if quote is null or public.icash_prospecting_available(p_account)<quote
  or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents) then return false;end if;
 -- Existing saved markets only: no expansion and no renewal of arbitrary rights.
 select * into m from public.icash_inventory_markets where account_id=p_account and zip<>c.zip and eligible_until=old_until
  and public.icash_research_zip_known(zip) and public.icash_inventory_scope_allowed(p_account,zip)
  and not exists(select 1 from icash_research_private.stalled_searches s where s.account_id=p_account and s.zip=icash_inventory_markets.zip)
  order by priority,zip for update skip locked limit 1;
 if not found then return false;end if;
 insert into icash_research_private.stalled_searches(operation_key,account_id,request_id,zip,configuration,legacy_evidence)
 values(p_operation,p_account,null,c.zip,to_jsonb(c),jsonb_build_object('policy','legacy-handler-v1','operation',to_jsonb(o),
  'ticket',jsonb_build_object('id',t.id,'account_id',t.account_id,'kind',t.kind,'state',t.state,'outcome',t.outcome,
   'created_at',t.created_at,'expires_at',t.expires_at,'completed_at',t.completed_at),
  'authority','Owner repair 2026-11-02; preserve original unknown operation, money and ZIP; independent work only'));
 update public.icash_discovery_configs set zip=m.zip,revision=gen_random_uuid(),next_page=1,research_list_id=null,
  exhausted=false,next_run_at=now() where account_id=p_account returning to_jsonb(icash_discovery_configs.*) into after_value;
 insert into icash_owner_review_private.changes(kind,record_key,before_row,after_row,authority)
 values('legacy_search_continuation',p_account::text,to_jsonb(c),after_value,'Exact reviewed legacy handler; original source ZIP and all unknown money remain held');
 -- This existing function verifies the immutable standing rate lineage. Any
 -- mismatch rolls back the quarantine and cursor change together.
 if not public.icash_repair_standing_research(p_account) then raise exception 'Standing research lineage unavailable';end if;
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=m.zip;
 return true;
end $fn$;
revoke all on function public.icash_continue_legacy_research(uuid,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_continue_legacy_research(uuid,text,text,text,uuid) to service_role;
commit;
