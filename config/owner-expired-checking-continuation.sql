-- Ordered, disabled overlay after the two PR746 migrations. The migration
-- runner owns this transaction and its ledger; no provider operation runs here.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$declare signature text;expected text;begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from icash_research_private.expired_preflight_ticket_policy where id=1 and not enabled and release_sha is null and activated_at is null)
  or not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and not enabled and release_sha is null and activated_at is null)
  or exists(select 1 from icash_research_private.expired_preflight_ticket_continuations)
  then raise exception 'Checking overlay requires unactivated original continuation policies';end if;
 for signature,expected in select * from(values
  ('icash_research_private.expired_preflight_ticket_current(uuid,uuid)','945a6f97d3eb3d612ee36c2d1664c074'),
  ('public.icash_continue_expired_owner_preflight_ticket()','ac8d73729f50bc3f061e7f13f67a2603'),
  ('public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)','67e8d9e196b530293975db0051e99f71'),
  ('icash_research_private.guard_owner_preflight_quota_deferral()','2a9ca256b6dc1c8755cdc8f6a34c2448'),
  ('public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)','5255607712113f2953b00d5a6ba58057'),
  ('public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)','f716d1379f9411b5fe7b6afdf1d5fbb8')
 ) x(signature,expected) loop
  if md5(pg_get_functiondef(signature::regprocedure)) is distinct from expected then raise exception 'Checking overlay prerequisite changed: %',signature;end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='icash_research_private.owner_preflight_quota_deferrals'::regclass
  and tgname='owner_preflight_quota_immutable' and tgenabled in('O','A') and not tgisinternal
  and tgfoid='icash_research_private.guard_owner_preflight_quota_deferral()'::regprocedure)
  then raise exception 'Original local denial immutability required';end if;
 if md5(pg_get_functiondef('public.icash_take_dealmachine_request(text,uuid,text,uuid)'::regprocedure)) is distinct from
  (select function_hashes->>'public.icash_take_dealmachine_request(text,uuid,text,uuid)' from icash_research_private.owner_preflight_cleanup_policy where id=1 and enabled)
  then raise exception 'Reviewed cleanup request admission changed';end if;
end$$;

create table icash_research_private.expired_checking_policy(
 id integer primary key check(id=1),enabled boolean not null default false,release_sha text,activated_at timestamptz,
 function_hashes jsonb not null default '{}',trigger_hashes jsonb not null default '{}',
 check((release_sha is null)=(activated_at is null)),
 check(not enabled or(release_sha is not null and release_sha~'^[0-9a-f]{40}$' and activated_at is not null)));
insert into icash_research_private.expired_checking_policy(id) values(1);
create index owner_expired_checking_wait on icash_research_private.owner_export_preflights(created_at,id)
 where state='checking' and checked_at is null;
create table icash_research_private.expired_checking_proofs(
 preflight_id uuid primary key references icash_research_private.owner_export_preflights(id),
 ticket_id uuid not null unique references public.icash_automation_tickets(id),
 denial_request_id uuid not null unique references icash_research_private.requests(id),
 baseline_request_id uuid not null,proof jsonb not null,
 recorded_at timestamptz not null default clock_timestamp());
alter table icash_research_private.expired_checking_policy enable row level security;
alter table icash_research_private.expired_checking_proofs enable row level security;
revoke all on icash_research_private.expired_checking_policy,icash_research_private.expired_checking_proofs from public,anon,authenticated,service_role;
create function icash_research_private.guard_expired_checking_proof() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Original checking proof is immutable';end$$;
create trigger expired_checking_proof_immutable before update or delete on icash_research_private.expired_checking_proofs for each row execute function icash_research_private.guard_expired_checking_proof();

