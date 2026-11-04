-- Apply after the corrected readers and before exact-release activation.
-- Only derived evidence is invalidated; source events and financial receipts stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $$ begin
 if not exists(select 1 from icash_learning_policy_private.settings where id=1 and not enabled)
  or to_regprocedure('public.icash_activate_learning_policy(uuid,text,boolean)') is null
  or to_regprocedure('public.icash_refresh_seller_interest_v5(uuid)') is null then
  raise exception 'Disabled complete learning release required before evidence cutover';
 end if;
 perform 1 from icash_ranker_private.settings where id=1 for update;
 if exists(select 1 from icash_ranker_private.settings where id=1 and active_model is not null) then
  raise exception 'Existing qualified model requires separate evidence review';
 end if;
end $$;
-- An old training response must fail its original token check after cutover.
update icash_ranker_private.settings set lease_token=null,lease_until=null where id=1;
update icash_ranker_private.samples set refreshed_at='-infinity';
update public.icash_learning_rollups set updated_at='-infinity';
update icash_learning_policy_private.settings set evidence_after=now() where id=1;
update public.icash_learning_queue set due_at=least(due_at,now()),generation=generation+1;
commit;
