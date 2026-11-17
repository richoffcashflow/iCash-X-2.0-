-- Runner-owned transaction. No historical admission or receipt is synthesized.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $pins$
declare e record;p record;
begin
 for e in select * from (values
  ('public.icash_claim_title_update(uuid,uuid,jsonb)','b5d5f5d7c15f592389db4505aa0ce343',false,'v'),
  ('public.icash_claim_title_followup(uuid,uuid)','f454ecbc344edfc87150f7bb0e9e2ab0',false,'v'),
  ('public.icash_seed_contract_deadlines(uuid)','8b8da09a8c6f8e952c8804b2a6cae104',false,'v'),
  ('icash_title_copy_private.envelope_source(public.icash_signing_envelopes)','83b97c7e61fdd547cced6df8c79ceb56',false,'i')
 ) expected(signature,hash,definer,volatility) loop
  select md5(pg_get_functiondef(oid)) hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl
  into p from pg_proc where oid=to_regprocedure(e.signature);
  if p.hash is distinct from e.hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from e.definer
   or p.provolatile::text is distinct from e.volatility or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
   or p.acl is distinct from (case when e.signature like 'icash_title_copy_private.%' then '{postgres=X/postgres}' else '{postgres=X/postgres,service_role=X/postgres}' end)
  then raise exception 'Title task delivery prerequisite changed: %',e.signature;end if;
 end loop;
 if to_regnamespace('icash_title_task_delivery_private') is not null then raise exception 'Title task delivery already installed';end if;
end $pins$;

-- First rollout only. Older in-flight workers cannot retroactively acquire an
-- original snapshot. Hold writers and fail closed if any title delivery exists.
-- Exact cancelled contract deadlines are non-delivery records: both pinned
-- legacy claims reject their kind before reservation. Preserve them unchanged.
do $empty_cutover$
begin
 perform 1 from public.icash_operating_budget where id=1 for update nowait;
 if not found then raise exception 'Title task delivery operating budget missing';end if;
 lock table public.icash_title_requests,public.icash_title_tasks in share mode nowait;
 perform e.id from public.icash_signing_envelopes e join public.icash_title_tasks t on t.payload->>'envelopeId'=e.id::text for share of e nowait;
 if exists(select 1 from public.icash_title_requests)
  or exists(select 1 from public.icash_title_tasks t where (
   t.kind='deadline' and t.state='cancelled' and t.email_state='waiting' and t.email_provider_id is null
   and t.request_id is null and t.reply_id is null and t.payload->>'deadline' in ('closing','inspection')
   and exists(select 1 from public.icash_signing_envelopes e where e.id::text=t.payload->>'envelopeId'
    and e.account_id=t.account_id and e.deal_id=t.deal_id and e.kind='purchase' and e.state='completed' and not e.test_mode
    and t.payload=jsonb_build_object('envelopeId',e.id,'deadline',t.payload->>'deadline')
    and t.source_key='contract-'||(t.payload->>'deadline')||':'||e.id::text)
  ) is distinct from true)
  or exists(select 1 from public.icash_operation_spend where operation_key like 'title-followup:%')
 then raise exception 'Title task delivery requires an empty title lifecycle except exact cancelled contract deadlines; existing originals need separate cutover review';end if;
end $empty_cutover$;

create schema icash_title_task_delivery_private;
revoke all on schema icash_title_task_delivery_private from public,anon,authenticated,service_role;
create table icash_title_task_delivery_private.admissions(
 task_id uuid primary key references public.icash_title_tasks(id),account_id uuid not null,deal_id uuid not null,request_id uuid not null,
 source jsonb not null,operation_source jsonb not null,created_at timestamptz not null default clock_timestamp()
);
create table icash_title_task_delivery_private.receipts(
 task_id uuid primary key references icash_title_task_delivery_private.admissions(task_id),account_id uuid not null,
 provider_id text not null check(length(btrim(provider_id)) between 1 and 200),created_at timestamptz not null default clock_timestamp()
);
create table icash_title_task_delivery_private.preparation_reviews(
 task_id uuid primary key references public.icash_title_tasks(id),account_id uuid not null,source jsonb not null,
 reason text not null check(reason in ('unsupported_update','invalid_assignment_reference','invalid_provider_id','invalid_payout')),
 created_at timestamptz not null default clock_timestamp()
);
alter table icash_title_task_delivery_private.admissions enable row level security;
alter table icash_title_task_delivery_private.receipts enable row level security;
alter table icash_title_task_delivery_private.preparation_reviews enable row level security;
revoke all on all tables in schema icash_title_task_delivery_private from public,anon,authenticated,service_role;
create function icash_title_task_delivery_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Original title task delivery evidence is immutable';end $$;
create trigger title_task_admission_immutable before update or delete on icash_title_task_delivery_private.admissions for each row execute function icash_title_task_delivery_private.immutable();
create trigger title_task_admission_no_truncate before truncate on icash_title_task_delivery_private.admissions for each statement execute function icash_title_task_delivery_private.immutable();
create trigger title_task_receipt_immutable before update or delete on icash_title_task_delivery_private.receipts for each row execute function icash_title_task_delivery_private.immutable();
create trigger title_task_receipt_no_truncate before truncate on icash_title_task_delivery_private.receipts for each statement execute function icash_title_task_delivery_private.immutable();
create trigger title_task_preparation_review_immutable before update or delete on icash_title_task_delivery_private.preparation_reviews for each row execute function icash_title_task_delivery_private.immutable();
create trigger title_task_preparation_review_no_truncate before truncate on icash_title_task_delivery_private.preparation_reviews for each statement execute function icash_title_task_delivery_private.immutable();

