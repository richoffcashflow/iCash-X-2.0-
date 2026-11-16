-- Recover only an original, proven-unstarted ticket orphaned when its known
-- free list expired. This never revalidates or dispatches the expired list.
-- The release runner owns the schema and migration-ledger transaction.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$ begin
 if md5(pg_get_functiondef('icash_research_private.owner_preflight_cleanup_current(uuid,uuid)'::regprocedure))<>'0d121e2d08b65524021864b7370733a3'
  or md5(pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure))<>'adfaed481517e140f70a1e975c11a80b'
  or md5(pg_get_functiondef('public.icash_owner_enrichment_unstarted(uuid,uuid,text)'::regprocedure))<>'afe4b469d5908099dd5f35cdf118108a'
  or md5(pg_get_functiondef('public.icash_guard_owner_enrichment_recovery_credit()'::regprocedure))<>'da7b5e7462a600733eab219ddcb69437'
  or md5(pg_get_functiondef('public.icash_guard_owner_enrichment_recovery_spend()'::regprocedure))<>'7416b7135754d4973db2144b155d00fe'
  or md5(pg_get_functiondef('public.icash_immutable_owner_enrichment_recovery()'::regprocedure))<>'65aead56d33726747bb3b4262b66b60b'
  or md5(pg_get_functiondef('icash_research_private.guard_owner_preflight()'::regprocedure))<>'8ab46c91993dca776d10e60daf9340ae'
  or md5(pg_get_functiondef('icash_research_private.guard_owner_preflight_generation()'::regprocedure))<>'7627d5dddf3009e1f01681173d460111' then
  raise exception 'Expired preflight ticket continuation prerequisite changed';
 end if;
 if exists(select 1 from (values
  ('icash_owner_enrichment_recovery_immutable','public.icash_owner_enrichment_recoveries'::regclass,'public.icash_immutable_owner_enrichment_recovery()'::regprocedure),
  ('icash_owner_recovery_credit_guard','public.icash_credit_reservations'::regclass,'public.icash_guard_owner_enrichment_recovery_credit()'::regprocedure),
  ('icash_owner_recovery_spend_guard','public.icash_operation_spend'::regclass,'public.icash_guard_owner_enrichment_recovery_spend()'::regprocedure),
  ('owner_preflight_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight()'::regprocedure),
  ('owner_preflight_generation_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight_generation()'::regprocedure)
 ) expected(name,relation,guard) left join pg_trigger t on t.tgname=expected.name and t.tgrelid=expected.relation
 where t.oid is null or t.tgisinternal or t.tgenabled not in ('O','A') or t.tgfoid<>expected.guard)
 then raise exception 'Expired preflight ticket continuation required guards unavailable';end if;
end $guard$;
create table icash_research_private.expired_preflight_ticket_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 release_sha text,activated_at timestamptz,function_hashes jsonb not null default '{}',trigger_hashes jsonb not null default '{}',
 check(not enabled or (release_sha is not null and release_sha ~ '^[0-9a-f]{40}$' and activated_at is not null))
);
insert into icash_research_private.expired_preflight_ticket_policy(id) values(1);
create table icash_research_private.expired_preflight_ticket_continuations(
 ticket_id uuid primary key references public.icash_automation_tickets(id),
 preflight_id uuid not null unique references icash_research_private.owner_export_preflights(id),
 account_id uuid not null,screening_id uuid not null,operation_key text not null unique,
 approved_max_charge_cents bigint not null check(approved_max_charge_cents>0),
 before_ticket jsonb not null,preflight jsonb not null,configuration jsonb not null,rate jsonb not null,
 recorded_at timestamptz not null default clock_timestamp()
);
alter table icash_research_private.expired_preflight_ticket_policy enable row level security;
alter table icash_research_private.expired_preflight_ticket_continuations enable row level security;
revoke all on icash_research_private.expired_preflight_ticket_policy,icash_research_private.expired_preflight_ticket_continuations from public,anon,authenticated,service_role;
create function icash_research_private.guard_expired_preflight_ticket_continuation() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Expired preflight ticket continuation is immutable';end$$;
create trigger expired_preflight_ticket_continuation_immutable before update or delete on icash_research_private.expired_preflight_ticket_continuations
 for each row execute function icash_research_private.guard_expired_preflight_ticket_continuation();
