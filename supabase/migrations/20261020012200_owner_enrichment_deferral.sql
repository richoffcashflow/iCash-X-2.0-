-- Narrow recovery of a rejected local free-preview slot, never a provider retry.
-- No historical row is changed until an explicitly reviewed per-ticket RPC call.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_automation_tickets
 add column owner_preview_deferrals integer not null default 0 check(owner_preview_deferrals between 0 and 8),
 add column owner_preview_retry_after timestamptz,
 add column owner_preview_retry_until timestamptz,
 add column owner_preview_screening_hash text check(owner_preview_screening_hash ~ '^[a-f0-9]{64}$');

-- Stable versioned hashes include the complete original evidence, not a fuzzy
-- error-message match. New retry bookkeeping does not change the legacy hash.
create function public.icash_owner_enrichment_ticket_hash(p_ticket public.icash_automation_tickets) returns text
language sql stable set search_path='' set timezone='UTC' as $$
 select encode(sha256(convert_to((to_jsonb(p_ticket)-array['owner_preview_deferrals','owner_preview_retry_after','owner_preview_retry_until','owner_preview_screening_hash'])::text,'UTF8')),'hex');
$$;
create function public.icash_owner_enrichment_screening_hash(p_screening public.icash_screening_jobs) returns text
language sql stable set search_path='' set timezone='UTC' as $$
 select encode(sha256(convert_to(to_jsonb(p_screening)::text,'UTF8')),'hex');
$$;
create table public.icash_owner_enrichment_recoveries(
 operation_key text primary key,
 ticket_id uuid not null unique references public.icash_automation_tickets(id),
 account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null unique references public.icash_screening_jobs(id),
 expected_ticket_hash text not null check(expected_ticket_hash ~ '^[a-f0-9]{64}$'),
 expected_screening_hash text not null check(expected_screening_hash ~ '^[a-f0-9]{64}$'),
 reviewed_source text not null check(length(trim(reviewed_source)) between 12 and 2000),
 reviewed_source_hash text not null check(reviewed_source_hash ~ '^[a-f0-9]{64}$'),
 code_stage text not null check(code_stage='owner_preview_pre_provider_local_rate_limit_v1'),
 approved_max_charge_cents bigint not null check(approved_max_charge_cents between 1 and 9007199254740991),
 recovered_at timestamptz not null default clock_timestamp(),
 check(operation_key='owners:'||account_id||':'||screening_id)
);
alter table public.icash_owner_enrichment_recoveries enable row level security;
revoke all on public.icash_owner_enrichment_recoveries from public,anon,authenticated,service_role;
grant select,insert on public.icash_owner_enrichment_recoveries to service_role;
create function public.icash_immutable_owner_enrichment_recovery() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Owner enrichment recovery approval is immutable';end$$;
create trigger icash_owner_enrichment_recovery_immutable before update or delete on public.icash_owner_enrichment_recoveries
 for each row execute function public.icash_immutable_owner_enrichment_recovery();

-- Absence must cover independent reservation/receipt projections, including
-- cancelled/released/zero-cost evidence. None of those proves no provider call.
create function public.icash_owner_enrichment_unstarted(p_account uuid,p_screening uuid,p_operation text) returns boolean
language sql stable set search_path='' as $$
 select p_account is not null and p_screening is not null and p_operation='owners:'||p_account||':'||p_screening
 and not exists(select 1 from public.icash_operation_spend where operation_key=p_operation)
 and not exists(select 1 from public.icash_credit_reservations where operation_key=p_operation)
 and not exists(select 1 from public.icash_cost_observations where event_key=p_operation or starts_with(event_key,p_operation||':')
  or source_ref='dealmachine:owners:'||p_operation or starts_with(source_ref,'dealmachine:owners:'||p_operation||':'))
 and not exists(select 1 from public.icash_cost_manifests where operation_key=p_operation)
 and not exists(select 1 from icash_private.provider_costs where operation_key=p_operation)
 and not exists(select 1 from public.icash_owner_contacts where screening_id=p_screening or operation_key=p_operation)
 and not exists(select 1 from public.icash_live_conversations where operation_key=p_operation or (account_id=p_account and screening_id=p_screening))
 and not exists(select 1 from public.icash_operational_contacts where account_id=p_account and screening_id=p_screening)
 and not exists(select 1 from public.icash_contact_permissions where account_id=p_account and screening_id=p_screening);
