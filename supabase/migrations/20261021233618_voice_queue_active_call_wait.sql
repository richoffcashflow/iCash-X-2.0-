-- Keep queued calls behind existing account/recipient work instead of issuing
-- tickets that final admission must reject. This never releases a prior hold.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_voice_jobs_active_slot on public.icash_voice_jobs(account_id,permission_id,operational_contact_id)
 where state in ('issued','dispatching') or (state='held' and outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'));
create index icash_live_active_slot on public.icash_live_conversations(account_id,contact_key)
 where state in ('waiting','review');
create function public.icash_voice_queue_slot_open(p_account uuid,p_job uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
   and target.account_id=j.account_id and target.party='seller' and target.contact_key is not null
   and ((j.permission_id is not null and j.operational_contact_id is null and target.eligibility_source='operator_record')
    or (j.permission_id is null and j.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
  where j.id=p_job and j.account_id=p_account and j.state='ready'
  and not exists(
   select 1 from public.icash_voice_jobs busy where busy.id<>j.id
    and (busy.state in ('issued','dispatching') or (busy.state='held' and busy.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))
    and (busy.account_id=j.account_id or exists(
     select 1 from public.icash_voice_contact_targets other where other.id=coalesce(busy.permission_id,busy.operational_contact_id)
      and other.account_id=busy.account_id and other.contact_key=target.contact_key
      and ((busy.permission_id is not null and busy.operational_contact_id is null and other.eligibility_source='operator_record')
       or (busy.permission_id is null and busy.operational_contact_id is not null and other.eligibility_source='operational_checks_only')))))
  and not exists(select 1 from public.icash_live_conversations live where live.state in ('waiting','review')
   and (live.account_id=j.account_id or live.contact_key=target.contact_key))
 );
$$;
revoke all on function public.icash_voice_queue_slot_open(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_voice_queue_slot_open(uuid,uuid) to service_role;
do $patch$
declare definition text;needle text:='where v.state=''ready'' and v.due_at<=now()';
begin
 definition:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2
  or position('icash_voice_queue_slot_open' in definition)>0 then raise exception 'Voice issuer prerequisite changed';end if;
 -- Both urgent and fair selections filter before LIMIT; final dispatch still
 -- rechecks every control and serializes claims against concurrent changes.
 execute replace(definition,needle,needle||E'\n and public.icash_voice_queue_slot_open(v.account_id,v.id)');
end $patch$;
commit;