-- Preparation observations grant no send authority. Unlike the delivery source,
-- they retain malformed inputs so a permanent defect can enter durable review.
create function icash_title_task_delivery_private.preparation_source(p_account uuid,p_task uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare t public.icash_title_tasks;j public.icash_title_requests;e public.icash_signing_envelopes;document jsonb;
begin
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account;
 if not found or t.kind<>'document_update' or t.state<>'scheduled' or t.email_state<>'issued' or t.email_provider_id is not null
  or t.payload->>'type'='executed_copy' then return null;end if;
 select * into j from public.icash_title_requests where id=t.request_id and account_id=p_account and deal_id=t.deal_id;
 if t.payload->>'type'='assignment' and t.payload->>'envelopeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  select * into e from public.icash_signing_envelopes where id=(t.payload->>'envelopeId')::uuid and account_id=p_account and deal_id=t.deal_id;
  if found then document:=icash_title_copy_private.envelope_source(e);end if;
 end if;
 return jsonb_build_object('version','title-task-preparation-v1','task',to_jsonb(t)-array['email_state','email_provider_id','email_retry_at','updated_at'],
  'request',case when j.id is null then null else to_jsonb(j)-'updated_at' end,'document',document);
end $$;

create function icash_title_task_delivery_private.source(p_account uuid,p_task uuid,p_claimed boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare t public.icash_title_tasks;j public.icash_title_requests;e public.icash_signing_envelopes;document jsonb;
begin
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account;
 if not found or t.state<>'scheduled' or (case when p_claimed then t.email_state in ('dispatching','needs_review') else t.email_state='issued' end) is distinct from true or t.email_provider_id is not null
  or (t.kind='follow_up' or t.kind='document_update' and t.payload->>'type' in ('assignment','payout')) is distinct from true then return null;end if;
 select * into j from public.icash_title_requests where id=t.request_id and account_id=p_account and deal_id=t.deal_id and state='sent';
 if not found then return null;end if;
 if t.kind='document_update' and t.payload->>'type'='assignment' then
  select * into e from public.icash_signing_envelopes where id=(t.payload->>'envelopeId')::uuid and account_id=p_account and deal_id=t.deal_id
   and kind='assignment' and state='completed' and not test_mode;
  if not found or coalesce(length(btrim(e.provider_id)),0)=0 or not exists(select 1 from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account and d.terms=e.terms) then return null;end if;
  document:=icash_title_copy_private.envelope_source(e);
 end if;
 return jsonb_build_object('version','title-task-delivery-v1','task',to_jsonb(t)-array['email_state','email_provider_id','email_retry_at','updated_at'],
  'request',to_jsonb(j)-'updated_at','document',document);
end $$;
create function public.icash_title_task_delivery_snapshot(p_account uuid,p_task uuid) returns jsonb
language sql security definer set search_path='' as $$ select icash_title_task_delivery_private.source(p_account,p_task,false) $$;

create function public.icash_prepare_title_task_delivery(p_account uuid,p_task uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare preparation jsonb;delivery jsonb;
begin
 preparation:=icash_title_task_delivery_private.preparation_source(p_account,p_task);
 if preparation is null then return null;end if;
 -- Invalid UUIDs are retained for review, never passed to the send-only reader.
 if preparation->'task'->'payload'->>'type'<>'assignment' or preparation->'task'->'payload'->>'envelopeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  delivery:=icash_title_task_delivery_private.source(p_account,p_task,false);
 end if;
 return jsonb_build_object('preparation',preparation,'delivery',delivery);
end $$;

create function public.icash_review_title_task_preparation(p_account uuid,p_task uuid,p_source jsonb,p_reason text) returns boolean
language plpgsql security definer set search_path='' as $$
declare t public.icash_title_tasks;current_source jsonb;
begin
 if p_source->>'version' is distinct from 'title-task-preparation-v1'
  or p_reason is null or p_reason not in ('unsupported_update','invalid_assignment_reference','invalid_provider_id','invalid_payout') then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||(p_source->'task'->>'request_id'),0));
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 if not found or exists(select 1 from icash_title_task_delivery_private.admissions where task_id=p_task)
  or exists(select 1 from icash_title_task_delivery_private.preparation_reviews where task_id=p_task)
  or exists(select 1 from public.icash_operation_spend where operation_key='title-followup:'||p_task) then return false;end if;
 perform 1 from public.icash_title_requests where id=t.request_id for share;
 perform 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account for share;
 if t.payload->>'type'='assignment' and t.payload->>'envelopeId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
  perform 1 from public.icash_signing_envelopes where id=(t.payload->>'envelopeId')::uuid and account_id=p_account and deal_id=t.deal_id for share;
 end if;
 current_source:=icash_title_task_delivery_private.preparation_source(p_account,p_task);
 if current_source is null or current_source is distinct from p_source then return false;end if;
 insert into icash_title_task_delivery_private.preparation_reviews(task_id,account_id,source,reason) values(p_task,p_account,p_source,p_reason);
 update public.icash_title_tasks set state='needs_review',email_state='needs_review',updated_at=now() where id=p_task;
 return true;
end $$;

create function icash_title_task_delivery_private.remember(p_account uuid,p_task uuid,p_source jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare operation jsonb;
begin
 select jsonb_build_object('operationKey',o.operation_key,'accountId',o.account_id,'rateId',o.rate_id,'dispatchedAt',o.dispatched_at) into operation
 from public.icash_operation_spend o where o.operation_key='title-followup:'||p_task and o.account_id=p_account and o.state='dispatched' and o.dispatched_at is not null;
 if operation is null then raise exception 'Original title task operation required';end if;
 insert into icash_title_task_delivery_private.admissions(task_id,account_id,deal_id,request_id,source,operation_source)
 values(p_task,p_account,(p_source->'task'->>'deal_id')::uuid,(p_source->'task'->>'request_id')::uuid,p_source,operation);
end $$;

alter function public.icash_claim_title_update(uuid,uuid,jsonb) rename to icash_claim_title_update_before_task_source;
-- Older workers can retain the independently guarded executed-copy path only.
-- They cannot attach a retrospective source snapshot to a legacy PDF/send.
create function public.icash_claim_title_update(p_account uuid,p_task uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if p_payload->>'type'='executed_copy' then return public.icash_claim_title_update_before_task_source(p_account,p_task,p_payload);end if;
 return null;
end $$;
create function public.icash_claim_title_update(p_account uuid,p_task uuid,p_payload jsonb,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_source jsonb;result jsonb;
begin
 if p_snapshot->>'version' is distinct from 'title-task-delivery-v1' or p_payload->>'type' not in ('assignment','payout') then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||(p_snapshot->'task'->>'request_id'),0));
 perform 1 from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 current_source:=icash_title_task_delivery_private.source(p_account,p_task);
 if current_source is null or current_source is distinct from p_snapshot or current_source->'task'->'payload' is distinct from p_payload
  or exists(select 1 from icash_title_task_delivery_private.admissions where task_id=p_task) then return null;end if;
 result:=public.icash_claim_title_update_before_task_source(p_account,p_task,p_payload);
 if result is null then return null;end if;
 -- Existing claim locks account, task, request, deal and contact first. Lock the
 -- exact PDF row last, then re-read after all inherited waits and money writes.
 if p_payload->>'type'='assignment' then
  perform 1 from public.icash_signing_envelopes where id=(p_payload->>'envelopeId')::uuid and account_id=p_account for share;
 end if;
 if icash_title_task_delivery_private.source(p_account,p_task,true) is distinct from p_snapshot then
  raise exception using errcode='PTD01',message='Title task source changed during final admission';
 end if;
 perform icash_title_task_delivery_private.remember(p_account,p_task,p_snapshot);
 return result;
exception when sqlstate 'PTD01' then return null;
end $$;

alter function public.icash_claim_title_followup(uuid,uuid) rename to icash_claim_title_followup_before_task_source;
create function public.icash_claim_title_followup(p_account uuid,p_task uuid) returns jsonb
language sql set search_path='' as $$ select null::jsonb $$;
create function public.icash_claim_title_followup(p_account uuid,p_task uuid,p_delivery_version text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare request uuid;current_source jsonb;result jsonb;
begin
 if p_delivery_version is distinct from 'title-task-delivery-v1' then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select request_id into request from public.icash_title_tasks where id=p_task and account_id=p_account;
 if request is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||request::text,0));
 perform 1 from public.icash_title_tasks where id=p_task and account_id=p_account and request_id=request for update;
 if not found then return null;end if;
 current_source:=icash_title_task_delivery_private.source(p_account,p_task);
 if current_source is null or current_source->'task'->>'kind'<>'follow_up'
  or exists(select 1 from icash_title_task_delivery_private.admissions where task_id=p_task) then return null;end if;
 result:=public.icash_claim_title_followup_before_task_source(p_account,p_task);
 if result is null then return null;end if;
 if icash_title_task_delivery_private.source(p_account,p_task,true) is distinct from current_source then
  raise exception using errcode='PTD01',message='Title followup source changed during final admission';
 end if;
 perform icash_title_task_delivery_private.remember(p_account,p_task,current_source);
 return result;
exception when sqlstate 'PTD01' then return null;
end $$;

create function public.icash_finish_title_task_delivery(p_account uuid,p_task uuid,p_provider text) returns boolean
language plpgsql security definer set search_path='' as $$
declare a icash_title_task_delivery_private.admissions;r icash_title_task_delivery_private.receipts;t public.icash_title_tasks;bound boolean;unchanged boolean;
begin
 if coalesce(length(btrim(p_provider)),0) not between 1 and 200 then return false;end if;
 select * into a from icash_title_task_delivery_private.admissions where task_id=p_task and account_id=p_account;
 if not found then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||a.request_id::text,0));
 select * into t from public.icash_title_tasks where id=p_task for update;
 if not found or not exists(select 1 from public.icash_operation_spend o where o.operation_key='title-followup:'||p_task and o.account_id=p_account
  and o.state in ('dispatched','settled') and o.dispatched_at is not null
  and jsonb_build_object('operationKey',o.operation_key,'accountId',o.account_id,'rateId',o.rate_id,'dispatchedAt',o.dispatched_at)=a.operation_source) then return false;end if;
 select * into r from icash_title_task_delivery_private.receipts where task_id=p_task;
 if found then return r.account_id=p_account and r.provider_id=p_provider;end if;
 bound:=t.account_id=a.account_id and t.deal_id=a.deal_id and t.request_id=a.request_id;
 if bound and t.email_provider_id is not null and t.email_provider_id is distinct from p_provider then return false;end if;
 insert into icash_title_task_delivery_private.receipts(task_id,account_id,provider_id) values(p_task,p_account,p_provider);
 if bound is not true or t.email_state not in ('dispatching','needs_review','sent') then return true;end if;
 perform 1 from public.icash_title_requests where id=a.request_id for share;
 perform 1 from public.icash_deal_files where id=a.deal_id and account_id=a.account_id for share;
 if a.source->'task'->'payload'->>'type'='assignment' then
  perform 1 from public.icash_signing_envelopes where id=(a.source->'task'->'payload'->>'envelopeId')::uuid and account_id=a.account_id for share;
 end if;
 unchanged:=to_jsonb(t)-array['email_state','email_provider_id','email_retry_at','updated_at']=a.source->'task'
  and icash_title_task_delivery_private.source(p_account,p_task,true)=a.source;
 update public.icash_title_tasks set email_state='sent',email_provider_id=p_provider,state=case when unchanged then 'done' else state end,updated_at=now() where id=t.id;
 return true;
