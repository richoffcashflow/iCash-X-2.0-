-- Forward correction for the already-installed, inactive three-touch policy.
-- Delivery proves transport, not settled cost. Preserve the legacy branch and
-- every original message/operation; only the enabled three-touch predicate changes.
set local lock_timeout='3s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare d text;old text;
begin
 d:=pg_get_functiondef('public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)'::regprocedure);
 if md5(d)<>'03b79c28737302d81e96658e09bedf2b' then
  raise exception 'Three-touch text settlement prerequisite changed';
 end if;
 if not exists(select 1 from icash_seller_recovery_private.unanswered_policy
  where id=1 and not three_touch_enabled and three_touch_activated_at is null) then
  raise exception 'Three-touch text settlement correction requires inactive rollout';
 end if;
 old:=$old$and (m.thread_id<>t.id or m.state is distinct from 'delivered' or m.provider_id is null
     or coalesce(o.dispatched_at,m.created_at) is null$old$;
 if (length(d)-length(replace(d,old,'')))<>length(old) then
  raise exception 'Three-touch text settlement predicate changed';
 end if;
 execute replace(d,old,$new$and (m.thread_id<>t.id or m.state is distinct from 'delivered' or m.provider_id is null
     or o.state is distinct from 'settled'
     or coalesce(o.dispatched_at,m.created_at) is null$new$);
end $patch$;
