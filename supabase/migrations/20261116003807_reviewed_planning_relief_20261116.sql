-- Owner's renewed remove-blocks request: one reviewed planning-only cohort.
-- Installed empty and inactive. No original operation, authorization, wallet,
-- supplier reserve, customer control, provider request or actual cost is changed.
-- The canonical migration runner owns the transaction, including its ledger row.
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $prerequisite$
begin
 if md5(pg_get_functiondef('icash_reliability_private.pending_planning_cents(public.icash_operation_spend)'::regprocedure))<>'d176da878cd546d3c3e1ed9967ab2e0f'
  or md5(pg_get_functiondef('public.icash_prospecting_total_available(uuid)'::regprocedure))<>'46ce810caee1fff9c57941196155163c'
  or md5(pg_get_functiondef('public.icash_prospecting_available(uuid)'::regprocedure))<>'9b8658ca38e513d6c6a37b282673e1b6'
  or md5(pg_get_functiondef('public.icash_finish_credit(uuid,text,bigint,text)'::regprocedure))<>'84b289a8db3f75f90c16cd0266fb1395'
  or md5(pg_get_functiondef('public.icash_settle_operation(text,bigint,bigint,text)'::regprocedure))<>'c2eb9850afe01778577ccfce5838f33b'
 then raise exception 'Reviewed planning relief prerequisite changed';end if;
end $prerequisite$;

create function icash_reliability_private.relief_hash_20261116(p_value jsonb) returns text
language sql immutable set search_path='' as $$
 select encode(sha256(convert_to(p_value::text,'UTF8')),'hex')
$$;
-- Only a scalar digest ships. Exact private original identifiers never do.
create function icash_reliability_private.relief_pool_sha_20261116() returns text
language sql immutable set search_path='' as $$
 select '2684b0bdd601bf9a63b4a1cc45cde4cc582404fefa830e47cafd4711de6dc322'::text
$$;

create table icash_reliability_private.pending_work_relief_20261116(
 operation_key text primary key,
 account_id uuid not null,
 operation_snapshot jsonb not null check(jsonb_typeof(operation_snapshot)='object'),
 source_snapshot jsonb not null check(jsonb_typeof(source_snapshot)='object'),
 check(operation_snapshot->>'operation_key'=operation_key),
 check((operation_snapshot->>'account_id')::uuid=account_id)
);
create index pending_work_relief_20261116_account on icash_reliability_private.pending_work_relief_20261116(account_id);
create table icash_reliability_private.pending_work_relief_policy_20261116(
 id integer primary key check(id=1),
 source_pool_sha256 text not null check(source_pool_sha256~'^[a-f0-9]{64}$'),
 selection_sha256 text not null check(selection_sha256~'^[a-f0-9]{64}$'),
 manifest_sha256 text not null check(manifest_sha256~'^[a-f0-9]{64}$'),
 account_count integer not null check(account_count between 1 and 37),
 operation_count integer not null check(operation_count between 1 and 189),
 charge_cap_cents bigint not null check(charge_cap_cents between 1 and 27207),
 reserved_micros bigint not null check(reserved_micros between 0 and 122405040),
 cutoff timestamptz not null check(cutoff='2026-11-15T23:00:00Z'::timestamptz),
 captured_at timestamptz not null check(isfinite(captured_at)),
 reviewed_release_sha text not null check(reviewed_release_sha~'^[a-f0-9]{40}$'),
 enabled boolean not null default false,
 activated_at timestamptz check(activated_at is null or isfinite(activated_at)),
 release_sha text check(release_sha~'^[a-f0-9]{40}$'),
 activation_manifest_sha256 text check(activation_manifest_sha256~'^[a-f0-9]{64}$'),
 eligible_operation_count integer check(eligible_operation_count between 0 and 189),
 eligible_quote_cents bigint check(eligible_quote_cents between 0 and 27207),
 check((activated_at is null)=(release_sha is null)),
 check((activated_at is null)=(activation_manifest_sha256 is null)),
 check((activated_at is null)=(eligible_operation_count is null)),
 check((activated_at is null)=(eligible_quote_cents is null)),
 check(not enabled or activated_at is not null),
 check(release_sha is null or release_sha=reviewed_release_sha)
);
create table icash_reliability_private.pending_work_relief_activation_20261116(
 operation_key text primary key references icash_reliability_private.pending_work_relief_20261116(operation_key),
 account_id uuid not null,
 eligible boolean not null,
 reason text not null check(reason in ('eligible','original_missing','original_changed','controls_closed','authorization_changed','source_changed')),
 current_operation_sha256 text check(current_operation_sha256~'^[a-f0-9]{64}$'),
 current_source_sha256 text check(current_source_sha256~'^[a-f0-9]{64}$'),
 checked_at timestamptz not null check(isfinite(checked_at)),
 check(eligible=(reason='eligible'))
);

create function icash_reliability_private.relief_manifest_20261116() returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(string_agg(operation_key||operation_snapshot::text||source_snapshot::text,E'\n' order by operation_key collate "C"),'UTF8')),'hex')
 from icash_reliability_private.pending_work_relief_20261116
