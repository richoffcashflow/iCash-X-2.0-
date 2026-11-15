-- Give a journaled, cleaned original its fair acquisition turn before its
-- immutable retry/source deadline. Ranking is never request or spend admission.
-- The release runner owns the enclosing schema and migration-ledger transaction.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;

do $guard$
declare expected record;
begin
 if not exists(select 1 from public.icash_operating_budget where id=1) then
  raise exception 'Continued original scheduling budget unavailable';
 end if;
 for expected in select * from (values
  ('public.icash_next_acquisition()','cd0baa3727f6ec05b13ab545b176ab47'),
  ('public.icash_enrichment_before_prospecting_budget(uuid)','f34de577cd36a51a37fb2fe18db133db'),
  ('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)','4743daa455436603b3bee5f31de43e15'),
  ('public.icash_owner_preflight_due_at(uuid,uuid)','ca7b3c10e5e6f9ef33fd73358e79e5c9'),
  ('icash_work_private.owner_preflight_step_due(uuid)','7205169e58cbff51c411fa7694fcc0ae'),
  ('public.icash_continued_owner_preflight(uuid,uuid,jsonb,boolean)','e5211cbb357c60e27b561e69075fdd24'),
  ('public.icash_owner_enrichment_retry_current(uuid,uuid)','a0269aaab5caf9a4fa1b34c2767979d6'),
  ('public.icash_owner_enrichment_unstarted(uuid,uuid,text)','afe4b469d5908099dd5f35cdf118108a'),
  ('public.icash_dealmachine_capacity_available(integer,uuid)','14c36dd47e50e3e1cfd0a2e5f58696ef')
 ) source(signature,hash) loop
  if md5(pg_get_functiondef(expected.signature::regprocedure)) is distinct from expected.hash then
   raise exception 'Continued original scheduling prerequisite changed: %',expected.signature;
  end if;
 end loop;
 -- This is an upgrade of the already activated production policies, not a
 -- disabled first installation. Their earlier exact-count activation manifests
 -- retain their shapes and activation receipts; no activation is replayed here.
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and scheduler_hash='af79d3cf17140cf94eff5ade974d9c84'
   and due_hash='5af0c8dd0a364999f031a76ea8fa89a2'
   and recorder_hash='4743daa455436603b3bee5f31de43e15')
  or not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and acquisition_hash='f18773412034944d2eb90b7f6d94202f')
  or not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and function_hashes->>'public.icash_next_acquisition()'='cd0baa3727f6ec05b13ab545b176ab47') then
  raise exception 'Continued original scheduling manifest changed';
 end if;
 if exists(select 1 from (values
  ('expired_preflight_ticket_continuation_immutable','icash_research_private.expired_preflight_ticket_continuations'::regclass,'icash_research_private.guard_expired_preflight_ticket_continuation()'::regprocedure),
  ('icash_owner_enrichment_recovery_immutable','public.icash_owner_enrichment_recoveries'::regclass,'public.icash_immutable_owner_enrichment_recovery()'::regprocedure),
  ('owner_preflight_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight()'::regprocedure),
  ('owner_preflight_generation_immutable','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_owner_preflight_generation()'::regprocedure),
  ('continued_owner_preflight_creation','icash_research_private.owner_export_preflights'::regclass,'icash_research_private.guard_continued_owner_preflight_creation()'::regprocedure)
 ) expected_trigger(name,relation,guard) left join pg_trigger actual on actual.tgname=expected_trigger.name and actual.tgrelid=expected_trigger.relation
 where actual.oid is null or actual.tgisinternal or actual.tgenabled not in ('O','A') or actual.tgfoid<>expected_trigger.guard) then
  raise exception 'Continued original scheduling source guard changed';
 end if;
end $guard$;

-- This source read works before issuance and for the exact just-issued ticket.
-- The latter is essential: recording a turn must not reapply a held-only test.
-- No provider request, quota claim, list creation, deadline or balance is changed.
create function icash_work_private.continued_owner_preflight_source(
 p_account uuid,p_screening uuid default null,p_issued_ticket uuid default null)
