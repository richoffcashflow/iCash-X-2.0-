-- Synthetic extension of voice-predial-foundation.sql. No customer or provider data.
grant usage on schema public to public;
alter table public.icash_operation_spend add constraint fixture_operation_account unique(operation_key,account_id);
alter table public.icash_operation_spend add column cost_basis text;
alter table public.icash_credit_reservations add column settled_cents bigint;
alter table public.icash_credit_reservations add constraint fixture_credit_operation unique(operation_key);
create table public.icash_wallets(account_id uuid primary key,balance_cents bigint not null,reserved_cents bigint not null default 0);
create table public.icash_credit_ledger(id bigint generated always as identity primary key,account_id uuid,event_key text unique,kind text,delta_cents bigint,evidence_ref text,created_at timestamptz default now());
create table public.icash_usage_coverage(operation_key text primary key,account_id uuid,gross_cents bigint,customer_cents bigint,covered_cents bigint,evidence_ref text);
create function public.icash_discovery_no_new_inventory(uuid,text) returns boolean language sql as $$select false$$;
drop function public.icash_finish_credit(uuid,text,bigint,text);
CREATE OR REPLACE FUNCTION public.icash_finish_credit(p_account uuid, p_operation text, p_charge bigint, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.icash_credit_reservations; desired text; available bigint; covered bigint;
begin
 if p_charge is null or p_charge<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Invalid settlement'; end if;
 select balance_cents into available from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where account_id=p_account and operation_key=p_operation for update;
 if not found then raise exception 'Reservation missing'; end if;
 desired:=case when p_charge=0 then 'released' else 'settled' end;
 if r.status<>'reserved' then
  if r.status=desired and coalesce(r.settled_cents,0)=p_charge then return r.status; end if;
  raise exception 'Settlement conflict';
 end if;
 if p_charge>r.amount_cents then raise exception 'Charge exceeds reservation'; end if;
 -- Concurrent completed work may consume the last credits before this receipt.
 -- Record platform-covered overrun explicitly; never debit below zero or retry a charge.
 covered:=case when public.icash_discovery_no_new_inventory(p_account,p_operation) then p_charge else greatest(0,p_charge-available) end;
 if covered>0 then
  insert into public.icash_usage_coverage(account_id,operation_key,gross_cents,customer_cents,covered_cents,evidence_ref)
  values(p_account,p_operation,p_charge,p_charge-covered,covered,p_evidence);
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage-coverage:'||p_operation,'grant',covered,'Platform-covered usage; no customer debt: '||p_evidence);
 end if;
 if p_charge>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage:'||p_operation,'usage',-p_charge,p_evidence);
 end if;
 update public.icash_wallets set balance_cents=balance_cents+covered-p_charge,reserved_cents=0 where account_id=p_account;
 update public.icash_credit_reservations set status=desired,settled_cents=case when p_charge>0 then p_charge else null end where id=r.id;
 return desired;
end; $function$
;
alter table public.icash_call_recordings
 add column state text not null default 'consent_pending',
 add column row_version bigint not null default 1,
 add column last_action text not null default 'create',
 add column last_error text,
 add column consent_at timestamptz,add column consent_evidence jsonb,
 add column recording_authorized_at timestamptz,
 add column start_claimed_at timestamptz,add column register_claimed_at timestamptz,
 add column provider_started_at timestamptz,add column final_provider_started_at timestamptz,
 add column ended_at timestamptz,add column duration_seconds integer,
 add column audio_expires_at timestamptz,add column deleted_at timestamptz,
 add column end_requested_at timestamptz,add column call_ended_at timestamptz,
 add column provider_recording_price_micros bigint,add column price_is_estimate boolean not null default true,
 add column reconcile_attempts integer not null default 0,
 add column reconcile_lease_token uuid,add column reconcile_lease_expires_at timestamptz,
 add column next_delete_at timestamptz,add column deletion_attempts integer not null default 0,
 add column deletion_lease_token uuid,add column deletion_lease_expires_at timestamptz;
create table public.icash_recorded_gate_terminal_receipts(recording_id uuid);
create table icash_recording_private.terminal_cost_receipts(recording_id uuid);
create table icash_recording_private.call_creation_rejections(recording_id uuid);
create table icash_recording_private.predial_aborts(operation_key text);
alter table icash_recording_private.capacity_quarantines
 add column account_id uuid,add column voice_job_id uuid,add column recording_id uuid,
 add column contact_key text,add column reason text,
 add column quarantined_at timestamptz not null default clock_timestamp(),add column evidence jsonb;
create trigger fixture_quarantine_immutable before update or delete on icash_recording_private.capacity_quarantines
 for each row execute function icash_recording_private.audit_immutable();
create trigger fixture_quarantine_no_truncate before truncate on icash_recording_private.capacity_quarantines
 for each statement execute function icash_recording_private.audit_immutable();
create function public.icash_operational_contact_current(uuid,uuid,text,boolean) returns boolean language sql as $$select true$$;
create function public.fixture_undialed_housekeeping(p_id uuid,p_steps integer) returns void language plpgsql as $$
begin
 for i in 1..p_steps loop
  update public.icash_call_recordings set row_version=row_version+1,last_action='reconcile_retry',
   updated_at=clock_timestamp(),next_reconcile_at=clock_timestamp()+interval '15 minutes' where id=p_id;
 end loop;
end$$;