$$;

create function icash_reliability_private.relief_rows_guard_20261116() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation') is distinct from 'read committed' or tg_op<>'INSERT'
  or exists(select 1 from icash_reliability_private.pending_work_relief_policy_20261116)
 then raise exception 'Sealed reviewed planning cohort is immutable';end if;
 return new;
end $$;
create trigger pending_work_relief_20261116_immutable before insert or update or delete
 on icash_reliability_private.pending_work_relief_20261116 for each row execute function icash_reliability_private.relief_rows_guard_20261116();
create trigger pending_work_relief_20261116_no_truncate before truncate
 on icash_reliability_private.pending_work_relief_20261116 for each statement execute function icash_reliability_private.relief_rows_guard_20261116();

create function icash_reliability_private.relief_activation_manifest_20261116() returns text
language sql stable set search_path='' as $$
 select encode(sha256(convert_to(string_agg(to_jsonb(a)::text,E'\n' order by operation_key collate "C"),'UTF8')),'hex')
 from icash_reliability_private.pending_work_relief_activation_20261116 a
$$;
create function icash_reliability_private.relief_activation_guard_20261116() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation') is distinct from 'read committed' or tg_op<>'INSERT'
  or exists(select 1 from icash_reliability_private.pending_work_relief_policy_20261116 where activated_at is not null)
  or not exists(select 1 from icash_reliability_private.pending_work_relief_20261116 r
   where r.operation_key=new.operation_key and r.account_id=new.account_id)
 then raise exception 'Sealed planning activation decisions are immutable';end if;
 return new;
end $$;
create trigger pending_work_relief_activation_20261116_immutable before insert or update or delete
 on icash_reliability_private.pending_work_relief_activation_20261116 for each row execute function icash_reliability_private.relief_activation_guard_20261116();
create trigger pending_work_relief_activation_20261116_no_truncate before truncate
 on icash_reliability_private.pending_work_relief_activation_20261116 for each statement execute function icash_reliability_private.relief_activation_guard_20261116();

create function icash_reliability_private.relief_policy_guard_20261116() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_setting('transaction_isolation') is distinct from 'read committed' then raise exception 'Current planning seal snapshot required';end if;
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Reviewed planning seal cannot be removed';end if;
 if tg_op='INSERT' then
  if new.enabled or new.activated_at is not null or new.release_sha is not null
   or new.activation_manifest_sha256 is not null or new.eligible_operation_count is not null or new.eligible_quote_cents is not null
   or new.source_pool_sha256 is distinct from icash_reliability_private.relief_pool_sha_20261116()
   or new.manifest_sha256 is distinct from icash_reliability_private.relief_manifest_20261116()
   or new.account_count<>(select count(distinct account_id) from icash_reliability_private.pending_work_relief_20261116)
   or new.operation_count<>(select count(*) from icash_reliability_private.pending_work_relief_20261116)
   or new.charge_cap_cents is distinct from (select sum((operation_snapshot->>'charge_cap_cents')::bigint)::bigint from icash_reliability_private.pending_work_relief_20261116)
   or new.reserved_micros is distinct from (select sum((operation_snapshot->>'reserved_micros')::bigint)::bigint from icash_reliability_private.pending_work_relief_20261116)
  then raise exception 'Reviewed planning seal does not match capture';end if;
 else
  if (to_jsonb(new)-array['enabled','activated_at','release_sha','activation_manifest_sha256','eligible_operation_count','eligible_quote_cents'])
   is distinct from (to_jsonb(old)-array['enabled','activated_at','release_sha','activation_manifest_sha256','eligible_operation_count','eligible_quote_cents'])
  then raise exception 'Reviewed planning seal is immutable';end if;
  if old.activated_at is not null then
   if row(new.activated_at,new.release_sha,new.activation_manifest_sha256,new.eligible_operation_count,new.eligible_quote_cents)
    is distinct from row(old.activated_at,old.release_sha,old.activation_manifest_sha256,old.eligible_operation_count,old.eligible_quote_cents)
    or (not old.enabled and new.enabled) then raise exception 'Reviewed planning activation is one-use';end if;
  elsif new.activated_at is not null then
   if new.release_sha is distinct from old.reviewed_release_sha or new.activated_at<old.captured_at
    or new.activation_manifest_sha256 is distinct from icash_reliability_private.relief_activation_manifest_20261116()
    or (select count(*) from icash_reliability_private.pending_work_relief_activation_20261116)<>old.operation_count
    or new.eligible_operation_count is distinct from (select count(*)::integer from icash_reliability_private.pending_work_relief_activation_20261116 where eligible)
    or new.eligible_quote_cents is distinct from (select coalesce(sum((r.operation_snapshot->>'charge_cap_cents')::bigint),0)::bigint
     from icash_reliability_private.pending_work_relief_activation_20261116 a join icash_reliability_private.pending_work_relief_20261116 r using(operation_key,account_id) where a.eligible)
    or new.enabled is distinct from (new.eligible_operation_count>0)
   then raise exception 'Invalid reviewed planning activation';end if;
  elsif new.enabled or new.release_sha is not null or new.activation_manifest_sha256 is not null
   or new.eligible_operation_count is not null or new.eligible_quote_cents is not null then raise exception 'Activation evidence required';
  end if;
 end if;
 return new;
