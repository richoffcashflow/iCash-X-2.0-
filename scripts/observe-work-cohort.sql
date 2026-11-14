-- Read-only fixed-membership observation. Render with work-cohort.mjs; never remove exited members.
begin read only;
with fixed_members as (select value::uuid id from jsonb_array_elements_text($icash_cohort$__ICASH_COHORT_IDS__$icash_cohort$::jsonb)), cohort as materialized (
 select fixed_members.id,a.created_at,a.bot_paused,a.workspace_ack_version is not null acknowledged,
 w.balance_cents,w.reserved_cents,public.icash_membership_work_allowed(a.id) membership_allowed,
 public.icash_prospecting_available(a.id) prospecting_available_cents,
 d.enabled,d.auto_enabled,d.contacts_enabled,d.data_rights_until,d.next_run_at,
 sr.enabled search_enabled,cr.enabled contact_enabled,sr.expires_at search_expires,cr.expires_at contact_expires,
 public.icash_research_admission_quote(a.id,'property_search',sr.charge_cents) search_minimum,
 public.icash_research_admission_quote(a.id,'owner_enrichment',cr.charge_cents) contact_minimum,
 control.action control_action,control.created_at control_at,
 exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null) billing_review,
 exists(select 1 from public.icash_support_cancel_requests where account_id=a.id and confirmed_at is not null and confirmed_at>coalesce(control.created_at,'-infinity'::timestamptz)) cancellation,
 funding.first_funded_at,funding.last_funded_at,
 h.reason monitor_reason,h.since monitor_since,h.checked_at monitor_checked_at
 from fixed_members left join public.icash_accounts a on a.id=fixed_members.id left join public.icash_wallets w on w.account_id=a.id
 left join public.icash_discovery_configs d on d.account_id=a.id
 left join public.icash_operation_rates sr on sr.id=d.rate_id
 left join public.icash_operation_rates cr on cr.id=d.contact_rate_id
 left join icash_reliability_private.account_work_states h on h.account_id=a.id
 left join lateral(select action,created_at from public.icash_control_events where account_id=a.id and property_id is null order by created_at desc,id desc limit 1) control on true
 left join lateral(select min(credited_at) first_funded_at,max(credited_at) last_funded_at from public.icash_funding_orders where account_id=a.id and mode='live' and state='paid' and credited_at is not null) funding on true

), measured as (
select c.*,
 case when membership_allowed and not bot_paused and acknowledged and not billing_review and not cancellation
 and enabled and auto_enabled and contacts_enabled and data_rights_until>now() and search_enabled and contact_enabled and least(search_expires,contact_expires)>now()
 then public.icash_enrichment_before_prospecting_budget(id) end enrichment_candidate,
 (select jsonb_build_object('pending',count(*) filter(where state in ('reserved','dispatched')),'oldest_pending',min(coalesce(dispatched_at,created_at)) filter(where state in ('reserved','dispatched')),'last_settlement',max(settled_at) filter(where state='settled'),'settled_24h',count(*) filter(where state='settled' and settled_at>=now()-interval '24 hours'),'settled_30m',count(*) filter(where state='settled' and settled_at>=now()-interval '30 minutes')) from public.icash_operation_spend o where account_id=c.id) operations,
 (select jsonb_build_object('last_receipt',max(created_at),'receipts_24h',count(*) filter(where created_at>=now()-interval '24 hours')) from public.icash_discovery_results where account_id=c.id) research,
 (select jsonb_object_agg(kind,counts) from (select kind,jsonb_build_object('issued',count(*) filter(where state='issued'),'held',count(*) filter(where state='held'),'last_completed_at',max(completed_at)) counts from public.icash_automation_tickets where account_id=c.id group by kind) q) tickets,
 (select jsonb_build_object('current',count(*) filter(where revoked_at is null and eligibility_until>now()),'expired',count(*) filter(where revoked_at is null and eligibility_until<=now()),'hours_open',count(*) filter(where revoked_at is null and eligibility_until>now() and public.icash_outreach_window_open(timezone,timezone_basis,now())),'unknown_timezone',count(*) filter(where timezone_basis='recipient' and timezone is null)) from public.icash_operational_contacts where account_id=c.id) contacts,
 (select jsonb_object_agg(state,n) from(select state,count(*) n from public.icash_text_messages where account_id=c.id and direction='outgoing' and created_at>=now()-interval '24 hours' group by state) q) texts_24h,
 (select jsonb_object_agg(state,n) from(select state,count(*) n from public.icash_voice_jobs where account_id=c.id and created_at>=now()-interval '24 hours' group by state) q) calls_24h
from cohort c
)
select now() as observed_at,to_jsonb(m)||jsonb_build_object(
 'original_operations',(select coalesce(jsonb_agg(jsonb_build_object('id',o.operation_key,'state',o.state,'cap',o.charge_cap_cents,'actualMicros',o.actual_micros,'chargedCents',o.charged_cents,'createdAt',o.created_at,'dispatchedAt',o.dispatched_at,'settledAt',o.settled_at,'evidence',o.settlement_evidence) order by o.operation_key),'[]'::jsonb) from public.icash_operation_spend o where o.account_id=m.id and (o.state in ('reserved','dispatched') or o.settled_at>=now()-interval '24 hours')),
 'research_receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',r.operation_key,'createdAt',r.created_at,'resultHash',md5(r.result::text)) order by r.operation_key),'[]'::jsonb) from public.icash_discovery_results r where r.account_id=m.id and r.created_at>=now()-interval '24 hours'),
 'text_receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'providerId',t.provider_id,'requestId',t.request_key,'eventId',t.event_id,'threadId',t.thread_id,'state',t.state,'createdAt',t.created_at,'updatedAt',t.updated_at,'deliveryAt',t.last_delivery_at,'contentHash',md5(jsonb_build_array(t.body,t.attachments)::text)) order by t.id),'[]'::jsonb) from public.icash_text_messages t where t.account_id=m.id and t.direction='outgoing' and (t.state in ('ready','dispatching','accepted','needs_review') or t.updated_at>=now()-interval '24 hours')),
 'call_receipts',(select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'operationId',j.operation_key,'providerId',j.provider_call_sid,'conversationId',j.conversation_id,'recordingId',recording.id,'dialClaimedAt',recording.dial_claimed_at,'recordingStartedAt',recording.provider_started_at,'state',j.state,'outcome',j.outcome,'createdAt',j.created_at,'updatedAt',j.updated_at) order by j.id),'[]'::jsonb) from public.icash_voice_jobs j left join lateral(select r.id,r.dial_claimed_at,r.provider_started_at from public.icash_call_recordings r where r.account_id=j.account_id and r.voice_job_id=j.id and r.operation_key=j.operation_key and r.call_sid is not distinct from j.provider_call_sid order by r.created_at,r.id limit 1) recording on true where j.account_id=m.id and (j.updated_at>=now()-interval '24 hours' or j.state='dispatching')),
 'held_ticket_reasons',(select jsonb_agg(x) from(select kind,outcome,count(*) n,min(created_at) oldest,max(completed_at) last_at from public.icash_automation_tickets where account_id=m.id and state='held' group by kind,outcome)x)
) evidence from measured m order by id;
commit;