$$;

-- Additional retry gates supplement, never replace, the existing candidate
-- ranking/tenant/property/source/30-day duplicate guards and final paid claim.
create function public.icash_owner_enrichment_retry_safe(p_account uuid,p_screening uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare s public.icash_screening_jobs;stamp timestamptz;checked timestamptz:=clock_timestamp();
begin
 select * into s from public.icash_screening_jobs where id=p_screening and account_id=p_account;
 if not found or s.state<>'complete' or s.result->'financialCheck'->>'status' is distinct from 'eligible'
  or s.snapshot->>'propertyType' is distinct from 'house' or s.snapshot->'sellerRequest' is not null
  or coalesce(s.snapshot->>'practice','false')='true'
  or s.snapshot->>'propertyId' is null or s.snapshot->>'propertyId' !~ '^prop_[0-9]{1,20}$'
  or s.snapshot->'raw'->'data'->>'dm_property_id' is distinct from s.snapshot->>'propertyId'
  or not coalesce(public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state'),false)
  or s.completed_at is null or s.completed_at<=checked-interval '24 hours' or s.completed_at>checked then return false;end if;
 begin stamp:=(s.snapshot->>'fetchedAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then return false;end;
 if stamp is null or stamp<=checked-interval '24 hours' or stamp>checked then return false;end if;
 return coalesce(public.icash_owner_enrichment_unstarted(p_account,p_screening,'owners:'||p_account||':'||p_screening),false);
end $$;

create function public.icash_owner_enrichment_retry_current(p_account uuid,p_screening uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare s public.icash_screening_jobs;c public.icash_discovery_configs;r public.icash_operation_rates;stamp timestamptz;checked timestamptz:=clock_timestamp();cap bigint;
begin
 select * into s from public.icash_screening_jobs where id=p_screening and account_id=p_account;
 if not found or s.state<>'complete' or s.result->'financialCheck'->>'status' is distinct from 'eligible'
  or s.snapshot->>'propertyType' is distinct from 'house' or s.snapshot->'sellerRequest' is not null
  or coalesce(s.snapshot->>'practice','false')='true'
  or s.snapshot->>'propertyId' is null or s.snapshot->>'propertyId' !~ '^prop_[0-9]{1,20}$'
  or s.snapshot->'raw'->'data'->>'dm_property_id' is distinct from s.snapshot->>'propertyId'
  or not coalesce(public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state'),false)
  or s.completed_at is null or s.completed_at<=checked-interval '24 hours' or s.completed_at>checked then return false;end if;
 begin stamp:=(s.snapshot->>'fetchedAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then return false;end;
 if stamp is null or stamp<=checked-interval '24 hours' or stamp>checked then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or not c.enabled or not c.auto_enabled or not c.contacts_enabled or c.data_rights_until<=checked then return false;end if;
 select * into r from public.icash_operation_rates where id=c.contact_rate_id;
 if not found or not r.enabled or r.operation<>'owner_enrichment' or r.verified_at>checked or r.expires_at<=checked
  or jsonb_typeof(r.costs_micros->'dealmachine') is distinct from 'number'
  or c.contact_credit_cap::numeric*c.property_credit_micros>(r.costs_micros->>'dealmachine')::numeric then return false;end if;
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled)
  or not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
   where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents)
  or not coalesce(public.icash_membership_work_allowed(p_account),false)
  or public.icash_prospecting_available(p_account)<r.charge_cents
  or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id
   where oc.account_id=p_account and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and oc.created_at>checked-interval '30 days') then return false;end if;
 select approved_max_charge_cents into cap from public.icash_owner_enrichment_recoveries where operation_key='owners:'||p_account||':'||p_screening;
 if found and r.charge_cents>cap then return false;end if;
 return coalesce(public.icash_owner_enrichment_unstarted(p_account,p_screening,'owners:'||p_account||':'||p_screening),false);
end $$;

create function public.icash_defer_owner_enrichment(p_id uuid,p_account uuid,p_screening uuid,p_token text,p_operation text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare t public.icash_automation_tickets;s public.icash_screening_jobs;checked timestamptz;retry_at timestamptz;until_at timestamptz;screen_hash text;
begin
 if p_id is null or p_account is null or p_screening is null or p_token is null
  or p_operation is distinct from 'owners:'||p_account||':'||p_screening then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return false;end if;
 select * into t from public.icash_automation_tickets where id=p_id for update;
 checked:=clock_timestamp();
 if not found or t.account_id is distinct from p_account or t.screening_id is distinct from p_screening
  or t.kind<>'contacts' or t.state<>'consumed' or t.token is distinct from p_token
  or t.created_at>checked or t.expires_at<=checked or t.owner_preview_deferrals>=8 then return false;end if;
 select * into s from public.icash_screening_jobs where id=p_screening and account_id=p_account for share;
 if not found or not public.icash_owner_enrichment_retry_safe(p_account,p_screening) then return false;end if;
 screen_hash:=public.icash_owner_enrichment_screening_hash(s);
 if t.owner_preview_screening_hash is not null and t.owner_preview_screening_hash<>screen_hash then return false;end if;
 retry_at:=checked+make_interval(secs=>least(900,30*(2^t.owner_preview_deferrals)::integer));
 until_at:=least(s.completed_at+interval '24 hours',(s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours',
  coalesce(t.owner_preview_retry_until,checked+interval '24 hours'));
 update public.icash_automation_tickets set state='held',outcome='owner_preview_rate_limited',completed_at=checked,
  expires_at=least(expires_at,checked),owner_preview_deferrals=owner_preview_deferrals+1,
  owner_preview_retry_after=retry_at,owner_preview_retry_until=until_at,owner_preview_screening_hash=screen_hash where id=t.id;
 return true;
end $$;

-- A delayed response from an older token must never finish a later worker's
-- reissued capability. Completion can outlive expiry, but cannot outlive token identity.
create function public.icash_finish_owner_enrichment(
 p_id uuid,p_account uuid,p_screening uuid,p_token text,p_success boolean,p_outcome text
) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if p_id is null or p_account is null or p_screening is null or p_token is null or p_success is null
  or p_outcome is null or length(p_outcome)>100 then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 update public.icash_automation_tickets set state=case when p_success then 'complete' else 'held' end,
  outcome=p_outcome,completed_at=clock_timestamp()
 where id=p_id and account_id=p_account and screening_id=p_screening and kind='contacts' and token=p_token and state='consumed';
 return found;
end $$;
-- Older deployed workers still using the ID-only completion API cannot clobber
-- a deferred family's newly-issued token. Unrelated automation stays unchanged.
do $finish_guard$
declare definition text;needle text:='where id=p_id and state=''consumed''';
begin
 definition:=pg_get_functiondef('public.icash_finish_automation(uuid,boolean,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Owner enrichment completion prerequisite changed';end if;
 execute replace(definition,needle,needle||' and not (kind=''contacts'' and owner_preview_deferrals>0)');
end $finish_guard$;

-- The caller attests the reviewed, exact production code stage and log source.
-- A generic reconciliation string alone cannot authorize historical recovery.
create function public.icash_recover_owner_enrichment(
 p_id uuid,p_account uuid,p_screening uuid,p_operation text,p_expected_ticket_hash text,p_expected_screening_hash text,
 p_reviewed_source text,p_reviewed_source_hash text,p_code_stage text,p_approved_max_charge_cents bigint
) returns boolean language plpgsql security invoker set search_path='' as $$
declare t public.icash_automation_tickets;s public.icash_screening_jobs;checked timestamptz;
begin
 if p_id is null or p_account is null or p_screening is null or p_operation is distinct from 'owners:'||p_account||':'||p_screening
  or p_expected_ticket_hash is null or p_expected_ticket_hash !~ '^[a-f0-9]{64}$'
  or p_expected_screening_hash is null or p_expected_screening_hash !~ '^[a-f0-9]{64}$'
  or p_reviewed_source is null or length(trim(p_reviewed_source)) not between 12 and 2000
  or p_reviewed_source_hash is null or p_reviewed_source_hash !~ '^[a-f0-9]{64}$'
  or p_code_stage is distinct from 'owner_preview_pre_provider_local_rate_limit_v1'
  or p_approved_max_charge_cents is null or p_approved_max_charge_cents not between 1 and 9007199254740991 then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return false;end if;
 -- No repeated invocation can refresh a capability, deadline, hash or cap.
 if exists(select 1 from public.icash_owner_enrichment_recoveries where operation_key=p_operation or ticket_id=p_id or screening_id=p_screening) then return false;end if;
 select * into t from public.icash_automation_tickets where id=p_id for update;
 checked:=clock_timestamp();
 if not found or t.account_id is distinct from p_account or t.screening_id is distinct from p_screening or t.kind<>'contacts'
  or t.state<>'held' or t.outcome is distinct from 'held_for_reconciliation' or t.owner_preview_deferrals<>0
  or t.completed_at is null or t.completed_at>checked or t.created_at>t.completed_at
  or public.icash_owner_enrichment_ticket_hash(t) is distinct from p_expected_ticket_hash then return false;end if;
 select * into s from public.icash_screening_jobs where id=p_screening and account_id=p_account for share;
 if not found or public.icash_owner_enrichment_screening_hash(s) is distinct from p_expected_screening_hash
  or not public.icash_owner_enrichment_retry_safe(p_account,p_screening) then return false;end if;
 insert into public.icash_owner_enrichment_recoveries(operation_key,ticket_id,account_id,screening_id,expected_ticket_hash,expected_screening_hash,reviewed_source,reviewed_source_hash,code_stage,approved_max_charge_cents)
 values(p_operation,p_id,p_account,p_screening,p_expected_ticket_hash,p_expected_screening_hash,p_reviewed_source,p_reviewed_source_hash,p_code_stage,p_approved_max_charge_cents);
 update public.icash_automation_tickets set state='held',outcome='owner_preview_rate_limited',expires_at=least(expires_at,checked),
  owner_preview_deferrals=1,owner_preview_retry_after=checked,
  owner_preview_retry_until=least(s.completed_at+interval '24 hours',(s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours'),
  owner_preview_screening_hash=p_expected_screening_hash where id=t.id;
 -- Wake only the existing account scheduler. Never enable it or remove Pause.
 begin
  perform 1 from public.icash_discovery_configs where account_id=p_account for update nowait;
  update public.icash_discovery_configs set next_run_at=least(next_run_at,checked) where account_id=p_account;
 exception when lock_not_available then null;end;
 return true;
end $$;

-- Operation-specific persistent approval, enforced even for direct callers and
-- later rate/config changes. Credit guard executes BEFORE reservation insertion.
alter function public.icash_reserve_credit(uuid,text,bigint) rename to icash_reserve_credit_before_owner_recovery;
create function public.icash_reserve_credit(p_account uuid,p_operation text,p_amount bigint) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
 -- Match operation admission before the wrapped function locks account/wallet.
 if starts_with(p_operation,'owners:') then perform 1 from public.icash_operating_budget where id=1 for update;end if;
 return public.icash_reserve_credit_before_owner_recovery(p_account,p_operation,p_amount);
end $$;
create function public.icash_guard_owner_enrichment_recovery_credit() returns trigger
language plpgsql set search_path='' as $$
declare approval public.icash_owner_enrichment_recoveries;
begin
 if tg_op='UPDATE' and old.operation_key is distinct from new.operation_key
  and (starts_with(old.operation_key,'owners:') or starts_with(new.operation_key,'owners:')) then raise exception 'Owner enrichment recovery identity is immutable';end if;
 if new.operation_key not like 'owners:%' then return new;end if;
 -- Existing rows already exclude recovery; immutable caps need no UPDATE budget lock.
 if tg_op='INSERT' then perform 1 from public.icash_operating_budget where id=1 for update;end if;
 select * into approval from public.icash_owner_enrichment_recoveries where operation_key=new.operation_key;
 if found and (new.account_id is distinct from approval.account_id or new.amount_cents>approval.approved_max_charge_cents) then
  raise exception 'Owner enrichment recovery approval exceeded';end if;
 return new;
end $$;
create trigger icash_owner_recovery_credit_guard before insert or update on public.icash_credit_reservations
 for each row execute function public.icash_guard_owner_enrichment_recovery_credit();
create function public.icash_guard_owner_enrichment_recovery_spend() returns trigger
language plpgsql set search_path='' as $$
declare approval public.icash_owner_enrichment_recoveries;r public.icash_operation_rates;cr public.icash_credit_reservations;screen_hash text;
begin
 if tg_op='UPDATE' and old.operation_key is distinct from new.operation_key
  and (starts_with(old.operation_key,'owners:') or starts_with(new.operation_key,'owners:')) then raise exception 'Owner enrichment recovery identity is immutable';end if;
 if new.operation_key not like 'owners:%' then return new;end if;
 -- Existing rows already exclude recovery; immutable caps need no UPDATE budget lock.
 if tg_op='INSERT' then perform 1 from public.icash_operating_budget where id=1 for update;end if;
 select * into approval from public.icash_owner_enrichment_recoveries where operation_key=new.operation_key;
 if not found then return new;end if;
 if tg_op='INSERT' or (new.state='dispatched' and old.state='reserved') then
  select public.icash_owner_enrichment_screening_hash(s) into screen_hash from public.icash_screening_jobs s
   where s.id=approval.screening_id and s.account_id=approval.account_id for share;
  if screen_hash is distinct from approval.expected_screening_hash then raise exception 'Owner enrichment recovery screening changed';end if;
 end if;
 select * into r from public.icash_operation_rates where id=new.rate_id;
 select * into cr from public.icash_credit_reservations where id=new.credit_reservation_id;
 if new.account_id is distinct from approval.account_id or new.charge_cap_cents>approval.approved_max_charge_cents
  or coalesce(new.charged_cents,0)>approval.approved_max_charge_cents
  or coalesce(new.customer_price_micros,0)>approval.approved_max_charge_cents::numeric*10000
  or r.id is null or r.operation is distinct from 'owner_enrichment' or r.charge_cents>approval.approved_max_charge_cents
  or cr.id is null or cr.account_id is distinct from approval.account_id or cr.operation_key is distinct from new.operation_key
  or cr.amount_cents>approval.approved_max_charge_cents then raise exception 'Owner enrichment recovery approval exceeded';end if;
 return new;
end $$;
create trigger icash_owner_recovery_spend_guard before insert or update on public.icash_operation_spend
 for each row execute function public.icash_guard_owner_enrichment_recovery_spend();

-- Keep the complete authoritative candidate query/ranking and all legacy retry
-- guards. Add exactly one narrow new alternative, rather than copying the query.
do $migration$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 needle:=$old$(t.kind='contacts' and t.state='held' and t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id))$old$;
 replacement:=$new$(((t.kind='contacts' and t.state='held' and t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id))
  or (t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited' and t.owner_preview_deferrals>0))
 and (t.owner_preview_deferrals=0 or (t.account_id=s.account_id
  and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=clock_timestamp()
  and t.owner_preview_retry_until>clock_timestamp()
  and t.owner_preview_screening_hash=public.icash_owner_enrichment_screening_hash(s)
  and public.icash_owner_enrichment_retry_current(s.account_id,s.id))))$new$;
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Owner enrichment candidate prerequisite changed';end if;
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:='issue_attempts=public.icash_automation_tickets.issue_attempts+1';
 replacement:='issue_attempts=case when public.icash_automation_tickets.outcome=''owner_preview_rate_limited'' then public.icash_automation_tickets.issue_attempts else public.icash_automation_tickets.issue_attempts+1 end';
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Owner enrichment issuance prerequisite changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:='expires_at=now()+interval ''2 minutes'',issue_attempts=';
 replacement:='expires_at=least(now()+interval ''2 minutes'',coalesce(public.icash_automation_tickets.owner_preview_retry_until,now()+interval ''2 minutes'')),issue_attempts=';
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Owner enrichment capability expiry prerequisite changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:=' perform public.icash_settle_pending_dealmachine();';
 replacement:=needle||$terminal$
 -- Expiry/exhaustion is terminal only for this exact proven-unstarted family.
 update public.icash_automation_tickets retry_ticket set outcome=case when owner_preview_deferrals>=8 then 'owner_preview_retry_exhausted' else 'owner_preview_expired' end
 where retry_ticket.kind='contacts' and retry_ticket.state='held' and retry_ticket.outcome='owner_preview_rate_limited'
 and (retry_ticket.owner_preview_deferrals>=8 or retry_ticket.owner_preview_retry_until<=clock_timestamp())
 and public.icash_owner_enrichment_unstarted(retry_ticket.account_id,retry_ticket.screening_id,'owners:'||retry_ticket.account_id||':'||retry_ticket.screening_id);$terminal$;
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Owner enrichment terminal-hold prerequisite changed';end if;
 execute replace(definition,needle,replacement);
end $migration$;

-- A recovered operation never bypasses the final specialized claim. Checking
-- the durable bound here also returns false (rather than dispatching) on drift.
alter function public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz) rename to icash_claim_owner_before_recovery_cap;
create function public.icash_claim_owner_enrichment(
 p_account uuid,p_screening uuid,p_operation text,p_snapshot jsonb,p_rate uuid,p_credit_cap integer,p_unit_cost_micros bigint,p_quoted_data_cost_micros bigint,p_rights_until timestamptz
) returns boolean language plpgsql security invoker set search_path='' as $$
declare approval public.icash_owner_enrichment_recoveries;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into approval from public.icash_owner_enrichment_recoveries where operation_key=p_operation;
 if found and (approval.account_id is distinct from p_account or approval.screening_id is distinct from p_screening
  or not exists(select 1 from public.icash_screening_jobs s where s.id=p_screening and s.account_id=p_account
   and public.icash_owner_enrichment_screening_hash(s)=approval.expected_screening_hash)
  or not exists(select 1 from public.icash_operation_spend o join public.icash_credit_reservations cr on cr.id=o.credit_reservation_id
   join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key=p_operation and o.account_id=p_account and o.rate_id=p_rate
   and cr.account_id=p_account and cr.operation_key=p_operation and cr.amount_cents<=approval.approved_max_charge_cents
   and r.operation='owner_enrichment' and r.charge_cents<=approval.approved_max_charge_cents and o.charge_cap_cents<=approval.approved_max_charge_cents)) then return false;end if;
 return public.icash_claim_owner_before_recovery_cap(p_account,p_screening,p_operation,p_snapshot,p_rate,p_credit_cap,p_unit_cost_micros,p_quoted_data_cost_micros,p_rights_until);
end $$;

do $permissions$
declare fn regprocedure;
begin
 for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
  'icash_owner_enrichment_ticket_hash','icash_owner_enrichment_screening_hash','icash_immutable_owner_enrichment_recovery',
  'icash_owner_enrichment_unstarted','icash_owner_enrichment_retry_safe','icash_owner_enrichment_retry_current','icash_defer_owner_enrichment','icash_finish_owner_enrichment','icash_recover_owner_enrichment',
  'icash_guard_owner_enrichment_recovery_credit','icash_guard_owner_enrichment_recovery_spend','icash_reserve_credit','icash_reserve_credit_before_owner_recovery','icash_claim_owner_before_recovery_cap','icash_claim_owner_enrichment') loop
  execute 'revoke all on function '||fn||' from public,anon,authenticated';
  execute 'grant execute on function '||fn||' to service_role';
 end loop;
end $permissions$;
commit;