end $$;
create trigger pending_work_relief_policy_20261116_guard before insert or update or delete
 on icash_reliability_private.pending_work_relief_policy_20261116 for each row execute function icash_reliability_private.relief_policy_guard_20261116();
create trigger pending_work_relief_policy_20261116_no_truncate before truncate
 on icash_reliability_private.pending_work_relief_policy_20261116 for each statement execute function icash_reliability_private.relief_policy_guard_20261116();

create function icash_reliability_private.pending_work_relief_controls_20261116(p_account uuid) returns boolean
language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
  join public.icash_discovery_configs c on c.account_id=a.id
  where a.id=p_account and not a.bot_paused and a.workspace_ack_version is not null
   and w.balance_cents>0 and w.reserved_cents=0 and c.enabled and c.auto_enabled and c.contacts_enabled
   and c.data_rights_until>clock_timestamp() and public.icash_membership_work_allowed(a.id)
   and exists(select 1 from public.icash_prospecting_budgets b where b.account_id=a.id));
$$;

-- Read the original handler evidence, never infer zero cost from age or expiry.
-- Ten minutes exceeds the local 240-second handler; calls additionally require
-- saved call-ended evidence and expired original provider/tool/ticket windows.
-- Free receipt-retrieval bookkeeping is intentionally excluded from identity;
-- receipt/artifact/call-state changes remain part of the reviewed fingerprint.
create function icash_reliability_private.pending_work_relief_idle_source_20261116(p_operation public.icash_operation_spend) returns jsonb
language plpgsql volatile set search_path='' as $source$
declare o public.icash_operation_spend:=p_operation; stamp timestamptz:=clock_timestamp();
 b icash_research_private.owner_batches;bi icash_research_private.owner_batch_items;
 e icash_research_private.owner_exports;q icash_research_private.requests;
 v public.icash_voice_jobs;m public.icash_text_messages;kind text;source_id uuid;parts jsonb;records jsonb;conversations jsonb;tickets jsonb;
