-- Private evidence for one operator-reviewed formatting recheck. An unknown
-- outcome, charged lookup, qualified lead or assigned lead cannot be replayed.
alter table public.icash_seller_intakes add column lookup_history jsonb not null default '[]'::jsonb
  check(jsonb_typeof(lookup_history)='array' and jsonb_array_length(lookup_history)<=1);

create function public.icash_requeue_unmatched_seller_address(p_id uuid,p_review text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;
begin
 if length(trim(coalesce(p_review,''))) not between 20 and 500 then raise exception 'Formatting review reference required';end if;
 perform 1 from public.icash_seller_controls where id=1 for update;
 select * into l from public.icash_seller_intakes where id=p_id for update;
 if not found or l.state<>'unmatched' or l.checked_at is null
  or coalesce((l.lookup_costs->>'dealmachine')::bigint,-1)<>0
  or l.property is not null and l.property<>'null'::jsonb
  or l.assigned_account is not null or l.screening_id is not null
  or jsonb_array_length(l.lookup_history)<>0
  or exists(select 1 from public.icash_seller_matches where lead_id=p_id) then return false;end if;
 update public.icash_seller_intakes set lookup_history=jsonb_build_array(jsonb_build_object(
  'reviewRef',p_review,'reviewedAt',now(),'address',l.address,'state',l.state,
  'checkedAt',l.checked_at,'claimToken',l.claim_token,'lookupCosts',l.lookup_costs,
  'costBasis',l.lookup_cost_basis,'result',l.result)),
  state='received',claim_token=null,claimed_at=null,checked_at=null,hold_reason=null
 where id=p_id;
 -- Keep the original cost in the platform's allowance ledger. Failed matching
 -- is not added to a customer's successful-research charge. The normal claim
 -- must reserve a new bounded allowance and recheck data/state controls.
 return true;
end $$;
revoke all on function public.icash_requeue_unmatched_seller_address(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_requeue_unmatched_seller_address(uuid,text) to service_role;
