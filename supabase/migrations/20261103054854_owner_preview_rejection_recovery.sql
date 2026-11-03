-- Explicit local-handler repair for the reviewed recorder credit-shape incident.
-- This preserves the original unknown preview body; it never invents phone proof.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table icash_research_private.owner_export_settings add column preview_rejection_recovery_enabled boolean not null default false;
alter table public.icash_owner_enrichment_recoveries drop constraint icash_owner_enrichment_recoveries_code_stage_check,
 add check(code_stage in ('owner_preview_pre_provider_local_rate_limit_v1','owner_preview_confirmed_early_cleanup_v1','owner_preview_local_record_rejection_v1'));
create table icash_research_private.preview_rejection_policy(
 id integer primary key check(id=1),reviewed_release text not null check(reviewed_release ~ '^[a-f0-9]{40}$'),
 deployment text not null check(deployment ~ '^dpl_[a-zA-Z0-9]{10,100}$'),
 handler_from timestamptz not null,handler_until timestamptz not null,
 recorder_hash text not null check(recorder_hash='27af55c3f732c75a9edddc287bfd8d29'),
 check(handler_until>handler_from and handler_until<=handler_from+interval '10 minutes')
);
-- No policy is enrolled by deployment. Exact reviewed release/deployment/window
-- enrollment is a separate operator action, and cannot subsequently be changed.
create table icash_research_private.preview_rejection_recoveries(
 ticket_id uuid primary key references public.icash_automation_tickets(id),
 request_id uuid not null unique references icash_research_private.requests(id),batch_id uuid not null unique,
 before_ticket jsonb not null,request jsonb not null,screening jsonb not null,configuration jsonb not null,rate jsonb not null,
 reviewed_release text not null,reviewed_trace jsonb not null,trace_hash text not null,
 recovered_at timestamptz not null default clock_timestamp()
);
alter table icash_research_private.preview_rejection_policy enable row level security;
alter table icash_research_private.preview_rejection_recoveries enable row level security;
revoke all on icash_research_private.preview_rejection_policy,icash_research_private.preview_rejection_recoveries from public,anon,authenticated,service_role;
create trigger preview_rejection_policy_immutable before update or delete on icash_research_private.preview_rejection_policy
 for each row execute function public.icash_immutable_owner_enrichment_recovery();
create trigger preview_rejection_recovery_immutable before update or delete on icash_research_private.preview_rejection_recoveries
 for each row execute function public.icash_immutable_owner_enrichment_recovery();