begin
 select r.operation into kind from public.icash_operation_rates r where r.id=o.rate_id;
 if kind is null then return null;end if;
 if kind in ('seller_call','sms_send') then
  if o.operation_key !~ (case when kind='seller_call' then '^voice:' else '^text:' end||'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then return null;end if;
  source_id:=split_part(o.operation_key,':',2)::uuid;
 end if;
 if o.state is distinct from 'dispatched' or o.dispatched_at is null
  or o.dispatched_at>stamp-interval '15 minutes' or o.created_at>stamp-interval '15 minutes'
  or o.actual_micros is not null or o.charged_cents is not null or o.settled_at is not null then return null;end if;
 if kind='owner_enrichment' then
  select * into bi from icash_research_private.owner_batch_items where operation_key=o.operation_key;
  if not found then return null;end if;
  select * into b from icash_research_private.owner_batches where id=bi.batch_id;
  if not found or b.account_id is distinct from o.account_id or b.state is distinct from 'claimed' then return null;end if;
  select * into q from icash_research_private.requests where id=b.id;
  if not found or q.account_id is distinct from o.account_id or q.operation_key is distinct from 'owner-batch:'||b.id
   or q.kind is distinct from 'owner_lookup' or q.admitted is distinct from true
   or q.finished_at is null or q.finished_at<q.created_at or q.finished_at>stamp-interval '10 minutes'
   or (q.result->>'outcome') is null or q.result->>'outcome' not in ('http_error','unknown')
   or exists(select 1 from icash_research_private.requests x where x.account_id=o.account_id and x.operation_key='owner-batch:'||b.id and x.id<>b.id and x.admitted)
  then return null;end if;
  select * into e from icash_research_private.owner_exports where id=b.id;
  if not found or e.completed_at is not null or e.csv is not null or e.parsed_rows is not null
   or (e.lease_token is not null and (e.lease_until is null or e.lease_until>stamp))
   or (q.result->>'outcome'='http_error' and (e.receipt->>'httpStatus' is distinct from '400'
    or e.receipt#>>'{raw,error,code}' is distinct from 'invalid_request'))
   or (q.result->>'outcome'='unknown' and e.receipt is not null) then return null;end if;
  return jsonb_build_object('version','reviewed-idle-original-v1','kind',kind,'batch',to_jsonb(b),
   'item',to_jsonb(bi),'originalRequest',to_jsonb(q),'export',to_jsonb(e)-array[
   'next_recover_at','recovery_attempts','lease_token','lease_until']);
 elsif kind='seller_call' then
  select * into v from public.icash_voice_jobs where id=source_id;
  if not found or v.account_id is distinct from o.account_id or v.operation_key is distinct from o.operation_key
   or v.state not in ('held','dispatching','dispatched') or v.updated_at>stamp-interval '15 minutes' then return null;end if;
  if not exists(select 1 from public.icash_automation_tickets t where t.voice_job_id=v.id)
   or exists(select 1 from public.icash_automation_tickets t where t.voice_job_id=v.id
    and (t.account_id is distinct from o.account_id or t.state not in ('held','complete')
     or t.expires_at>stamp-interval '10 minutes' or t.completed_at is null or t.completed_at>stamp-interval '10 minutes'))
  then return null;end if;
  if exists(select 1 from public.icash_call_recordings c where c.operation_key=o.operation_key
   and (c.account_id is distinct from o.account_id or c.voice_job_id is distinct from v.id
    or c.state not in ('stopping','available') or c.call_ended_at is null or c.call_ended_at>stamp-interval '10 minutes'
    or c.max_total_seconds>600 or c.dial_claimed_at>stamp-interval '15 minutes' or c.start_claimed_at>stamp-interval '15 minutes'
    or (c.reconcile_lease_token is not null and (c.reconcile_lease_expires_at is null or c.reconcile_lease_expires_at>stamp))
    or (c.deletion_lease_token is not null and (c.deletion_lease_expires_at is null or c.deletion_lease_expires_at>stamp))))
   or (not exists(select 1 from public.icash_call_recordings c where c.operation_key=o.operation_key)
    and (v.state<>'held' or v.outcome is null or v.outcome not in ('recording_admission_held','provider_outcome_unknown_no_retry')))
   or exists(select 1 from public.icash_live_conversations l where l.operation_key=o.operation_key
    and (l.account_id is distinct from o.account_id or l.state not in ('review','complete')
     or l.tool_expires_at is null or l.tool_expires_at>stamp-interval '10 minutes')) then return null;end if;
  select coalesce(jsonb_agg(to_jsonb(c)-array['row_version','updated_at','next_reconcile_at','reconcile_attempts',
   'reconcile_lease_token','reconcile_lease_expires_at','next_delete_at','deletion_attempts','deletion_lease_token',
   'deletion_lease_expires_at','last_error','last_action'] order by c.id),'[]'::jsonb) into records
   from public.icash_call_recordings c where c.operation_key=o.operation_key;
  select coalesce(jsonb_agg(to_jsonb(l)-array['next_poll_at','poll_attempts','tool_token_hash'] order by l.id),'[]'::jsonb)
   into conversations from public.icash_live_conversations l where l.operation_key=o.operation_key;
  select jsonb_agg(to_jsonb(t)-'token' order by t.id) into tickets from public.icash_automation_tickets t where t.voice_job_id=v.id;
  return jsonb_build_object('version','reviewed-idle-original-v1','kind',kind,'job',to_jsonb(v),
   'recordings',records,'conversations',conversations,'tickets',tickets);
 elsif kind='sms_send' then
  select * into m from public.icash_text_messages where id=source_id;
  if not found or m.account_id is distinct from o.account_id or m.direction is distinct from 'outgoing'
   or m.state not in ('dispatching','needs_review') or m.provider_id is not null or m.event_id is not null
   or m.last_delivery_at is not null or m.updated_at>stamp-interval '10 minutes'
   or exists(select 1 from icash_text_receipt_private.attempts a where a.message_id=m.id)
   or not exists(select 1 from public.icash_automation_tickets t where t.opener_message_id=m.id)
   or exists(select 1 from public.icash_automation_tickets t where t.opener_message_id=m.id
    and (t.account_id is distinct from o.account_id or t.state not in ('held','complete')
     or t.expires_at>stamp-interval '10 minutes' or t.completed_at is null or t.completed_at>stamp-interval '10 minutes'))
  then return null;end if;
  select jsonb_agg(to_jsonb(t)-'token' order by t.id) into tickets from public.icash_automation_tickets t where t.opener_message_id=m.id;
  return jsonb_build_object('version','reviewed-idle-original-v1','kind',kind,'message',to_jsonb(m),'tickets',tickets);
 elsif kind='property_search' then
  if (select count(*) from icash_research_private.requests x where x.account_id=o.account_id and x.operation_key=o.operation_key and x.kind='property_search' and x.admitted)<>1
   or exists(select 1 from icash_research_private.requests x where x.account_id=o.account_id and x.operation_key=o.operation_key
    and (x.account_id is distinct from o.account_id or x.kind not in ('property_search','search_estimate')
     or (x.admitted and (x.finished_at is null or x.finished_at<x.created_at or x.finished_at>stamp-interval '10 minutes'))))
   or exists(select 1 from icash_research_private.estimates x where x.operation_key=o.operation_key)
   or exists(select 1 from public.icash_discovery_results x where x.operation_key=o.operation_key) then return null;end if;
  select * into q from icash_research_private.requests x where x.account_id=o.account_id and x.operation_key=o.operation_key and x.kind='property_search' and x.admitted;
  if q.result->>'outcome' is null or q.result->>'outcome' not in ('http_error','unknown') then return null;end if;
  select jsonb_agg(to_jsonb(x) order by x.id) into parts from icash_research_private.requests x where x.account_id=o.account_id and x.operation_key=o.operation_key;
  return jsonb_build_object('version','reviewed-idle-original-v1','kind',kind,'requests',parts);
 end if;
 return null;
end $source$;

-- Callers already hold the operating-budget and request-limiter rows, then the
-- exact original operation. Canonical new request/estimate admissions serialize
-- on those rows. Exact parent FOR UPDATE locks also fence new FK-bound children.
-- NOWAIT refuses any reversed-order concurrent receipt writer; nothing is retried.
create function icash_reliability_private.pending_work_relief_lock_source_20261116(p_operation public.icash_operation_spend) returns void
language plpgsql set search_path='' as $locks$
declare batch uuid;job uuid;message uuid;source_id uuid;kind text;
begin
 select r.operation into kind from public.icash_operation_rates r where r.id=p_operation.rate_id for share nowait;
 if kind in ('seller_call','sms_send') then
  if p_operation.operation_key !~ (case when kind='seller_call' then '^voice:' else '^text:' end||'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then raise exception 'Malformed original source key';end if;
  source_id:=split_part(p_operation.operation_key,':',2)::uuid;
 end if;
 if kind='owner_enrichment' then
  select batch_id into batch from icash_research_private.owner_batch_items where operation_key=p_operation.operation_key for update nowait;
  perform 1 from icash_research_private.owner_batches where id=batch for update nowait;
  perform 1 from icash_research_private.owner_exports where id=batch for update nowait;
  perform 1 from icash_research_private.requests where id=batch or (account_id=p_operation.account_id and operation_key='owner-batch:'||batch) order by id for update nowait;
 elsif kind='seller_call' then
  select id into job from public.icash_voice_jobs where id=source_id for update nowait;
  perform 1 from public.icash_call_recordings where operation_key=p_operation.operation_key order by id for update nowait;
  perform 1 from public.icash_live_conversations where operation_key=p_operation.operation_key order by id for update nowait;
  perform 1 from public.icash_automation_tickets where voice_job_id=job order by id for update nowait;
 elsif kind='sms_send' then
  select id into message from public.icash_text_messages where id=source_id for update nowait;
  perform 1 from icash_text_receipt_private.attempts where message_id=message order by id for update nowait;
  perform 1 from public.icash_automation_tickets where opener_message_id=message order by id for update nowait;
 elsif kind='property_search' then
  perform 1 from icash_research_private.requests where account_id=p_operation.account_id and operation_key=p_operation.operation_key order by id for update nowait;
  perform 1 from icash_research_private.estimates where operation_key=p_operation.operation_key for update nowait;
  perform 1 from public.icash_discovery_results where operation_key=p_operation.operation_key for update nowait;
 else raise exception 'Unreviewed original operation kind';end if;
end $locks$;

create function icash_reliability_private.stage_pending_work_relief_20261116(p_pool jsonb,p_selected jsonb,p_release_sha text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $fn$
declare item record;o public.icash_operation_spend;credit public.icash_credit_reservations;source jsonb;
 pool_sha text;selection_sha text;stamp timestamptz;policy icash_reliability_private.pending_work_relief_policy_20261116;
begin
 if current_setting('transaction_isolation') is distinct from 'read committed'
  or p_release_sha is null or p_release_sha!~'^[a-f0-9]{40}$'
  or jsonb_typeof(p_pool) is distinct from 'array' or jsonb_typeof(p_selected) is distinct from 'array'
 then raise exception 'Exact private review, release and READ COMMITTED required';end if;
 if jsonb_array_length(p_pool) not between 1 and 189 or jsonb_array_length(p_selected) not between 1 and 189
  or exists(select 1 from jsonb_array_elements(p_pool) e where jsonb_typeof(e)<>'object'
   or not(e ?& array['operation_key','account_id','source_sha256'])
   or exists(select 1 from jsonb_object_keys(e) k where k<>all(array['operation_key','account_id','source_sha256'])))
  or exists(select 1 from jsonb_array_elements(p_selected) e where jsonb_typeof(e)<>'object'
   or not(e ?& array['operation_key','idle_source_sha256'])
   or exists(select 1 from jsonb_object_keys(e) k where k<>all(array['operation_key','idle_source_sha256'])))
 then raise exception 'Malformed reviewed source selection';end if;
 select encode(sha256(convert_to(string_agg(operation_key||E'\t'||account_id::text||E'\t'||source_sha256,E'\n' order by operation_key collate "C"),'UTF8')),'hex')
 into pool_sha from jsonb_to_recordset(p_pool) p(operation_key text,account_id uuid,source_sha256 text);
 if pool_sha is distinct from icash_reliability_private.relief_pool_sha_20261116()
  or (select count(distinct operation_key) from jsonb_to_recordset(p_pool) p(operation_key text))<>jsonb_array_length(p_pool)
  or (select count(distinct operation_key) from jsonb_to_recordset(p_selected) p(operation_key text))<>jsonb_array_length(p_selected)
  or exists(select 1 from jsonb_to_recordset(p_selected) s(operation_key text,idle_source_sha256 text)
   where s.operation_key is null or s.idle_source_sha256 is null or s.idle_source_sha256!~'^[a-f0-9]{64}$'
    or not exists(select 1 from jsonb_to_recordset(p_pool) p(operation_key text) where p.operation_key=s.operation_key))
 then raise exception 'Selected originals are outside the exact reviewed pool';end if;
 select encode(sha256(convert_to(string_agg(operation_key||E'\t'||idle_source_sha256,E'\n' order by operation_key collate "C"),'UTF8')),'hex')
 into selection_sha from jsonb_to_recordset(p_selected) s(operation_key text,idle_source_sha256 text);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update nowait;
 if not found then raise exception 'Current operating budget is not enabled';end if;
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update nowait;
 if not found then raise exception 'Original request admission lock missing';end if;
 lock table icash_reliability_private.pending_work_relief_20261116,
  icash_reliability_private.pending_work_relief_policy_20261116,
  icash_reliability_private.pending_work_relief_activation_20261116 in share row exclusive mode nowait;
 if exists(select 1 from icash_reliability_private.pending_work_relief_policy_20261116)
  or exists(select 1 from icash_reliability_private.pending_work_relief_20261116)
  or exists(select 1 from icash_reliability_private.pending_work_relief_activation_20261116)
 then raise exception 'Reviewed planning capture is one-use';end if;
 for item in select s.operation_key,s.idle_source_sha256,p.account_id,p.source_sha256
  from jsonb_to_recordset(p_selected) s(operation_key text,idle_source_sha256 text)
  join jsonb_to_recordset(p_pool) p(operation_key text,account_id uuid,source_sha256 text) using(operation_key)
  order by s.operation_key collate "C"
 loop
  select * into o from public.icash_operation_spend where operation_key=item.operation_key and account_id=item.account_id for update nowait;
  if not found or o.state<>'dispatched' or o.created_at>='2026-11-15T23:00:00Z'::timestamptz
   or o.dispatched_at is null or o.dispatched_at>='2026-11-15T23:00:00Z'::timestamptz
   or o.actual_micros is not null or o.charged_cents is not null or o.settled_at is not null
   or icash_reliability_private.relief_hash_20261116(to_jsonb(o)-'estimate_checked_at') is distinct from item.source_sha256
   or icash_reliability_private.pending_planning_cents(o) is distinct from o.charge_cap_cents
   or not icash_reliability_private.pending_work_relief_controls_20261116(o.account_id)
  then raise exception 'Reviewed original snapshot, cutoff or controls changed';end if;
  perform icash_reliability_private.pending_work_relief_lock_source_20261116(o);
  -- Match the real credit finalizer: wallet first, authorization second. The
  -- original financial rows are locked for proof only and are never updated.
  perform 1 from public.icash_accounts where id=o.account_id for share nowait;
  perform 1 from public.icash_discovery_configs where account_id=o.account_id for share nowait;
  perform 1 from public.icash_wallets where account_id=o.account_id for update nowait;
  if not found then raise exception 'Original wallet missing';end if;
  select * into credit from public.icash_credit_reservations where id=o.credit_reservation_id for update nowait;
  if not found or credit.account_id<>o.account_id or credit.operation_key<>o.operation_key
   or credit.amount_cents<>o.charge_cap_cents or credit.status<>'reserved' or credit.settled_cents is not null
  then raise exception 'Original usage authorization changed';end if;
  source:=icash_reliability_private.pending_work_relief_idle_source_20261116(o);
  if source is null or jsonb_typeof(source)<>'object'
   or icash_reliability_private.relief_hash_20261116(source) is distinct from item.idle_source_sha256
   or not icash_reliability_private.pending_work_relief_controls_20261116(o.account_id)
  then raise exception 'Original source is active, changed or unproved';end if;
  insert into icash_reliability_private.pending_work_relief_20261116(operation_key,account_id,operation_snapshot,source_snapshot)
  values(o.operation_key,o.account_id,to_jsonb(o)-'estimate_checked_at',source);
 end loop;
 stamp:=clock_timestamp();
 insert into icash_reliability_private.pending_work_relief_policy_20261116(id,source_pool_sha256,selection_sha256,manifest_sha256,
  account_count,operation_count,charge_cap_cents,reserved_micros,cutoff,captured_at,reviewed_release_sha)
 select 1,pool_sha,selection_sha,icash_reliability_private.relief_manifest_20261116(),count(distinct account_id),count(*),
  sum((operation_snapshot->>'charge_cap_cents')::bigint),sum((operation_snapshot->>'reserved_micros')::bigint),
  '2026-11-15T23:00:00Z',stamp,p_release_sha from icash_reliability_private.pending_work_relief_20261116 returning * into policy;
 return jsonb_build_object('staged',true,'enabled',false,'manifestSha256',policy.manifest_sha256,
  'selectionSha256',selection_sha,'accounts',policy.account_count,'operations',policy.operation_count,
  'planningQuotesCents',policy.charge_cap_cents,'originalSupplierReserveMicros',policy.reserved_micros);
end $fn$;

create function icash_reliability_private.activate_pending_work_relief_20261116(p_manifest_sha256 text,p_release_sha text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $fn$
declare policy icash_reliability_private.pending_work_relief_policy_20261116;r record;o public.icash_operation_spend;source jsonb;
 credit public.icash_credit_reservations;decision text;current_hash text;source_hash text;eligible_count integer;eligible_cents bigint;
begin
 if current_setting('transaction_isolation') is distinct from 'read committed'
  or p_manifest_sha256 is null or p_manifest_sha256!~'^[a-f0-9]{64}$'
  or p_release_sha is null or p_release_sha!~'^[a-f0-9]{40}$'
 then raise exception 'Exact sealed review, release and READ COMMITTED required';end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update nowait;
 if not found then raise exception 'Current operating budget is not enabled';end if;
 perform 1 from public.icash_dealmachine_request_budget where id=1 for update nowait;
 if not found then raise exception 'Original request admission lock missing';end if;
 lock table icash_reliability_private.pending_work_relief_20261116,
  icash_reliability_private.pending_work_relief_policy_20261116,
  icash_reliability_private.pending_work_relief_activation_20261116 in share row exclusive mode nowait;
 select * into strict policy from icash_reliability_private.pending_work_relief_policy_20261116 where id=1 for update nowait;
 if p_manifest_sha256 is distinct from policy.manifest_sha256
  or p_manifest_sha256 is distinct from icash_reliability_private.relief_manifest_20261116()
  or p_release_sha is distinct from policy.reviewed_release_sha
 then raise exception 'Sealed planning review or verified release changed';end if;
 if policy.activated_at is not null then
  if not policy.enabled then raise exception 'Disabled planning activation is terminal';end if;
  return jsonb_build_object('activated',false,'enabled',true,'activatedAt',policy.activated_at,
   'eligibleOperations',policy.eligible_operation_count,'excludedOperations',policy.operation_count-policy.eligible_operation_count,
   'activationManifestSha256',policy.activation_manifest_sha256);
 end if;
 if exists(select 1 from icash_reliability_private.pending_work_relief_activation_20261116)
 then raise exception 'Unsealed activation decisions require review';end if;
 for r in select * from icash_reliability_private.pending_work_relief_20261116 order by operation_key collate "C" loop
  decision:=null;current_hash:=null;source_hash:=null;source:=null;
  select * into o from public.icash_operation_spend where operation_key=r.operation_key and account_id=r.account_id for update nowait;
  if not found then decision:='original_missing';
  else
   current_hash:=icash_reliability_private.relief_hash_20261116(to_jsonb(o)-'estimate_checked_at');
   if r.operation_snapshot is distinct from to_jsonb(o)-'estimate_checked_at' or o.state<>'dispatched' then decision:='original_changed';
   elsif not icash_reliability_private.pending_work_relief_controls_20261116(o.account_id) then decision:='controls_closed';
   else
    perform icash_reliability_private.pending_work_relief_lock_source_20261116(o);
    perform 1 from public.icash_accounts where id=o.account_id for share nowait;
  perform 1 from public.icash_discovery_configs where account_id=o.account_id for share nowait;
  perform 1 from public.icash_wallets where account_id=o.account_id for update nowait;
    if not found then decision:='authorization_changed';
    else
     select * into credit from public.icash_credit_reservations where id=o.credit_reservation_id for update nowait;
     if not found or credit.account_id<>o.account_id or credit.operation_key<>o.operation_key
      or credit.amount_cents<>o.charge_cap_cents or credit.status<>'reserved' or credit.settled_cents is not null
     then decision:='authorization_changed';
     else
      source:=icash_reliability_private.pending_work_relief_idle_source_20261116(o);
      source_hash:=icash_reliability_private.relief_hash_20261116(source);
      if source is null or source is distinct from r.source_snapshot then decision:='source_changed';
      elsif not icash_reliability_private.pending_work_relief_controls_20261116(o.account_id) then decision:='controls_closed';
      else decision:='eligible';end if;
     end if;
    end if;
   end if;
  end if;
  insert into icash_reliability_private.pending_work_relief_activation_20261116
   (operation_key,account_id,eligible,reason,current_operation_sha256,current_source_sha256,checked_at)
  values(r.operation_key,r.account_id,decision='eligible',decision,current_hash,source_hash,clock_timestamp());
 end loop;
 select count(*)::integer,coalesce(sum((captured.operation_snapshot->>'charge_cap_cents')::bigint),0)::bigint
 into eligible_count,eligible_cents from icash_reliability_private.pending_work_relief_activation_20261116 a
 join icash_reliability_private.pending_work_relief_20261116 captured using(operation_key,account_id) where a.eligible;
 update icash_reliability_private.pending_work_relief_policy_20261116
 set enabled=eligible_count>0,activated_at=clock_timestamp(),release_sha=p_release_sha,
  activation_manifest_sha256=icash_reliability_private.relief_activation_manifest_20261116(),
  eligible_operation_count=eligible_count,eligible_quote_cents=eligible_cents where id=1 returning * into policy;
 return jsonb_build_object('activated',policy.enabled,'enabled',policy.enabled,'recorded',true,'activatedAt',policy.activated_at,
  'manifestSha256',policy.manifest_sha256,'activationManifestSha256',policy.activation_manifest_sha256,
  'eligibleOperations',eligible_count,'excludedOperations',policy.operation_count-eligible_count,
  'planningQuotesCents',eligible_cents,'reviewedMaximumPlanningQuotesCents',policy.charge_cap_cents);
end $fn$;

-- Rollback means disabling an already activated cohort. It retains every seal,
-- source snapshot and activation receipt; it can never reenable that cohort.
create function icash_reliability_private.rollback_pending_work_relief_20261116(p_manifest_sha256 text,p_release_sha text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='500ms' as $fn$
declare policy icash_reliability_private.pending_work_relief_policy_20261116;
begin
 perform 1 from public.icash_operating_budget where id=1 for update nowait;
 if not found then raise exception 'Operating budget missing';end if;
 select * into strict policy from icash_reliability_private.pending_work_relief_policy_20261116 where id=1 for update nowait;
 if p_manifest_sha256 is distinct from policy.manifest_sha256 or p_release_sha is distinct from policy.release_sha
  or policy.activated_at is null then raise exception 'Exact activated review required for rollback';end if;
 update icash_reliability_private.pending_work_relief_policy_20261116 set enabled=false where id=1;
 return jsonb_build_object('enabled',false,'manifestSha256',policy.manifest_sha256,'activatedAt',policy.activated_at);
end $fn$;

create or replace function icash_reliability_private.pending_planning_cents(p_operation public.icash_operation_spend) returns bigint
language sql stable security invoker set search_path='' as $$
 select case when p_operation.state not in ('reserved','dispatched') then 0
  when exists(select 1 from icash_reliability_private.pending_work_relief r
   join icash_reliability_private.pending_work_relief_policy p on p.id=1 and p.enabled
   where r.operation_key=p_operation.operation_key and r.account_id=p_operation.account_id
    and r.operation_snapshot=to_jsonb(p_operation)-'estimate_checked_at') then 0
  when exists(select 1 from icash_reliability_private.pending_work_relief_20261113 r
   join icash_reliability_private.pending_work_relief_policy_20261113 p on p.id=1 and p.enabled
   where r.operation_key=p_operation.operation_key and r.account_id=p_operation.account_id
    and r.operation_snapshot=to_jsonb(p_operation)-'estimate_checked_at') then 0
  when exists(select 1 from icash_reliability_private.pending_work_relief_20261116 r
   join icash_reliability_private.pending_work_relief_policy_20261116 p on p.id=1 and p.enabled
   join icash_reliability_private.pending_work_relief_activation_20261116 a
    on a.operation_key=r.operation_key and a.account_id=r.account_id and a.eligible
   where r.operation_key=p_operation.operation_key and r.account_id=p_operation.account_id
    and r.operation_snapshot=to_jsonb(p_operation)-'estimate_checked_at') then 0
  else p_operation.charge_cap_cents end;
$$;

alter table icash_reliability_private.pending_work_relief_20261116 enable row level security;
alter table icash_reliability_private.pending_work_relief_policy_20261116 enable row level security;
alter table icash_reliability_private.pending_work_relief_activation_20261116 enable row level security;
revoke all on icash_reliability_private.pending_work_relief_20261116,icash_reliability_private.pending_work_relief_policy_20261116,
 icash_reliability_private.pending_work_relief_activation_20261116 from public,anon,authenticated,service_role;
grant select on icash_reliability_private.pending_work_relief_20261116,icash_reliability_private.pending_work_relief_policy_20261116,
 icash_reliability_private.pending_work_relief_activation_20261116 to service_role;
create policy pending_work_relief_20261116_service_read on icash_reliability_private.pending_work_relief_20261116 for select to service_role using(true);
create policy pending_work_relief_policy_20261116_service_read on icash_reliability_private.pending_work_relief_policy_20261116 for select to service_role using(true);
create policy pending_work_relief_activation_20261116_service_read on icash_reliability_private.pending_work_relief_activation_20261116 for select to service_role using(true);
revoke all on function icash_reliability_private.relief_hash_20261116(jsonb),icash_reliability_private.relief_pool_sha_20261116(),
 icash_reliability_private.relief_manifest_20261116(),icash_reliability_private.relief_rows_guard_20261116(),
 icash_reliability_private.relief_policy_guard_20261116(),icash_reliability_private.pending_work_relief_controls_20261116(uuid),
 icash_reliability_private.relief_activation_guard_20261116(),icash_reliability_private.relief_activation_manifest_20261116(),
 icash_reliability_private.pending_work_relief_idle_source_20261116(public.icash_operation_spend),
 icash_reliability_private.pending_work_relief_lock_source_20261116(public.icash_operation_spend),
 icash_reliability_private.stage_pending_work_relief_20261116(jsonb,jsonb,text),
 icash_reliability_private.activate_pending_work_relief_20261116(text,text),
 icash_reliability_private.rollback_pending_work_relief_20261116(text,text)
 from public,anon,authenticated,service_role;
