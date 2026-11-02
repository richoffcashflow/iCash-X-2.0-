-- Explicit reviewed repair for free lists cleaned before their deferred handler.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table icash_research_private.owner_export_settings add column cleanup_ticket_recovery_enabled boolean not null default false;
alter table public.icash_owner_enrichment_recoveries drop constraint icash_owner_enrichment_recoveries_code_stage_check,
 add check(code_stage in ('owner_preview_pre_provider_local_rate_limit_v1','owner_preview_confirmed_early_cleanup_v1'));
create table icash_research_private.cleanup_ticket_recoveries(
 ticket_id uuid primary key references public.icash_automation_tickets(id),
 preflight_id uuid not null references icash_research_private.owner_export_preflights(id),
 before_ticket jsonb not null,preflight jsonb not null,configuration jsonb not null,rate jsonb not null,
 recovered_at timestamptz not null default clock_timestamp()
);
alter table icash_research_private.cleanup_ticket_recoveries enable row level security;
revoke all on icash_research_private.cleanup_ticket_recoveries from public,anon,authenticated,service_role;
grant select on icash_research_private.cleanup_ticket_recoveries to service_role;
create trigger cleanup_ticket_recovery_immutable before update or delete on icash_research_private.cleanup_ticket_recoveries
 for each row execute function public.icash_immutable_owner_enrichment_recovery();
create function public.icash_recover_cleaned_owner_ticket(p_ticket uuid,p_preflight uuid,p_ticket_hash text,p_preflight_hash text,p_config_hash text,p_rate_hash text)
returns boolean language plpgsql security definer set search_path='' as $fn$
declare t public.icash_automation_tickets;p icash_research_private.owner_export_preflights;
 c public.icash_discovery_configs;r public.icash_operation_rates;s public.icash_screening_jobs;item jsonb;operation text;
begin
 if not exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled and preflight_renewal_enabled and cleanup_ticket_recovery_enabled) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 select * into t from public.icash_automation_tickets where id=p_ticket for update;
 if not found or t.account_id='48dfb798-8c1a-404f-88c0-c396cc067062' or t.kind<>'contacts' or t.state<>'held' or t.outcome is distinct from 'held'
  or t.owner_preview_deferrals not between 1 and 7 or t.completed_at is null or t.completed_at>now()-interval '5 minutes'
  or t.expires_at>now() or t.owner_preview_retry_until<=now() or t.owner_preview_retry_until is null
  or public.icash_owner_enrichment_ticket_hash(t) is distinct from p_ticket_hash then return false;end if;
 perform 1 from public.icash_accounts where id=t.account_id and not bot_paused for update;
 if not found or not coalesce(public.icash_membership_work_allowed(t.account_id),false) then return false;end if;
 select * into p from icash_research_private.owner_export_preflights where id=p_preflight for update;
 if not found or md5(to_jsonb(p)::text) is distinct from p_preflight_hash
  or not coalesce(icash_research_private.owner_preflight_renewable(p.id),false)
  or (p.account_id=t.account_id and p.items->0->>'screeningId'=t.screening_id::text and p.state='waiting'
   and p.created_at<=t.completed_at and p.deleted_at between p.created_at and t.completed_at
   and p.deleted_at<p.created_at+interval '30 minutes' and p.checked_at is null and p.list_id is not null
   and p.receipts->'create'->'httpStatus'='200'::jsonb and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
   and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
   and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
   and p.receipts->'create'->'raw'->'data'->>'status'='completed'
   and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(jsonb_array_length(p.request->'people_ids'))
   and not(p.receipts ?| array['baseline','eligible'])
   and not exists(select 1 from icash_research_private.owner_export_preflights child where child.supersedes=p.id)) is distinct from true then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=t.account_id for update;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id for share;
 if c.account_id is null or r.id is null or md5((to_jsonb(c)-'next_run_at')::text) is distinct from p_config_hash
  or md5(to_jsonb(r)::text) is distinct from p_rate_hash
  or not exists(select 1 from icash_owner_review_private.changes where kind='rate' and after_row=to_jsonb(r) and recorded_at<=p.created_at)
  or not coalesce(public.icash_owner_enrichment_retry_current(t.account_id,t.screening_id),false)
  or not coalesce(public.icash_owner_export_people_available(p.request->'people_ids'),false) then return false;end if;
 select * into s from public.icash_screening_jobs where id=t.screening_id and account_id=t.account_id for share;
 if s.id is null or public.icash_owner_enrichment_screening_hash(s) is distinct from t.owner_preview_screening_hash then return false;end if;
 for item in select value from jsonb_array_elements(p.items) loop
  if not exists(select 1 from public.icash_screening_jobs j where j.id=(item->>'screeningId')::uuid and j.account_id=t.account_id and j.snapshot=item->'snapshot')
   or not coalesce(public.icash_owner_enrichment_retry_current(t.account_id,(item->>'screeningId')::uuid),false)
   or coalesce(p.request->'mobile_only','false'::jsonb) is distinct from to_jsonb(public.icash_owner_targeting_pool(t.account_id,(item->>'screeningId')::uuid)='mobile') then return false;end if;
 end loop;
 operation:='owners:'||t.account_id||':'||t.screening_id;
 if exists(select 1 from public.icash_owner_enrichment_recoveries where operation_key=operation or ticket_id=t.id or screening_id=t.screening_id) then return false;end if;
 insert into icash_research_private.cleanup_ticket_recoveries values(t.id,p.id,to_jsonb(t),to_jsonb(p),to_jsonb(c),to_jsonb(r),clock_timestamp());
 insert into public.icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
 values(operation,t.id,t.account_id,t.screening_id,p_ticket_hash,t.owner_preview_screening_hash,
  'Confirmed free-list cleanup preceded its held deferred handler; exact original evidence retained privately',
  encode(sha256(convert_to(jsonb_build_array(to_jsonb(t),to_jsonb(p),to_jsonb(c),to_jsonb(r))::text,'UTF8')),'hex'),
  'owner_preview_confirmed_early_cleanup_v1',r.charge_cents);
 update public.icash_automation_tickets set outcome='owner_preview_rate_limited',owner_preview_retry_after=clock_timestamp() where id=t.id;
 update public.icash_discovery_configs set next_run_at=least(next_run_at,clock_timestamp()) where account_id=t.account_id;
 return true;
end $fn$;
revoke all on function public.icash_recover_cleaned_owner_ticket(uuid,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_recover_cleaned_owner_ticket(uuid,uuid,text,text,text,text) to service_role;
commit;
