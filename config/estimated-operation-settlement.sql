-- Customer billing uses the reserved rate version. Provider costs remain labeled estimates.
alter table public.icash_operation_spend add column cost_basis text not null default 'unreconciled' check(cost_basis in ('unreconciled','estimated','verified'));
create function public.icash_settle_estimated_operation(p_operation text) returns boolean language plpgsql set search_path='' as $$
declare o public.icash_operation_spend;r public.icash_operation_rates;parts jsonb;proof boolean;charge bigint;total numeric;required numeric;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 proof:=exists(select 1 from public.icash_discovery_results where operation_key=o.operation_key and account_id=o.account_id)
 or exists(select 1 from public.icash_owner_contacts where operation_key=o.operation_key and account_id=o.account_id)
 or exists(select 1 from public.icash_buyer_search_receipts b join public.icash_deal_files d on d.id=b.deal_id where b.operation_key=o.operation_key and d.account_id=o.account_id)
 or exists(select 1 from public.icash_text_messages where 'text:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state in ('accepted','delivered'))
 or exists(select 1 from public.icash_text_ai_jobs where 'sms-ai:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and usage is not null and state in ('drafted','queued','handoff','superseded'))
 or exists(select 1 from public.icash_deal_emails where 'deal-email:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='accepted')
 or exists(select 1 from public.icash_title_requests where 'title:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='sent')
 or exists(select 1 from public.icash_title_tasks where 'title-followup:'||id=o.operation_key and account_id=o.account_id and email_provider_id is not null and email_state='sent')
 or exists(select 1 from public.icash_title_qualification_jobs where 'title-qualify:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and state='sent')
 or exists(select 1 from public.icash_signing_envelopes where 'signing:'||id=o.operation_key and account_id=o.account_id and provider_id is not null and not test_mode and state in ('sent','customer_signature_needed','completed'))
 or exists(select 1 from public.icash_live_conversations where operation_key=o.operation_key and account_id=o.account_id and state='complete' and completed_at is not null);
 if not proof then return false;end if;
 evidence:='ESTIMATE: configured rate '||r.version||'; provider invoice costs not verified';
 select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',evidence)),sum(value::text::numeric) into parts,total from jsonb_each(r.costs_micros);
 required:=total*o.standard_cost_multiplier-coalesce((r.costs_micros->>'elevenlabs')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier);
 charge:=ceil(required/10000);
 if charge>o.charge_cap_cents then return false;end if;
 -- The existing atomic ledger enforces reservations, fractional pricing, and margin checks.
 perform public.icash_settle_complete_costs(o.operation_key,charge,parts,evidence);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=o.operation_key;
 return true;
end $$;
create function public.icash_settle_pending_estimates(p_account uuid default null,p_limit integer default 25) returns jsonb language plpgsql set search_path='' as $$
declare o record;finished integer:=0;held integer:=0;
begin
 if p_limit not between 1 and 100 then raise exception 'Invalid batch';end if;
 for o in select operation_key from public.icash_operation_spend where state='dispatched' and (p_account is null or account_id=p_account) order by dispatched_at limit p_limit loop
 begin
 if public.icash_settle_estimated_operation(o.operation_key) then finished:=finished+1;else held:=held+1;end if;
 exception when others then held:=held+1;
 end;
 end loop;
 return jsonb_build_object('settled',finished,'held',held,'costBasis','estimated');
end $$;
revoke all on function public.icash_settle_estimated_operation(text),public.icash_settle_pending_estimates(uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_settle_estimated_operation(text),public.icash_settle_pending_estimates(uuid,integer) to service_role;
comment on column public.icash_operation_spend.actual_micros is 'Legacy cost column. Interpret with cost_basis; estimated is not an actual vendor invoice.';
