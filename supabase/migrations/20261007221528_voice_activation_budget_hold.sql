-- Record only a proven pre-reservation cap rejection. Never release money or retry calls.
create or replace function public.icash_hold_voice_activation_budget(p_account uuid,p_job uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_voice_jobs where id=p_job and account_id=p_account and state='issued'
  and operation_key is null and conversation_id is null and provider_call_sid is null for update;
 if not found then return false;end if;
 if exists(select 1 from public.icash_operation_spend where operation_key='voice:'||p_job)
  or exists(select 1 from public.icash_live_conversations where operation_key='voice:'||p_job) then return false;end if;
 update public.icash_voice_jobs set state='held',outcome='activation_budget_held',updated_at=now() where id=p_job and account_id=p_account;
 update public.icash_seller_responses r set state='needs_setup',
  detail='Call paused at the account activation spending limit. Review the authorized limit before retrying; adding wallet credits alone does not change this limit.',
  outcome=r.outcome||jsonb_build_object('voice','activation_budget_held'),updated_at=now()
 where r.account_id=p_account and exists(select 1 from public.icash_voice_jobs j join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id where j.id=p_job and p.screening_id=r.screening_id);
 return true;
end $$;
revoke all on function public.icash_hold_voice_activation_budget(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_hold_voice_activation_budget(uuid,uuid) to service_role;
-- Intentionally no timed requeue. Resume only through an explicitly authorized
-- capacity review/retry after the actual activation allowance is sufficient.

-- Keep the actionable reason visible across ordinary seller-response ticks.
do $patch$
declare definition text;needle text := $needle$response_detail:='Contact setup required';$needle$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_seller_responses(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller budget detail prerequisite changed';end if;
 execute replace(definition,needle,$replacement$response_detail:=case when exists(select 1 from public.icash_voice_jobs v join public.icash_contact_permissions p on p.id=v.permission_id and p.account_id=v.account_id where p.account_id=r.account_id and p.screening_id=r.screening_id and v.state='held' and v.outcome='activation_budget_held') then 'Call paused at the account activation spending limit. Review the authorized limit before retrying; adding wallet credits alone does not change this limit.' else 'Contact setup required' end;$replacement$);
end $patch$;
