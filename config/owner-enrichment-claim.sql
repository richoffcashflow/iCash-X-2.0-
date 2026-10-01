-- Final contact dispatch gate. Does not enable discovery, contacts, campaigns or spending.
-- Keep the existing reserve/claim implementation authoritative for all billing controls.
create function public.icash_claim_owner_enrichment(
 p_account uuid,p_screening uuid,p_operation text,p_snapshot jsonb,
 p_rate uuid,p_credit_cap integer,p_unit_cost_micros bigint,
 p_quoted_data_cost_micros bigint,p_rights_until timestamptz
) returns boolean language plpgsql security invoker set search_path='' as $$
declare
 o public.icash_operation_spend;
 s public.icash_screening_jobs;
 c public.icash_discovery_configs;
 r public.icash_operation_rates;
 prop text;manual_hold boolean;fetched timestamptz;checked_at timestamptz;
begin
 if p_account is null or p_screening is null or p_operation is distinct from 'owners:'||p_account||':'||p_screening
  or jsonb_typeof(p_snapshot) is distinct from 'object' or p_rate is null
  or p_credit_cap is null or p_credit_cap not between 1 and 25
  or p_unit_cost_micros is null or p_unit_cost_micros not between 1 and 9007199254740991
  or p_quoted_data_cost_micros is null or p_quoted_data_cost_micros not between 1 and 9007199254740991
  or p_credit_cap::numeric*p_unit_cost_micros>p_quoted_data_cost_micros or p_rights_until is null then return false;end if;
 -- Match the underlying claim's budget -> operation -> account order. Existing
 -- takeover paths lock the account (and current wrappers lock budget first).
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return false;end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.account_id is distinct from p_account or o.rate_id is distinct from p_rate or o.state<>'reserved' or o.permission_until is distinct from p_rights_until then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found then return false;end if;
 select * into s from public.icash_screening_jobs where id=p_screening and account_id=p_account for share;
 if not found or s.state<>'complete' or s.snapshot is distinct from p_snapshot or s.result->'financialCheck'->>'status' is distinct from 'eligible' then return false;end if;
 prop:=s.snapshot->>'propertyId';
 if prop is null or prop !~ '^prop_[0-9]{1,20}$' or s.snapshot->'raw'->'data'->>'dm_property_id' is distinct from prop or s.snapshot->>'propertyType' is distinct from 'house' then return false;end if;
 -- Inventory rotation can already hold config before its scheduler takes budget.
 -- Fail closed instead of waiting for that row while this claim holds budget.
 begin
  select * into c from public.icash_discovery_configs where account_id=p_account for share nowait;
 exception when lock_not_available then return false;end;
 if not found or not c.enabled or not c.contacts_enabled or c.contact_rate_id is distinct from p_rate
  or c.contact_credit_cap is distinct from p_credit_cap or c.property_credit_micros is distinct from p_unit_cost_micros
  or c.data_rights_until is distinct from p_rights_until then return false;end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.operation<>'owner_enrichment'
  or jsonb_typeof(r.costs_micros->'dealmachine') is distinct from 'number'
  or (r.costs_micros->>'dealmachine')::numeric is distinct from p_quoted_data_cost_micros::numeric then return false;end if;
 -- A locked row must exist even for a property's first lookup. Do not change an
 -- existing manual choice. This also serializes direct property-control upserts.
 insert into public.icash_property_controls(account_id,property_id,manual) values(p_account,prop,false) on conflict do nothing;
 select manual into manual_hold from public.icash_property_controls where account_id=p_account and property_id=prop for update;
 if not found or manual_hold then return false;end if;
 begin fetched:=(s.snapshot->>'fetchedAt')::timestamptz;
 exception when invalid_datetime_format or datetime_field_overflow then return false;end;
 -- Use wall clock after waiting for all locks, rather than transaction-start time.
 checked_at:=clock_timestamp();
 if fetched is null or fetched<checked_at-interval '24 hours' or fetched>checked_at
  or s.completed_at is null or s.completed_at<checked_at-interval '24 hours' or s.completed_at>checked_at
  or c.data_rights_until<=checked_at or r.expires_at<=checked_at or r.verified_at>checked_at
  or o.permission_until<=checked_at then return false;end if;
 -- No weakened or copied billing implementation: activation, pause, funds, rate,
 -- reservation state and exactly-once checks remain in the existing dispatcher.
 return public.icash_claim_operation(p_operation);
end $$;
revoke all on function public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_claim_owner_enrichment(uuid,uuid,text,jsonb,uuid,integer,bigint,bigint,timestamptz) to service_role;