end $$;

create function public.icash_hold_title_task_delivery(p_account uuid,p_task uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare a icash_title_task_delivery_private.admissions;t public.icash_title_tasks;unchanged boolean;
begin
 select * into a from icash_title_task_delivery_private.admissions where task_id=p_task and account_id=p_account;
 if not found then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||a.request_id::text,0));
 select * into t from public.icash_title_tasks where id=p_task and account_id=p_account and deal_id=a.deal_id and request_id=a.request_id for update;
 if not found or t.email_state<>'dispatching' or t.email_provider_id is not null
  or exists(select 1 from icash_title_task_delivery_private.receipts where task_id=p_task) then return false;end if;
 unchanged:=to_jsonb(t)-array['email_state','email_provider_id','email_retry_at','updated_at']=a.source->'task';
 update public.icash_title_tasks set email_state='needs_review',state=case when unchanged then 'needs_review' else state end,updated_at=now() where id=p_task;
 return true;
end $$;

revoke all on all functions in schema icash_title_task_delivery_private from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_title_update_before_task_source(uuid,uuid,jsonb),public.icash_claim_title_followup_before_task_source(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.icash_title_task_delivery_snapshot(uuid,uuid),public.icash_claim_title_update(uuid,uuid,jsonb),public.icash_claim_title_update(uuid,uuid,jsonb,jsonb),public.icash_claim_title_followup(uuid,uuid),public.icash_claim_title_followup(uuid,uuid,text),public.icash_finish_title_task_delivery(uuid,uuid,text),public.icash_hold_title_task_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_title_task_delivery_snapshot(uuid,uuid),public.icash_claim_title_update(uuid,uuid,jsonb),public.icash_claim_title_update(uuid,uuid,jsonb,jsonb),public.icash_claim_title_followup(uuid,uuid),public.icash_claim_title_followup(uuid,uuid,text),public.icash_finish_title_task_delivery(uuid,uuid,text),public.icash_hold_title_task_delivery(uuid,uuid) to service_role;
revoke all on function public.icash_prepare_title_task_delivery(uuid,uuid),public.icash_review_title_task_preparation(uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_prepare_title_task_delivery(uuid,uuid),public.icash_review_title_task_preparation(uuid,uuid,jsonb,text) to service_role;

-- Pin the complete result as well as the predecessor, including private ACLs.
do $result_pins$
declare e record;p record;
begin
 for e in select * from (values
  ('icash_title_task_delivery_private.preparation_source(uuid,uuid)','16aa4c42917cab330ea9a8080383c3f8',true,'{postgres=X/postgres}'),
  ('public.icash_prepare_title_task_delivery(uuid,uuid)','48930fa802ee68e7052222d40d3314ae',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_review_title_task_preparation(uuid,uuid,jsonb,text)','930438a39c4bc208f8b6cfe1f445ecda',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_claim_title_followup(uuid,uuid)','cc7911886489b524c34ff20ccdda2417',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_claim_title_followup(uuid,uuid,text)','7d206d71e64899625be2a0f4faccc228',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_claim_title_followup_before_task_source(uuid,uuid)','a859fd0bc8af426017de6ce94c1994f6',false,'{postgres=X/postgres}'),
  ('public.icash_claim_title_update(uuid,uuid,jsonb)','19b735761e4710f0a7900226f1d9b55a',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_claim_title_update(uuid,uuid,jsonb,jsonb)','19af44e509be28a9255ea3384c276a38',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_claim_title_update_before_task_source(uuid,uuid,jsonb)','db9dc7334c5364c0b8ed46085c6e228e',false,'{postgres=X/postgres}'),
  ('public.icash_finish_title_task_delivery(uuid,uuid,text)','8942ff927fb80d97151c2f095bab9835',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_hold_title_task_delivery(uuid,uuid)','58c8a2055a3719a97dbf08315ae7dd9b',true,'{postgres=X/postgres,service_role=X/postgres}'),
  ('icash_title_task_delivery_private.immutable()','632c10ec58645446c474534c82b9657d',false,'{postgres=X/postgres}'),
  ('icash_title_task_delivery_private.remember(uuid,uuid,jsonb)','82aaac418fde408a3a25177de778e63a',true,'{postgres=X/postgres}'),
  ('icash_title_task_delivery_private.source(uuid,uuid,boolean)','324e8f0156b31a863788e12c257f4173',true,'{postgres=X/postgres}'),
  ('public.icash_title_task_delivery_snapshot(uuid,uuid)','b29e11f6a533efe41fb88fb27d17f8e7',true,'{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,hash,definer,acl) loop
  select md5(pg_get_functiondef(oid)) hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl
  into p from pg_proc where oid=to_regprocedure(e.signature);
  if p.hash is distinct from e.hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from e.definer
   or p.provolatile is distinct from 'v' or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
   or p.acl is distinct from e.acl then raise exception 'Title task delivery result changed: %',e.signature;end if;
 end loop;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='icash_title_task_delivery_private' and c.relkind='r' and (not c.relrowsecurity or pg_get_userbyid(c.relowner)<>'postgres'))
  or exists(select 1 from information_schema.table_privileges where table_schema='icash_title_task_delivery_private' and grantee in ('PUBLIC','anon','authenticated','service_role'))
 then raise exception 'Title task delivery private table privileges changed';end if;
end $result_pins$;