returns table(ticket_id uuid,preflight_id uuid,screening_id uuid,deadline timestamptz)
language plpgsql stable security definer set search_path='' as $function$
declare j icash_research_private.expired_preflight_ticket_continuations;
 t public.icash_automation_tickets;p icash_research_private.owner_export_preflights;
 s public.icash_screening_jobs;r public.icash_operation_rates;
 receipt jsonb;bound jsonb;original_deadline timestamptz;deadline_at timestamptz;checked timestamptz:=clock_timestamp();
begin
 if p_account is null then return;end if;
 for j in select original.* from icash_research_private.expired_preflight_ticket_continuations original
  where original.account_id=p_account and (p_screening is null or original.screening_id=p_screening)
   and (p_issued_ticket is null or original.ticket_id=p_issued_ticket)
  order by original.ticket_id loop
  select * into t from public.icash_automation_tickets where id=j.ticket_id;
  if not found or t.account_id is distinct from j.account_id or t.screening_id is distinct from j.screening_id
   or t.kind is distinct from 'contacts' or j.operation_key is distinct from 'owners:'||p_account||':'||j.screening_id
   or t.owner_preview_deferrals not between 1 and 7 or t.owner_preview_retry_after is null or t.owner_preview_retry_after>checked
   or t.owner_preview_retry_until is null or t.owner_preview_retry_until<=checked
   or t.owner_preview_screening_hash is distinct from j.before_ticket->>'owner_preview_screening_hash'
   or j.recorded_at>checked then continue;end if;
  if p_issued_ticket is null then
   if t.state is distinct from 'held' or t.outcome is distinct from 'owner_preview_rate_limited' then continue;end if;
  elsif t.id is distinct from p_issued_ticket or t.state is distinct from 'issued'
   or t.outcome is not null or t.created_at>checked or t.expires_at<=checked then continue;
  end if;
  begin original_deadline:=(j.before_ticket->>'owner_preview_retry_until')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then continue;end;
  if original_deadline is null or t.owner_preview_retry_until is distinct from original_deadline then continue;end if;
  select * into p from icash_research_private.owner_export_preflights where id=j.preflight_id and account_id=p_account;
  if not found or p.items is distinct from j.preflight->'items' or p.request is distinct from j.preflight->'request'
   or p.fingerprint is distinct from j.preflight->>'fingerprint'
   or p.items->0->>'screeningId' is distinct from j.screening_id::text
   or p.fingerprint is distinct from md5(jsonb_build_array(p.items,p.request)::text)
   or p.deleted_at is null or p.deleted_at>checked or p.deleted_at<p.created_at+interval '30 minutes'
   or p.cleanup_token is null or p.cleanup_attempts not between 1 and 3
   or icash_research_private.owner_preflight_list_known(p.id) is distinct from true
   or public.icash_owner_export_people_available(p.request->'people_ids') is distinct from true
   or exists(select 1 from icash_research_private.owner_export_preflights child
    where child.account_id=p.account_id and child.fingerprint=p.fingerprint and child.generation>p.generation)
   then continue;end if;
  select e->'receipt' into receipt from jsonb_array_elements(p.cleanup_receipts) e where e->>'token'=p.cleanup_token::text;
  begin
   if ((receipt->>'rawText')::jsonb=receipt->'raw' and
    ((receipt->'httpStatus'='200'::jsonb and receipt#>'{raw,data,deleted}'='true'::jsonb) or receipt->'httpStatus'='404'::jsonb))
    is distinct from true then continue;end if;
  exception when invalid_text_representation then continue;end;
  select * into s from public.icash_screening_jobs where id=t.screening_id and account_id=p_account;
  if not found or public.icash_owner_enrichment_screening_hash(s) is distinct from t.owner_preview_screening_hash
   or public.icash_owner_enrichment_retry_current(p_account,s.id) is distinct from true then continue;end if;
  -- Both original dates remain fixed; a favorable queue rank cannot renew them.
  begin deadline_at:=least(original_deadline,p.created_at+interval '24 hours',s.completed_at+interval '24 hours',
   (s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours');
  exception when invalid_datetime_format or datetime_field_overflow then continue;end;
  if deadline_at is null or deadline_at<=checked then continue;end if;
  if not exists(select 1 from public.icash_owner_enrichment_recoveries recovery
   where recovery.ticket_id=j.ticket_id and recovery.account_id=p_account and recovery.screening_id=j.screening_id
    and recovery.operation_key=j.operation_key and recovery.code_stage='owner_preview_expired_known_list_v1'
    and recovery.expected_screening_hash=t.owner_preview_screening_hash
    and recovery.approved_max_charge_cents=j.approved_max_charge_cents
    and recovery.reviewed_source_hash=encode(sha256(convert_to(
     jsonb_build_array(j.before_ticket,j.preflight,j.configuration,j.rate)::text,'UTF8')),'hex')) then continue;end if;
  select rates.* into r from public.icash_discovery_configs configs
   join public.icash_operation_rates rates on rates.id=configs.contact_rate_id where configs.account_id=p_account;
  if not found or r.charge_cents>j.approved_max_charge_cents
   or public.icash_prospecting_available(p_account)<public.icash_research_admission_quote(p_account,'owner_enrichment',r.charge_cents)
   then continue;end if;
  -- The existing journal-bound adapter checks every original cohort member's
  -- current retry/source/targeting authority. Preserve same-property money holds.
  bound:=public.icash_continued_owner_preflight(p_account,j.screening_id,p.items,coalesce((p.request->>'mobile_only')::boolean,false));
  if bound->>'status' is distinct from 'bound' or bound->>'preflightId' is distinct from p.id::text
   or exists(select 1 from jsonb_array_elements(p.items) item
    where not exists(select 1 from public.icash_screening_jobs original_screening
     where original_screening.id=(item->>'screeningId')::uuid and original_screening.account_id=p_account
      and original_screening.snapshot=item->'snapshot')
    or exists(select 1 from public.icash_operation_spend spent
     join public.icash_screening_jobs prior on spent.operation_key='owners:'||p_account||':'||prior.id
     where prior.account_id=p_account and prior.snapshot->>'propertyId'=item->'snapshot'->>'propertyId'
      and spent.state in ('reserved','dispatched'))) then continue;end if;
  return query select t.id,p.id,t.screening_id,deadline_at;
 end loop;
end $function$;
revoke all on function icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid) from public,anon,authenticated,service_role;

-- Kept separate from owner_preflight_due_at/step_due: a cleaned list needs a
-- fresh generation and the original THREE requests. It is never a two-step list.
create function icash_work_private.continued_owner_preflight_deadline(p_account uuid,p_screening uuid default null)
returns timestamptz language plpgsql stable security definer set search_path='' as $function$
begin
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled)
  or public.icash_dealmachine_capacity_available(3,p_account) is distinct from true
  or (public.icash_owner_active_export_capacity(p_account) in ('disabled','ready')) is distinct from true then return null;end if;
 return (select min(original.deadline) from icash_work_private.continued_owner_preflight_source(p_account,p_screening,null) original);
end $function$;
revoke all on function icash_work_private.continued_owner_preflight_deadline(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function icash_work_private.continued_owner_preflight_deadline(uuid,uuid) to service_role;

-- Derive the live-list ranking from the exact existing due predicate. Only
-- its projection changes; no unrelated sibling can supply an earlier deadline.
-- Waiting and READY lists keep their respective original 30-minute clocks.
do $live_deadline$
declare d text:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);needle text;replacement text;
begin
 needle:='public.icash_owner_preflight_due_at(p_account uuid, p_screening uuid DEFAULT NULL::uuid)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Live continuation deadline signature changed';end if;
 d:=replace(d,needle,'icash_work_private.live_owner_preflight_deadline(p_account uuid, p_screening uuid DEFAULT NULL::uuid)');
 needle:='select p.id,p.account_id,p.items,p.state,p.checked_at,p.next_check_at';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Live continuation source projection changed';end if;
 d:=replace(d,needle,'select p.id,p.account_id,p.items,p.state,p.checked_at,p.created_at,p.next_check_at');
 needle:='select p.id,p.account_id,p.items,case when p.state=';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Live continuation eligible projection changed';end if;
 d:=replace(d,needle,'select p.id,p.account_id,p.items,p.state,p.checked_at,p.created_at,case when p.state=');
 needle:='select min(p.next_check_at) from due p';
 replacement:='select min(least(
  (case when p.state=''ready'' then p.checked_at else p.created_at end)+interval ''30 minutes'',
  t.owner_preview_retry_until,s.completed_at+interval ''24 hours'',
  case when pg_catalog.pg_input_is_valid(s.snapshot->>''fetchedAt'',''timestamp with time zone'')
   then (s.snapshot->>''fetchedAt'')::timestamptz+interval ''24 hours'' end)) from due p';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Live continuation deadline projection changed';end if;
 execute replace(d,needle,replacement);
end $live_deadline$;
revoke all on function icash_work_private.live_owner_preflight_deadline(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function icash_work_private.live_owner_preflight_deadline(uuid,uuid) to service_role;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:='then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end is not null)=continuation_turn)';
 replacement:='then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end is not null
     or icash_work_private.continued_owner_preflight_deadline(d.account_id,null::uuid) is not null)=continuation_turn)';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued original fair class changed';end if;
 d:=replace(d,needle,replacement);
 needle:='  -- Ordinary overdue accounts retain an aging escape from the due-list queue.';
 replacement:='  -- Only continuation turns compare both original source deadlines ahead of aging.
  -- Ordinary turns retain their original account order and one-in-three share.
  case when continuation_enabled and continuation_turn then
   least(icash_work_private.live_owner_preflight_deadline(d.account_id,null::uuid),
    icash_work_private.continued_owner_preflight_deadline(d.account_id,null::uuid)) end nulls last,