create index expired_preflight_ticket_source on icash_research_private.expired_preflight_ticket_continuations(account_id,screening_id);
-- Older application versions must not bypass the source journal during an
-- application rollback. This fence survives disabling new ticket repairs.
create function icash_research_private.guard_continued_owner_preflight_creation() returns trigger
language plpgsql set search_path='' as $$
declare j record;p icash_research_private.owner_export_preflights;receipt jsonb;terminal boolean;
begin
 for j in select continuation.preflight_id from icash_research_private.expired_preflight_ticket_continuations continuation
  where continuation.account_id=new.account_id and exists(select 1 from jsonb_array_elements(new.items) item
   where item->>'screeningId'=continuation.screening_id::text) loop
  perform 1 from public.icash_operating_budget where id=1 for update;
  select * into p from icash_research_private.owner_export_preflights where id=j.preflight_id for share nowait;
  if not found or p.deleted_at is null or p.cleanup_token is null then raise exception 'Original continued preflight cleanup required';end if;
  select e->'receipt' into receipt from jsonb_array_elements(p.cleanup_receipts) e where e->>'token'=p.cleanup_token::text;
  begin terminal:=(receipt->>'rawText')::jsonb=receipt->'raw' and
   ((receipt->'httpStatus'='200'::jsonb and receipt#>'{raw,data,deleted}'='true'::jsonb) or receipt->'httpStatus'='404'::jsonb);
  exception when others then terminal:=false;end;
  if terminal is distinct from true then raise exception 'Original continued preflight cleanup required';end if;
 end loop;
 return new;
end$$;
create trigger continued_owner_preflight_creation before insert on icash_research_private.owner_export_preflights
 for each row execute function icash_research_private.guard_continued_owner_preflight_creation();
revoke all on function icash_research_private.guard_continued_owner_preflight_creation() from public,anon,authenticated,service_role;
-- Keep the existing DDL lock order and pin the installed family immediately
-- before replacement. This lock shares the enclosing schema/ledger transaction.
lock table public.icash_owner_enrichment_recoveries in access exclusive mode;
do $constraint$ begin
 if not exists(select 1 from pg_constraint where conrelid='public.icash_owner_enrichment_recoveries'::regclass
  and conname='icash_owner_enrichment_recoveries_code_stage_check' and contype='c' and convalidated and not connoinherit
  and md5(pg_get_constraintdef(oid))='2fa5e4892ed35117f5520875b250bbe2') then
  raise exception 'Original recovery stage constraint changed';
 end if;
end $constraint$;
alter table public.icash_owner_enrichment_recoveries drop constraint icash_owner_enrichment_recoveries_code_stage_check,
 add check(code_stage in ('owner_preview_pre_provider_local_rate_limit_v1','owner_preview_confirmed_early_cleanup_v1','owner_preview_local_record_rejection_v1','owner_preview_expired_known_list_v1'));

create index owner_expired_ticket_waiting on icash_research_private.owner_export_preflights(created_at,id) where state='waiting' and checked_at is null;

create function icash_research_private.expired_preflight_ticket_current(p_ticket uuid,p_preflight uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare t public.icash_automation_tickets;p icash_research_private.owner_export_preflights;s public.icash_screening_jobs;item jsonb;receipt jsonb;
 c public.icash_discovery_configs;r public.icash_operation_rates;
begin
 select * into t from public.icash_automation_tickets where id=p_ticket;
 if not found or t.account_id='48dfb798-8c1a-404f-88c0-c396cc067062' or t.kind<>'contacts' or t.state<>'held'
  or t.outcome is distinct from 'held' or t.owner_preview_deferrals not between 1 and 7
  or t.completed_at is null or t.completed_at>now()-interval '5 minutes' or t.expires_at>now()
  or t.owner_preview_retry_until is null or t.owner_preview_retry_until<=now()
  or t.owner_preview_retry_after is null or t.owner_preview_retry_after>now() then return false;end if;
 select * into p from icash_research_private.owner_export_preflights where id=p_preflight;
 if not found or p.account_id<>t.account_id or p.items->0->>'screeningId' is distinct from t.screening_id::text
  -- Reissue refreshes ticket.created_at; require the observed expiry-then-reissue journey.
  or p.state<>'waiting' or p.created_at>t.created_at or t.completed_at<p.created_at+interval '30 minutes'
  or p.created_at>now()-interval '30 minutes' or p.checked_at is not null
  or p.receipts ?| array['baseline','eligible'] then return false;end if;
 -- Before cleanup, the existing targeted authority must still be current.
 -- After global cleanup wins the race, require the original canonical terminal
 -- receipt and repeat every source guard; never repeat DELETE or reuse the list.
 if p.deleted_at is null then
  if p.cleanup_attempts<>0 or p.cleanup_token is not null or p.cleanup_until is not null
   or p.cleanup_receipts<>'[]'::jsonb
   or icash_research_private.owner_preflight_cleanup_current(t.account_id,p.id) is distinct from true then return false;end if;
 else
  if icash_research_private.owner_preflight_renewable(p.id) is distinct from true
   or p.deleted_at<p.created_at+interval '30 minutes' or p.deleted_at>clock_timestamp()
   or p.cleanup_attempts not between 1 and 3 or p.cleanup_token is null
   or icash_research_private.owner_preflight_list_known(p.id) is distinct from true
   or p.fingerprint is distinct from md5(jsonb_build_array(p.items,p.request)::text)
   or not exists(select 1 from icash_research_private.owner_preflight_cleanup_policy where id=1 and enabled)
   or exists(select 1 from icash_research_private.owner_export_preflights child where child.account_id=p.account_id
    and child.fingerprint=p.fingerprint and child.generation>p.generation)
   or not exists(select 1 from public.icash_accounts where id=p.account_id and not bot_paused)
   or public.icash_membership_work_allowed(p.account_id) is distinct from true
   or public.icash_owner_export_people_available(p.request->'people_ids') is distinct from true then return false;end if;
  select e->'receipt' into receipt from jsonb_array_elements(p.cleanup_receipts) e where e->>'token'=p.cleanup_token::text;
  begin
   if ((receipt->>'rawText')::jsonb=receipt->'raw' and
    ((receipt->'httpStatus'='200'::jsonb and receipt#>'{raw,data,deleted}'='true'::jsonb) or receipt->'httpStatus'='404'::jsonb)) is distinct from true then return false;end if;
  exception when others then return false;end;
  for item in select value from jsonb_array_elements(p.items) loop
   if public.icash_owner_enrichment_retry_current(p.account_id,(item->>'screeningId')::uuid) is distinct from true
    or not exists(select 1 from public.icash_screening_jobs j where j.id=(item->>'screeningId')::uuid and j.account_id=p.account_id and j.snapshot=item->'snapshot')
    or coalesce(p.request->'mobile_only','false'::jsonb) is distinct from to_jsonb(public.icash_owner_targeting_pool(p.account_id,(item->>'screeningId')::uuid)='mobile') then return false;end if;
  end loop;
 end if;
 select * into s from public.icash_screening_jobs where id=t.screening_id and account_id=t.account_id;
 if not found or public.icash_owner_enrichment_screening_hash(s) is distinct from t.owner_preview_screening_hash
  or public.icash_owner_enrichment_retry_current(t.account_id,t.screening_id) is distinct from true then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=t.account_id;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 -- Capture a restrictive CURRENT normal-admission ceiling. This is not a
 -- claim about an unrecorded historical cap. Preserve any known lower quote.
 if r.id is null or r.charge_cents<=0
  or (t.prospecting_quote_cents is not null and r.charge_cents>t.prospecting_quote_cents)
  or exists(select 1 from public.icash_owner_enrichment_recoveries
   where ticket_id=t.id or screening_id=t.screening_id or operation_key='owners:'||t.account_id||':'||t.screening_id)
  or exists(select 1 from icash_research_private.expired_preflight_ticket_continuations
   where ticket_id=t.id or preflight_id=p.id) then return false;end if;
 return true;
end$$;

create function public.icash_continue_expired_owner_preflight_ticket() returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate record;t public.icash_automation_tickets;p icash_research_private.owner_export_preflights;
 c public.icash_discovery_configs;r public.icash_operation_rates;operation text;saw_busy boolean:=false;
begin
 if not exists(select 1 from icash_research_private.expired_preflight_ticket_policy where id=1 and enabled) then return '{"status":"disabled"}';end if;
 -- The known-list candidates are finite and source-bound; only one ticket is
 -- repaired per maintenance cycle. Existing acquisition scheduling owns work.
 for candidate in select ticket_row.id ticket,preflight_row.id preflight,ticket_row.account_id
 from icash_research_private.owner_export_preflights preflight_row
 join public.icash_accounts account_row on account_row.id=preflight_row.account_id and not account_row.bot_paused
 join public.icash_automation_tickets ticket_row on ticket_row.account_id=preflight_row.account_id and ticket_row.screening_id=(preflight_row.items->0->>'screeningId')::uuid
 where preflight_row.state='waiting' and preflight_row.checked_at is null
  and preflight_row.created_at>now()-interval '24 hours' and preflight_row.created_at<=now()-interval '30 minutes'
  and ticket_row.kind='contacts' and ticket_row.state='held' and ticket_row.outcome='held' and ticket_row.owner_preview_deferrals between 1 and 7
  and ticket_row.owner_preview_retry_until>now() and icash_research_private.expired_preflight_ticket_current(ticket_row.id,preflight_row.id)
 order by preflight_row.created_at,preflight_row.id limit 8 loop
 begin
 if not pg_try_advisory_xact_lock(hashtextextended('owner-preflight:'||candidate.account_id,0)) then saw_busy:=true;continue;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update nowait;
 if not found then return '{"status":"held"}';end if;
 perform 1 from public.icash_accounts where id=candidate.account_id and not bot_paused for update nowait;
 if not found then return '{"status":"held"}';end if;
 select * into c from public.icash_discovery_configs where account_id=candidate.account_id for update nowait;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id for share nowait;
 select * into t from public.icash_automation_tickets where id=candidate.ticket for update nowait;
 select * into p from icash_research_private.owner_export_preflights where id=candidate.preflight for update nowait;
 perform 1 from public.icash_screening_jobs where id=t.screening_id and account_id=t.account_id for share nowait;
 if not exists(select 1 from icash_research_private.expired_preflight_ticket_policy where id=1 and enabled)
  or icash_research_private.expired_preflight_ticket_current(t.id,p.id) is distinct from true then continue;end if;
 operation:='owners:'||t.account_id||':'||t.screening_id;
 insert into icash_research_private.expired_preflight_ticket_continuations
 (ticket_id,preflight_id,account_id,screening_id,operation_key,approved_max_charge_cents,before_ticket,preflight,configuration,rate)
 values(t.id,p.id,t.account_id,t.screening_id,operation,r.charge_cents,to_jsonb(t),to_jsonb(p),to_jsonb(c),to_jsonb(r));
 insert into public.icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
 values(operation,t.id,t.account_id,t.screening_id,public.icash_owner_enrichment_ticket_hash(t),t.owner_preview_screening_hash,
  'Exact expired known free list and original unstarted held ticket; immutable source journal retained privately',
  encode(sha256(convert_to(jsonb_build_array(to_jsonb(t),to_jsonb(p),to_jsonb(c),to_jsonb(r))::text,'UTF8')),'hex'),
  'owner_preview_expired_known_list_v1',r.charge_cents);
 update public.icash_automation_tickets set outcome='owner_preview_rate_limited',owner_preview_retry_after=clock_timestamp() where id=t.id;
 update public.icash_discovery_configs set next_run_at=least(next_run_at,clock_timestamp()) where account_id=t.account_id;
 return jsonb_build_object('status','continued','ticketId',t.id,'preflightId',p.id);
exception when lock_not_available then saw_busy:=true;
 end;
 end loop;
 return jsonb_build_object('status',case when saw_busy then 'busy' else 'idle' end);
end$$;
revoke all on function icash_research_private.expired_preflight_ticket_current(uuid,uuid),icash_research_private.guard_expired_preflight_ticket_continuation() from public,anon,authenticated,service_role;
revoke all on function public.icash_continue_expired_owner_preflight_ticket() from public,anon,authenticated,service_role;
grant execute on function public.icash_continue_expired_owner_preflight_ticket() to service_role;

-- A repaired original ticket must reach its journaled list before any fresh
-- property preview can change the owner audience/fingerprint. This read gate
-- remains effective after rollback for already-recorded continuations.
create function public.icash_continued_owner_preflight(p_account uuid,p_primary uuid,p_candidates jsonb,p_mobile boolean) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare j icash_research_private.expired_preflight_ticket_continuations;p icash_research_private.owner_export_preflights;item jsonb;
begin
 select * into j from icash_research_private.expired_preflight_ticket_continuations where account_id=p_account and screening_id=p_primary;
 if not found then return '{"status":"none"}';end if;
 select * into p from icash_research_private.owner_export_preflights where id=j.preflight_id and account_id=p_account;
 if not found or p.items is distinct from j.preflight->'items' or p.request is distinct from j.preflight->'request'
  or p.fingerprint is distinct from j.preflight->>'fingerprint' or p.items->0->>'screeningId' is distinct from p_primary::text
  or jsonb_typeof(p_candidates) is distinct from 'array' or p_mobile is null
  or coalesce(p.request->'mobile_only','false'::jsonb) is distinct from to_jsonb(p_mobile)
  or not exists(select 1 from public.icash_automation_tickets t where t.id=j.ticket_id and t.account_id=p_account
   and t.kind='contacts' and t.screening_id=p_primary and t.owner_preview_retry_until>now())
  then return '{"status":"held"}';end if;
 for item in select value from jsonb_array_elements(p.items) loop
  if public.icash_owner_enrichment_retry_current(p_account,(item->>'screeningId')::uuid) is distinct from true
   or not exists(select 1 from jsonb_array_elements(p_candidates) candidate where candidate->>'screeningId'=item->>'screeningId'
    and candidate->'snapshot'=item->'snapshot')
   or public.icash_owner_targeting_pool(p_account,(item->>'screeningId')::uuid) is distinct from (case when p_mobile then 'mobile' else 'active' end)
   then return '{"status":"held"}';end if;
 end loop;
 return jsonb_build_object('status','bound','preflightId',p.id,'items',p.items,'request',p.request);
end$$;
revoke all on function public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean) to service_role;

set local search_path='';
update icash_research_private.expired_preflight_ticket_policy set function_hashes=(
 select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
 'public.icash_continue_expired_owner_preflight_ticket()',
 'public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)',
 'icash_research_private.guard_continued_owner_preflight_creation()',
 'icash_research_private.expired_preflight_ticket_current(uuid,uuid)',
 'icash_research_private.guard_expired_preflight_ticket_continuation()',
 'icash_research_private.owner_preflight_cleanup_current(uuid,uuid)',
 'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)',
 'public.icash_owner_enrichment_retry_current(uuid,uuid)',
 'public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
 'public.icash_owner_enrichment_screening_hash(public.icash_screening_jobs)',
 'public.icash_owner_enrichment_ticket_hash(public.icash_automation_tickets)',
 'public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)',
 'public.icash_immutable_owner_enrichment_recovery()',
 'public.icash_guard_owner_enrichment_recovery_credit()',
 'public.icash_guard_owner_enrichment_recovery_spend()',
 'icash_research_private.guard_owner_preflight()',
 'icash_research_private.guard_owner_preflight_generation()',
 'icash_research_private.owner_preflight_renewable(uuid)',
 'icash_research_private.owner_preflight_list_known(uuid,boolean)',
 'public.icash_owner_export_people_available(jsonb)',
 'public.icash_owner_targeting_pool(uuid,uuid)',
 'public.icash_membership_work_allowed(uuid)'
 ]) signature),trigger_hashes=(select jsonb_object_agg(t.tgname,md5(pg_get_triggerdef(t.oid))) from pg_trigger t
 where (t.tgrelid='icash_research_private.expired_preflight_ticket_continuations'::regclass and t.tgname='expired_preflight_ticket_continuation_immutable')
  or (t.tgrelid='public.icash_owner_enrichment_recoveries'::regclass and t.tgname='icash_owner_enrichment_recovery_immutable')
  or (t.tgrelid='public.icash_credit_reservations'::regclass and t.tgname='icash_owner_recovery_credit_guard')
  or (t.tgrelid='public.icash_operation_spend'::regclass and t.tgname='icash_owner_recovery_spend_guard')
  or (t.tgrelid='icash_research_private.owner_export_preflights'::regclass and t.tgname in ('owner_preflight_immutable','owner_preflight_generation_immutable','continued_owner_preflight_creation'))) where id=1;
create function icash_research_private.activate_expired_preflight_ticket_continuation(p_release text) returns boolean
language plpgsql set search_path='' as $$
declare p icash_research_private.expired_preflight_ticket_policy;signature text;required text[]:=array[
 'public.icash_continue_expired_owner_preflight_ticket()',
 'public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)',
 'icash_research_private.guard_continued_owner_preflight_creation()',
 'icash_research_private.expired_preflight_ticket_current(uuid,uuid)',
 'icash_research_private.guard_expired_preflight_ticket_continuation()',
 'icash_research_private.owner_preflight_cleanup_current(uuid,uuid)',
 'public.icash_claim_owner_preflight(uuid,jsonb,jsonb)',
 'public.icash_owner_enrichment_retry_current(uuid,uuid)',
 'public.icash_owner_enrichment_unstarted(uuid,uuid,text)',
 'public.icash_owner_enrichment_screening_hash(public.icash_screening_jobs)',
 'public.icash_owner_enrichment_ticket_hash(public.icash_automation_tickets)',
 'public.icash_record_owner_preflight_cleanup(uuid,uuid,jsonb)',
 'public.icash_immutable_owner_enrichment_recovery()',
 'public.icash_guard_owner_enrichment_recovery_credit()',
 'public.icash_guard_owner_enrichment_recovery_spend()',
 'icash_research_private.guard_owner_preflight()',
 'icash_research_private.guard_owner_preflight_generation()',
 'icash_research_private.owner_preflight_renewable(uuid)',
 'icash_research_private.owner_preflight_list_known(uuid,boolean)',
 'public.icash_owner_export_people_available(jsonb)',
 'public.icash_owner_targeting_pool(uuid,uuid)',
 'public.icash_membership_work_allowed(uuid)'];
begin
 if current_user<>'postgres' or p_release is null or p_release !~ '^[0-9a-f]{40}$' then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 select * into p from icash_research_private.expired_preflight_ticket_policy where id=1 for update;
 if not found or p.enabled or p.activated_at is not null or p.release_sha is not null
  or jsonb_typeof(p.function_hashes) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p.function_hashes))<>cardinality(required)
  or jsonb_typeof(p.trigger_hashes) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p.trigger_hashes))<>7 then return false;end if;
 foreach signature in array required loop
  if to_regprocedure(signature) is null or md5(pg_get_functiondef(signature::regprocedure)) is distinct from p.function_hashes->>signature then return false;end if;
 end loop;
 if exists(select 1 from (values
  ('expired_preflight_ticket_continuation_immutable','icash_research_private.expired_preflight_ticket_continuations'::regclass,'icash_research_private.guard_expired_preflight_ticket_continuation()'::regprocedure),
  ('continued_owner_preflight_creation','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_continued_owner_preflight_creation()'::regprocedure),
  ('icash_owner_enrichment_recovery_immutable','public.icash_owner_enrichment_recoveries'::regclass,'public.icash_immutable_owner_enrichment_recovery()'::regprocedure),
  ('icash_owner_recovery_credit_guard','public.icash_credit_reservations'::regclass,'public.icash_guard_owner_enrichment_recovery_credit()'::regprocedure),
  ('icash_owner_recovery_spend_guard','public.icash_operation_spend'::regclass,'public.icash_guard_owner_enrichment_recovery_spend()'::regprocedure),
  ('owner_preflight_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight()'::regprocedure),
  ('owner_preflight_generation_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight_generation()'::regprocedure)
 ) expected(name,relation,guard) left join pg_trigger t on t.tgname=expected.name and t.tgrelid=expected.relation
 where t.oid is null or t.tgisinternal or t.tgenabled not in ('O','A') or t.tgfoid<>expected.guard
  or (p.trigger_hashes->>expected.name) is distinct from md5(pg_get_triggerdef(t.oid))) then return false;end if;
 update icash_research_private.expired_preflight_ticket_policy set enabled=true,release_sha=p_release,activated_at=clock_timestamp() where id=1;
 return true;
end$$;
revoke all on function icash_research_private.activate_expired_preflight_ticket_continuation(text) from public,anon,authenticated,service_role;