-- This proof does not resume a count. Both the original 30-minute source and
-- its 90-second eligible handler have expired. It permits original-list cleanup
-- only, followed by normal fresh generation after canonical terminal deletion.
create function icash_research_private.expired_checking_original_proof(p_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare p icash_research_private.owner_export_preflights;d icash_research_private.owner_preflight_quota_deferrals;
 r icash_research_private.requests;b icash_research_private.requests;receipt jsonb;item jsonb;n numeric;
begin
 if not exists(select 1 from icash_research_private.owner_export_settings where id=1 and enabled and preflight_enabled and preflight_renewal_enabled and preflight_quota_recovery_enabled)
  or not exists(select 1 from icash_research_private.owner_preflight_cleanup_policy where id=1 and enabled) then return null;end if;
 select * into p from icash_research_private.owner_export_preflights where id=p_id;
 if not found or p.state<>'checking' or p.created_at>now()-interval '30 minutes' or p.created_at<now()-interval '24 hours'
  or p.started_at>now()-interval '5 minutes' or p.started_at<p.created_at or p.checked_at is not null
  or p.fingerprint is distinct from md5(jsonb_build_array(p.items,p.request)::text)
  or (select count(*) from jsonb_object_keys(p.receipts))<>2 or not(p.receipts ?& array['create','baseline'])
  or icash_research_private.owner_preflight_list_known(p.id) is distinct from true then return null;end if;
 receipt:=p.receipts->'baseline';
 begin
  if receipt->'httpStatus' is distinct from '200'::jsonb or (receipt->>'rawText')::jsonb is distinct from receipt->'raw'
   or jsonb_typeof(receipt#>'{raw,total_people}') is distinct from 'number'
   or jsonb_typeof(receipt#>'{raw,total_results}') is distinct from 'number'
   or jsonb_typeof(receipt#>'{raw,total_properties}') is distinct from 'number'
   or jsonb_typeof(p.receipts#>'{create,raw,data,total_count}') is distinct from 'number' then return null;end if;
  n:=(receipt#>>'{raw,total_people}')::numeric;
  if n<1 or n<>trunc(n) or n>jsonb_array_length(p.request->'people_ids')
   or (receipt#>>'{raw,total_results}')::numeric<>n or (receipt#>>'{raw,total_properties}')::numeric<>n
   or (p.receipts#>>'{create,raw,data,total_count}')::numeric<>n then return null;end if;
 exception when others then return null;end;
 select * into d from icash_research_private.owner_preflight_quota_deferrals where preflight_id=p.id and lease=p.lease and step='eligible';
 if not found or d.started_at is distinct from p.started_at or d.receipts_hash is distinct from md5(p.receipts::text)
  or d.created_at not between p.started_at and p.started_at+interval '90 seconds' then return null;end if;
 select * into r from icash_research_private.requests where id=d.request_id;
 if not found or r.kind<>'owner_preview' or r.account_id is distinct from p.account_id
  or r.operation_key is distinct from 'owner-preflight:'||p.id||':eligible'
  or r.admitted is distinct from false or r.result is distinct from '{"outcome":"quota_wait"}'::jsonb
  or r.finished_at is not null or r.created_at not between p.started_at and d.created_at
  -- Any additional eligible projection is unknown, including a null admission
  -- or a delayed provider receipt. Absence is never used to infer zero cost.
  or exists(select 1 from icash_research_private.requests x where x.operation_key=r.operation_key and x.id<>r.id)
  then return null;end if;
 select * into b from icash_research_private.requests where operation_key='owner-preflight:'||p.id||':baseline'
  and created_at between p.started_at and r.created_at order by created_at,id limit 1;
 if not found or b.account_id is distinct from p.account_id or b.kind<>'owner_preview' or b.admitted is distinct from true
  or b.result->>'outcome' is distinct from 'response' or b.result->'httpStatus' is distinct from '200'::jsonb
  or b.finished_at is null or b.finished_at not between b.created_at and r.created_at
  or exists(select 1 from icash_research_private.requests x where x.operation_key=b.operation_key and x.created_at>=p.started_at and x.id<>b.id)
  then return null;end if;
 if not exists(select 1 from public.icash_accounts where id=p.account_id and not bot_paused)
  or public.icash_membership_work_allowed(p.account_id) is distinct from true
  or public.icash_owner_export_people_available(p.request->'people_ids') is distinct from true then return null;end if;
 for item in select value from jsonb_array_elements(p.items) loop
  if public.icash_owner_enrichment_retry_current(p.account_id,(item->>'screeningId')::uuid) is distinct from true
   or public.icash_owner_enrichment_unstarted(p.account_id,(item->>'screeningId')::uuid,'owners:'||p.account_id||':'||(item->>'screeningId')) is distinct from true
   or not exists(select 1 from public.icash_screening_jobs s where s.id=(item->>'screeningId')::uuid and s.account_id=p.account_id and s.snapshot=item->'snapshot')
   or coalesce(p.request->'mobile_only','false'::jsonb) is distinct from to_jsonb(public.icash_owner_targeting_pool(p.account_id,(item->>'screeningId')::uuid)='mobile') then return null;end if;
 end loop;
 return jsonb_build_object('denial',to_jsonb(r),'deferral',to_jsonb(d),'baselineRequest',to_jsonb(b),'originalReceipts',p.receipts,'originalLease',p.lease);
end$$;

alter function icash_research_private.expired_preflight_ticket_current(uuid,uuid) rename to expired_waiting_preflight_ticket_current;
create function icash_research_private.expired_preflight_ticket_current(p_ticket uuid,p_preflight uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare t public.icash_automation_tickets;p icash_research_private.owner_export_preflights;s public.icash_screening_jobs;
 c public.icash_discovery_configs;r public.icash_operation_rates;receipt jsonb;
begin
 select * into p from icash_research_private.owner_export_preflights where id=p_preflight;
 if not found then return false;end if;
 if p.state='waiting' then return icash_research_private.expired_waiting_preflight_ticket_current(p_ticket,p_preflight);end if;
 if not exists(select 1 from icash_research_private.expired_checking_policy where id=1 and enabled) then return false;end if;
 select * into t from public.icash_automation_tickets where id=p_ticket;
 if not found or t.account_id='48dfb798-8c1a-404f-88c0-c396cc067062' or t.account_id<>p.account_id
  or t.kind<>'contacts' or t.state<>'held' or t.outcome is null or t.outcome not in('held','owner_preview_rate_limited')
  or t.owner_preview_deferrals not between 1 and 7 or t.completed_at is null or t.completed_at>now()-interval '5 minutes'
  or t.expires_at>now() or t.owner_preview_retry_until is null or t.owner_preview_retry_until<=now()
  or t.owner_preview_retry_after is null or t.owner_preview_retry_after>now()
  or p.items->0->>'screeningId' is distinct from t.screening_id::text
  or t.created_at<p.created_at or t.completed_at<p.started_at
  or icash_research_private.expired_checking_original_proof(p.id) is null then return false;end if;
 if p.deleted_at is null then
  if p.cleanup_attempts<>0 or p.cleanup_token is not null or p.cleanup_until is not null or p.cleanup_receipts<>'[]'::jsonb then return false;end if;
 else
  if p.deleted_at<p.created_at+interval '30 minutes' or p.deleted_at>now() or p.cleanup_attempts not between 1 and 3
   or p.cleanup_token is null or icash_research_private.owner_preflight_renewable(p.id) is distinct from true then return false;end if;
  select e->'receipt' into receipt from jsonb_array_elements(p.cleanup_receipts) e where e->>'token'=p.cleanup_token::text;
  begin if ((receipt->>'rawText')::jsonb=receipt->'raw' and((receipt->'httpStatus'='200'::jsonb and receipt#>'{raw,data,deleted}'='true'::jsonb)or receipt->'httpStatus'='404'::jsonb)) is distinct from true then return false;end if;
  exception when others then return false;end;
 end if;
 select * into s from public.icash_screening_jobs where id=t.screening_id and account_id=t.account_id;
 select * into c from public.icash_discovery_configs where account_id=t.account_id;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 if s.id is null or t.owner_preview_screening_hash is distinct from public.icash_owner_enrichment_screening_hash(s)
  or r.id is null or r.charge_cents<=0 or(t.prospecting_quote_cents is not null and r.charge_cents>t.prospecting_quote_cents)
  or exists(select 1 from public.icash_owner_enrichment_recoveries where ticket_id=t.id or screening_id=t.screening_id or operation_key='owners:'||t.account_id||':'||t.screening_id)
  or exists(select 1 from icash_research_private.expired_preflight_ticket_continuations where ticket_id=t.id or preflight_id=p.id)
  then return false;end if;
 return true;
end$$;
create function icash_research_private.capture_expired_checking_proof() returns trigger language plpgsql set search_path='' as $$
declare proof jsonb;begin
 if new.preflight->>'state' is distinct from 'checking' then return new;end if;
 proof:=icash_research_private.expired_checking_original_proof(new.preflight_id);
 if proof is null then raise exception 'Original checking denial proof changed';end if;
 insert into icash_research_private.expired_checking_proofs(preflight_id,ticket_id,denial_request_id,baseline_request_id,proof)
 values(new.preflight_id,new.ticket_id,(proof#>>'{denial,id}')::uuid,(proof#>>'{baselineRequest,id}')::uuid,proof);
 return new;
end$$;
create trigger expired_checking_proof_capture after insert on icash_research_private.expired_preflight_ticket_continuations for each row execute function icash_research_private.capture_expired_checking_proof();

do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_continue_expired_owner_preflight_ticket()'::regprocedure);
 needle:='preflight_row.state=''waiting''';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Checking selector boundary changed';end if;
 d:=replace(d,needle,'preflight_row.state in (''waiting'',''checking'')');
 needle:='ticket_row.outcome=''held''';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Checking ticket boundary changed';end if;
 execute replace(d,needle,'ticket_row.outcome in (''held'',''owner_preview_rate_limited'')');
 d:=pg_get_functiondef('public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)'::regprocedure);
 needle:='return jsonb_build_object(''status'',''bound'',''preflightId'',p.id,''items'',p.items,''request'',p.request);';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Checking source boundary changed';end if;
 execute replace(d,needle,'return jsonb_build_object(''status'',''bound'',''preflightId'',p.id,''items'',p.items,''request'',p.request,''cleanupRequired'',p.state=''checking'' and p.deleted_at is null);');
end$$;

create function public.icash_admit_expired_checking_cleanup(p_account uuid,p_id uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p icash_research_private.owner_export_preflights;j icash_research_private.expired_preflight_ticket_continuations;
 token uuid:=gen_random_uuid();current_proof jsonb;
begin
 if p_account is null or p_id is null or p_request is null then return '{"status":"held"}';end if;
 if not pg_try_advisory_xact_lock(hashtextextended('owner-preflight:'||p_account,0)) then return '{"status":"pending"}';end if;
 begin
  perform 1 from public.icash_operating_budget where id=1 and enabled for update nowait;
  if not found then return '{"status":"held"}';end if;
  perform 1 from public.icash_accounts where id=p_account and not bot_paused for update nowait;
  if not found then return '{"status":"held"}';end if;
  select * into p from icash_research_private.owner_export_preflights where id=p_id and account_id=p_account for update nowait;
 exception when lock_not_available then return '{"status":"pending"}';end;
 if not found or p.deleted_at is not null or p.cleanup_attempts>=3 or p.cleanup_until>=clock_timestamp() then return '{"status":"held"}';end if;
 select * into j from icash_research_private.expired_preflight_ticket_continuations where preflight_id=p_id and account_id=p_account;
 if not found or p.items is distinct from j.preflight->'items' or p.request is distinct from j.preflight->'request'
  or p.fingerprint is distinct from j.preflight->>'fingerprint' then return '{"status":"held"}';end if;
 current_proof:=icash_research_private.expired_checking_original_proof(p.id);
 if current_proof is null or not exists(select 1 from icash_research_private.expired_checking_proofs where preflight_id=p.id and ticket_id=j.ticket_id and expired_checking_proofs.proof=current_proof)
  or not exists(select 1 from public.icash_automation_tickets where id=j.ticket_id and account_id=p_account and screening_id=j.screening_id and owner_preview_retry_until>now())
  -- An unknown original DELETE remains held; do not spend a successor attempt.
  or p.cleanup_attempts<>0 or p.cleanup_token is not null or p.cleanup_until is not null or p.cleanup_receipts<>'[]'::jsonb
  or exists(select 1 from icash_research_private.owner_preflight_cleanup_admissions where request_id=p_request)
  or exists(select 1 from icash_research_private.requests where id=p_request) then return '{"status":"held"}';end if;
 if public.icash_take_dealmachine_request('owner_preview',p_account,'owner-preflight-cleanup:'||p_id,p_request) is distinct from true then return '{"status":"quota_wait"}';end if;
 update icash_research_private.owner_export_preflights set cleanup_token=token,cleanup_until=clock_timestamp()+interval '5 minutes',cleanup_attempts=cleanup_attempts+1 where id=p_id;
 insert into icash_research_private.owner_preflight_cleanup_admissions(request_id,preflight_id,account_id,token,list_id) values(p_request,p_id,p_account,token,p.list_id);
 return jsonb_build_object('status','admitted','id',p_id,'accountId',p_account,'token',token,'listId',p.list_id,'requestId',p_request);
end$$;
revoke all on function public.icash_admit_expired_checking_cleanup(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_admit_expired_checking_cleanup(uuid,uuid,uuid) to service_role;
-- A definite pre-admission lock wait needs its own source witness. The
-- ordinary deferral still enforces token, seven retries and original deadline.
-- A raced/unknown cleanup admission never becomes a fresh retry authority.
create function public.icash_defer_expired_checking_cleanup(p_id uuid,p_account uuid,p_screening uuid,p_token text,p_operation text,p_preflight uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare current_proof jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found or p_operation is distinct from 'owners:'||p_account||':'||p_screening
  or not exists(select 1 from icash_research_private.expired_preflight_ticket_continuations j
   join icash_research_private.owner_export_preflights p on p.id=j.preflight_id and p.account_id=j.account_id
   where j.ticket_id=p_id and j.account_id=p_account and j.screening_id=p_screening and j.preflight_id=p_preflight
    and p.items=j.preflight->'items' and p.request=j.preflight->'request' and p.fingerprint=j.preflight->>'fingerprint'
    and p.deleted_at is null and p.cleanup_attempts=0 and p.cleanup_token is null and p.cleanup_until is null and p.cleanup_receipts='[]'::jsonb)
  then return false;end if;
 current_proof:=icash_research_private.expired_checking_original_proof(p_preflight);
 if current_proof is null or not exists(select 1 from icash_research_private.expired_checking_proofs
  where preflight_id=p_preflight and ticket_id=p_id and proof=current_proof) then return false;end if;
 return public.icash_defer_owner_enrichment(p_id,p_account,p_screening,p_token,p_operation);
end$$;
revoke all on function public.icash_defer_expired_checking_cleanup(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_defer_expired_checking_cleanup(uuid,uuid,uuid,text,text,uuid) to service_role;
revoke all on function icash_research_private.expired_preflight_ticket_current(uuid,uuid),icash_research_private.expired_waiting_preflight_ticket_current(uuid,uuid),icash_research_private.expired_checking_original_proof(uuid),icash_research_private.capture_expired_checking_proof(),icash_research_private.guard_expired_checking_proof() from public,anon,authenticated,service_role;

-- Only the never-activated PR746 manifest is refreshed. Its prior entries
-- were pinned above; the existing active cleanup policy is never rewritten.
set local search_path='';
update icash_research_private.expired_preflight_ticket_policy set function_hashes=function_hashes||(
 select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
 'icash_research_private.expired_preflight_ticket_current(uuid,uuid)',
 'public.icash_continue_expired_owner_preflight_ticket()',
 'public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)'])signature) where id=1;

create function icash_research_private.activate_expired_checking_continuation(p_release text) returns boolean language plpgsql set search_path='' as $$
declare p icash_research_private.expired_checking_policy;signature text;
 required text[]:=array['icash_research_private.expired_checking_original_proof(uuid)','icash_research_private.expired_preflight_ticket_current(uuid,uuid)','icash_research_private.expired_waiting_preflight_ticket_current(uuid,uuid)','icash_research_private.capture_expired_checking_proof()','icash_research_private.guard_expired_checking_proof()','public.icash_admit_expired_checking_cleanup(uuid,uuid,uuid)','public.icash_defer_expired_checking_cleanup(uuid,uuid,uuid,text,text,uuid)','public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)','public.icash_continue_expired_owner_preflight_ticket()','public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)','icash_research_private.guard_owner_preflight_quota_deferral()','public.icash_take_dealmachine_request(text,uuid,text,uuid)','public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)','icash_research_private.guard_continued_owner_preflight_creation()'];
begin
 if current_user<>'postgres' or p_release is null or p_release!~'^[0-9a-f]{40}$' then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found or not exists(select 1 from icash_research_private.expired_preflight_ticket_policy where id=1 and enabled and release_sha=p_release)
  or not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled and release_sha=p_release) then return false;end if;
 select * into p from icash_research_private.expired_checking_policy where id=1 for update;
 if not found or p.enabled or p.activated_at is not null or p.release_sha is not null or jsonb_typeof(p.function_hashes) is distinct from 'object'
  or(select count(*) from jsonb_object_keys(p.function_hashes))<>cardinality(required) or jsonb_typeof(p.trigger_hashes) is distinct from 'object'
  or(select count(*) from jsonb_object_keys(p.trigger_hashes))<>10 then return false;end if;
 -- Revalidate the already activated base guards at this final activation.
 if(select count(*) from jsonb_object_keys((select function_hashes from icash_research_private.expired_preflight_ticket_policy where id=1)))<>22
  or exists(select 1 from icash_research_private.expired_preflight_ticket_policy base,jsonb_each_text(base.function_hashes) entry
   where base.id=1 and(case when to_regprocedure(entry.key) is null then true else md5(pg_get_functiondef(to_regprocedure(entry.key))) is distinct from entry.value end))then return false;end if;
 foreach signature in array required loop
  if to_regprocedure(signature) is null or md5(pg_get_functiondef(signature::regprocedure)) is distinct from p.function_hashes->>signature then return false;end if;
 end loop;
 if exists(select 1 from(values
  ('expired_checking_proof_immutable','icash_research_private.expired_checking_proofs'::regclass,'icash_research_private.guard_expired_checking_proof()'::regprocedure),
  ('expired_checking_proof_capture','icash_research_private.expired_preflight_ticket_continuations'::regclass,'icash_research_private.capture_expired_checking_proof()'::regprocedure),
  ('owner_preflight_quota_immutable','icash_research_private.owner_preflight_quota_deferrals'::regclass,'icash_research_private.guard_owner_preflight_quota_deferral()'::regprocedure),
  ('expired_preflight_ticket_continuation_immutable','icash_research_private.expired_preflight_ticket_continuations'::regclass,'icash_research_private.guard_expired_preflight_ticket_continuation()'::regprocedure),
  ('continued_owner_preflight_creation','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_continued_owner_preflight_creation()'::regprocedure),
  ('icash_owner_enrichment_recovery_immutable','public.icash_owner_enrichment_recoveries'::regclass,'public.icash_immutable_owner_enrichment_recovery()'::regprocedure),
  ('icash_owner_recovery_credit_guard','public.icash_credit_reservations'::regclass,'public.icash_guard_owner_enrichment_recovery_credit()'::regprocedure),
  ('icash_owner_recovery_spend_guard','public.icash_operation_spend'::regclass,'public.icash_guard_owner_enrichment_recovery_spend()'::regprocedure),
  ('owner_preflight_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight()'::regprocedure),
  ('owner_preflight_generation_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight_generation()'::regprocedure)
 ) expected(name,relation,guard)left join pg_trigger t on t.tgname=expected.name and t.tgrelid=expected.relation
 where t.oid is null or t.tgisinternal or t.tgenabled not in('O','A') or t.tgfoid<>expected.guard or p.trigger_hashes->>expected.name is distinct from md5(pg_get_triggerdef(t.oid)))then return false;end if;
 update icash_research_private.expired_checking_policy set enabled=true,release_sha=p_release,activated_at=clock_timestamp() where id=1;
 return true;
end$$;
revoke all on function icash_research_private.activate_expired_checking_continuation(text) from public,anon,authenticated,service_role;
update icash_research_private.expired_checking_policy set function_hashes=(select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure)))from unnest(array[
 'icash_research_private.expired_checking_original_proof(uuid)','icash_research_private.expired_preflight_ticket_current(uuid,uuid)','icash_research_private.expired_waiting_preflight_ticket_current(uuid,uuid)','icash_research_private.capture_expired_checking_proof()','icash_research_private.guard_expired_checking_proof()','public.icash_admit_expired_checking_cleanup(uuid,uuid,uuid)','public.icash_defer_expired_checking_cleanup(uuid,uuid,uuid,text,text,uuid)','public.icash_defer_owner_enrichment(uuid,uuid,uuid,text,text)','public.icash_continue_expired_owner_preflight_ticket()','public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)','icash_research_private.guard_owner_preflight_quota_deferral()','public.icash_take_dealmachine_request(text,uuid,text,uuid)','public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)','icash_research_private.guard_continued_owner_preflight_creation()'])signature),
 trigger_hashes=(select jsonb_object_agg(t.tgname,md5(pg_get_triggerdef(t.oid)))from pg_trigger t where
 (t.tgrelid='icash_research_private.expired_checking_proofs'::regclass and t.tgname='expired_checking_proof_immutable')or
 (t.tgrelid='icash_research_private.expired_preflight_ticket_continuations'::regclass and t.tgname='expired_checking_proof_capture')or
 (t.tgrelid='icash_research_private.owner_preflight_quota_deferrals'::regclass and t.tgname='owner_preflight_quota_immutable')or
 (t.tgrelid='icash_research_private.expired_preflight_ticket_continuations'::regclass and t.tgname='expired_preflight_ticket_continuation_immutable')or
 (t.tgrelid='public.icash_owner_enrichment_recoveries'::regclass and t.tgname='icash_owner_enrichment_recovery_immutable')or
 (t.tgrelid='public.icash_credit_reservations'::regclass and t.tgname='icash_owner_recovery_credit_guard')or
 (t.tgrelid='public.icash_operation_spend'::regclass and t.tgname='icash_owner_recovery_spend_guard')or
 (t.tgrelid='icash_research_private.owner_export_preflights'::regclass and t.tgname in('continued_owner_preflight_creation','owner_preflight_immutable','owner_preflight_generation_immutable')))where id=1;
notify pgrst,'reload schema';