create function public.icash_recover_rejected_owner_preview(
 p_ticket uuid,p_request uuid,p_ticket_hash text,p_request_hash text,p_screening_hash text,p_config_hash text,p_rate_hash text,
 p_reviewed_release text,p_reviewed_trace jsonb
) returns boolean language plpgsql security definer set search_path='' set timezone='UTC' as $fn$
declare t public.icash_automation_tickets;r icash_research_private.requests;s public.icash_screening_jobs;
 c public.icash_discovery_configs;rate public.icash_operation_rates;policy icash_research_private.preview_rejection_policy;
 checked timestamptz;batch uuid;operation text;until_at timestamptz;trace_at timestamptz;finish_at timestamptz;source_hash text;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 if not exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preview_rejection_recovery_enabled) then return false;end if;
 select * into policy from icash_research_private.preview_rejection_policy where id=1;
 if not found or p_reviewed_release is distinct from policy.reviewed_release
  or md5(pg_get_functiondef('public.icash_record_empty_owner_preview(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure)) is distinct from policy.recorder_hash
  or jsonb_typeof(p_reviewed_trace) is distinct from 'object' or octet_length(p_reviewed_trace::text)>4096
  or p_reviewed_trace->>'evidenceKind' is distinct from 'reviewed_local_handler'
  or p_reviewed_trace->>'deployment' is distinct from policy.deployment
  or p_reviewed_trace->>'rpc' is distinct from 'icash_record_empty_owner_preview'
  or p_reviewed_trace->'rawPreviewAvailable' is distinct from 'false'::jsonb
  or p_reviewed_trace->'httpStatus' is distinct from '200'::jsonb
  or p_reviewed_trace->'responseBytes' is distinct from '5'::jsonb then return false;end if;
 trace_at:=(p_reviewed_trace->>'recordedAt')::timestamptz;finish_at:=(p_reviewed_trace->>'finishAt')::timestamptz;
 if trace_at is null or finish_at is null then return false;end if;
 select * into t from public.icash_automation_tickets where id=p_ticket for update;
 checked:=clock_timestamp();
 if not found or t.account_id='48dfb798-8c1a-404f-88c0-c396cc067062' or t.kind<>'contacts' or t.state<>'held'
  or t.outcome is distinct from 'held_for_reconciliation' or t.owner_preview_deferrals not between 0 and 7
  or t.completed_at<policy.handler_from or t.completed_at>policy.handler_until or t.completed_at is null
  or t.created_at>t.completed_at or t.completed_at>checked-interval '5 minutes' or t.expires_at>checked
  or encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') is distinct from p_ticket_hash
  or exists(select 1 from public.icash_owner_enrichment_recoveries where ticket_id=t.id or screening_id=t.screening_id)
  or exists(select 1 from icash_research_private.preview_rejection_recoveries where ticket_id=t.id or request_id=p_request)
 then return false;end if;
 perform 1 from public.icash_accounts where id=t.account_id and not bot_paused for update;
 if not found or not coalesce(public.icash_membership_work_allowed(t.account_id),false) then return false;end if;
 select * into r from icash_research_private.requests where id=p_request for share;
 if not found or md5(to_jsonb(r)::text) is distinct from p_request_hash or r.account_id is distinct from t.account_id
  or r.kind is distinct from 'owner_preview' or r.admitted is distinct from true or r.created_at is null or r.created_at<t.created_at or r.finished_at is null
  or r.finished_at<r.created_at or r.finished_at>t.completed_at or r.created_at>t.expires_at
  or r.operation_key is null or r.operation_key !~ '^owner-batch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or r.result->>'outcome' is distinct from 'response' or r.result->'httpStatus' is distinct from '200'::jsonb
  or r.result->'creditsUsed' is distinct from '0'::jsonb
  or r.result->'returned' not in ('1'::jsonb,'2'::jsonb,'3'::jsonb,'4'::jsonb,'5'::jsonb) or r.result->'returned' is null
  or trace_at<r.finished_at or trace_at>t.completed_at or trace_at<policy.handler_from or trace_at>policy.handler_until
  or finish_at<trace_at or finish_at>t.completed_at
 then return false;end if;
 batch:=split_part(r.operation_key,':',2)::uuid;
 if p_reviewed_trace->>'ticketId' is distinct from t.id::text or p_reviewed_trace->>'requestId' is distinct from r.id::text
  or p_reviewed_trace->>'accountId' is distinct from t.account_id::text or p_reviewed_trace->>'screeningId' is distinct from t.screening_id::text
  or p_reviewed_trace->>'batchId' is distinct from batch::text then return false;end if;
 -- The reviewed code commits this entire batch's paid admission before POST.
 -- Missing raw preview data is still unknown; absence here proves only that
 -- this finished local handler did not acquire a paid batch capability.
 if exists(select 1 from icash_research_private.owner_batches where id=batch)
  or exists(select 1 from icash_research_private.owner_batch_items where batch_id=batch)
  or exists(select 1 from icash_research_private.owner_exports where id=batch)
  or exists(select 1 from icash_research_private.requests where id<>r.id and (id=batch or operation_key=r.operation_key))
  or exists(select 1 from icash_research_private.owner_empty_preview_receipts where request_id=r.id or batch_id=batch)
  or exists(select 1 from icash_research_private.owner_export_preflights where account_id=t.account_id and created_at between t.created_at and t.completed_at)
  or (select count(*) from icash_research_private.requests where account_id=t.account_id and created_at between t.created_at and t.completed_at)<>1
  or exists(select 1 from public.icash_automation_tickets x where x.account_id=t.account_id and x.id<>t.id
   and x.kind in ('contacts','discovery') and x.created_at<=t.completed_at and coalesce(x.completed_at,x.expires_at)>=t.created_at)
  or exists(select 1 from public.icash_automation_tickets x where x.account_id=t.account_id and x.id<>t.id
   and ((x.state='issued' and x.expires_at>checked) or (x.state='consumed' and greatest(x.created_at,x.expires_at)>checked-interval '5 minutes')))
 then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=t.account_id for update;
 select * into rate from public.icash_operation_rates where id=c.contact_rate_id for share;
 select * into s from public.icash_screening_jobs where id=t.screening_id and account_id=t.account_id for share;
 source_hash:=public.icash_owner_enrichment_screening_hash(s);
 if c.account_id is null or rate.id is null or s.id is null or md5((to_jsonb(c)-'next_run_at')::text) is distinct from p_config_hash
  or md5(to_jsonb(rate)::text) is distinct from p_rate_hash or source_hash is distinct from p_screening_hash
  or not exists(select 1 from icash_owner_review_private.changes where kind='rate' and after_row=to_jsonb(rate) and recorded_at<=t.created_at)
  or s.completed_at>r.created_at or (s.snapshot->>'fetchedAt')::timestamptz>r.created_at
  or not coalesce(public.icash_owner_enrichment_retry_current(t.account_id,t.screening_id),false)
  or (t.owner_preview_screening_hash is not null and t.owner_preview_screening_hash is distinct from source_hash)
  or (t.owner_preview_deferrals>0 and (t.owner_preview_retry_until is null or t.owner_preview_screening_hash is null)) then return false;end if;
 until_at:=least(s.completed_at+interval '24 hours',(s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours',t.owner_preview_retry_until);
 if until_at<=checked then return false;end if;
 operation:='owners:'||t.account_id||':'||t.screening_id;
 insert into icash_research_private.preview_rejection_recoveries
 values(t.id,r.id,batch,to_jsonb(t),to_jsonb(r),to_jsonb(s),to_jsonb(c),to_jsonb(rate),p_reviewed_release,p_reviewed_trace,
  encode(sha256(convert_to(p_reviewed_trace::text,'UTF8')),'hex'),checked);
 insert into public.icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
 values(operation,t.id,t.account_id,t.screening_id,p_ticket_hash,source_hash,
  'Reviewed local recorder rejection after a finished free request; original response body unavailable, no historical phone-absence inference',
  encode(sha256(convert_to(jsonb_build_array(to_jsonb(t),to_jsonb(r),to_jsonb(s),to_jsonb(c),to_jsonb(rate),p_reviewed_release,p_reviewed_trace)::text,'UTF8')),'hex'),
  'owner_preview_local_record_rejection_v1',rate.charge_cents);
 -- Reuse the existing bounded family; only the normal issuer rotates token.
 update public.icash_automation_tickets set outcome='owner_preview_rate_limited',
  owner_preview_deferrals=greatest(1,owner_preview_deferrals),owner_preview_retry_after=greatest(checked,owner_preview_retry_after),
  owner_preview_retry_until=until_at,owner_preview_screening_hash=source_hash where id=t.id;
 update public.icash_discovery_configs set next_run_at=least(next_run_at,checked) where account_id=t.account_id;
 return true;
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then return false;
end $fn$;
revoke all on function public.icash_recover_rejected_owner_preview(uuid,uuid,text,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_recover_rejected_owner_preview(uuid,uuid,text,text,text,text,text,text,jsonb) to service_role;
commit;