'||needle;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued original deadline order changed';end if;
 d:=replace(d,needle,replacement);
 needle:='was_continuation:=continuation_enabled and public.icash_owner_preflight_due_at(c.account_id,j) is not null;';
 replacement:='was_continuation:=continuation_enabled and (public.icash_owner_preflight_due_at(c.account_id,j) is not null
  or icash_work_private.continued_owner_preflight_deadline(c.account_id,j) is not null);';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued original issue class changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 needle:=' order by public.icash_owner_preflight_due_at(p_account,(c.screening).id) nulls last,';
 replacement:=' order by case when exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled and issued%3<>2)
   then least(icash_work_private.live_owner_preflight_deadline(p_account,(c.screening).id),
    icash_work_private.continued_owner_preflight_deadline(p_account,(c.screening).id)) end nulls last,
  public.icash_owner_preflight_due_at(p_account,(c.screening).id) nulls last,';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued original property order changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure);
 needle:='  if source_id is null then raise exception ''Continuation source changed'';end if;';
 replacement:='  if source_id is null then
   select original.preflight_id into source_id
    from icash_work_private.continued_owner_preflight_source(p_account,p_screening,p_ticket) original;
  end if;
'||needle;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Continued original recorder source changed';end if;
 execute replace(d,needle,replacement);
end $patch$;

-- Patch only hashes of functions changed here. The separately captured source
-- hashes make this upgrade reviewable without accepting unrelated definition
-- drift or changing any enabled flag, turn counter, release or activation time.
alter table icash_work_private.continuation_policy add column continued_original_hashes jsonb not null default '{}';
update icash_work_private.continuation_policy set
 scheduler_hash=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)),
 recorder_hash=md5(pg_get_functiondef('icash_work_private.record_continuation_decision(uuid,uuid,uuid,boolean)'::regprocedure)),
 continued_original_hashes=(select jsonb_object_agg(signature,md5(pg_get_functiondef(signature::regprocedure))) from unnest(array[
  'icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)',
  'icash_work_private.continued_owner_preflight_deadline(uuid,uuid)',
  'icash_work_private.live_owner_preflight_deadline(uuid,uuid)',
  'public.icash_enrichment_before_prospecting_budget(uuid)'
 ]) signature) where id=1;
update icash_work_private.preflight_step_policy set function_hashes=jsonb_set(function_hashes,
 array['public.icash_next_acquisition()'],to_jsonb(md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)))) where id=1;
update icash_research_private.acquisition_headroom_policy set
 acquisition_hash=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)) where id=1;
