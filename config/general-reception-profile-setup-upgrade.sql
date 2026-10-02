begin;
-- LOCAL REVIEW CANDIDATE. Apply after the reception profile funding upgrade.
-- Upgrade only the installed completion RPC; preserve every setup attempt,
-- original phone snapshot, nonce, routing claim, existing config and grant.
-- This migration enables nothing and performs no provider operation.
create or replace function public.icash_complete_reception_setup(p_action text,p_nonce text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config; r icash_reception_private.setup_attempts;
begin
 if p_action is null or p_nonce is null or p_result is null or jsonb_typeof(p_result)<>'object' then return false; end if;
 select * into c from icash_reception_private.config where id=1 for update;
 select * into r from icash_reception_private.setup_attempts where action=p_action for update;
 if not found or r.nonce<>p_nonce or r.state<>'started' then return false; end if;
 if p_action in ('prepare_branch','configure_branch') then
  if c.enabled or exists(select 1 from icash_reception_private.receipts)
   or (select count(*) from jsonb_object_keys(p_result))<>7
   or p_result->>'call_profile' is distinct from c.call_profile
   or p_result->>'rate_id' is distinct from c.rate_id::text
   or p_result->'max_duration_seconds' is distinct from to_jsonb(c.max_duration_seconds)
   or p_result->'customer_charge_cap_cents' is distinct from to_jsonb(c.customer_charge_cap_cents)
   or coalesce(p_result->>'branch_id','') !~ '^agtbrch_[A-Za-z0-9]{1,160}$'
   or p_result->>'branch_id'='agtbrch_8901m3sw5tn6fvkae4d334netswh'
   or coalesce(p_result->>'reviewed_version_id','') !~ '^agtvrsn_[A-Za-z0-9]{1,160}$'
   or coalesce(p_result->>'config_hash','') !~ '^[a-f0-9]{64}$' then return false; end if;
  update icash_reception_private.config set agent_id='agent_7801m3qsygdwfv5tggatf7w68y3d',
   branch_id=p_result->>'branch_id',reviewed_version_id=p_result->>'reviewed_version_id',
   config_hash=p_result->>'config_hash' where id=1 and not enabled;
 elsif p_action not in ('route','restore') or p_result<>'{}'::jsonb then return false;
 end if;
 update icash_reception_private.setup_attempts set state='verified',finished_at=clock_timestamp(),result=p_result where action=p_action;
 return true;
end $$;
commit;
