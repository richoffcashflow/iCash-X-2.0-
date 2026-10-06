begin;
-- An account can trade under a company name OR an individual's full name.
-- Voice assignment, account ownership and service-only RPC permissions are unchanged.
alter table public.icash_customer_identities drop constraint icash_customer_identities_first_name_check;
alter table public.icash_customer_identities drop constraint icash_customer_identities_last_name_check;
alter table public.icash_customer_identities add constraint icash_customer_identities_first_name_check check(length(btrim(first_name))<=80);
alter table public.icash_customer_identities add constraint icash_customer_identities_last_name_check check(length(btrim(last_name))<=80);
alter table public.icash_customer_identities add constraint icash_customer_identities_principal_check check(length(btrim(company_name))>0 or (length(btrim(first_name))>0 and length(btrim(last_name))>0));
-- Archived research retains audit/cost history and is excluded by existing
-- state='complete' workspace and acquisition selectors.
alter table public.icash_screening_jobs drop constraint icash_screening_jobs_state_check;
alter table public.icash_screening_jobs add constraint icash_screening_jobs_state_check check(state in ('queued','running','complete','failed','archived'));
-- Inbound sourcing still allows calls/texts following seller submissions.
-- The policy is checked at the discovery reservation boundary, not just in UI.
-- Verified before release: the sole account and sole discovery config belong
-- to the requesting owner; no discovery tickets are issued and no jobs running.
-- Abort if another account appears before this one-time transition.
do $$begin if (select count(*) from public.icash_accounts)>1 then raise exception 'Review sourcing transition for additional accounts';end if;end$$;
update public.icash_acquisition_policy set mode='inbound',updated_at=now() where id=1;
update public.icash_discovery_configs set enabled=false,auto_enabled=false,revision=gen_random_uuid() where enabled or auto_enabled;
update public.icash_automation_tickets set state='held',outcome='inbound_only' where kind='discovery' and state='issued';
commit;
