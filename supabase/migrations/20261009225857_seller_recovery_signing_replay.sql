begin;
set local lock_timeout='3s';
create or replace function public.icash_observe_seller_recovery_contract() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Repeated completion callbacks are not a new signing outcome.
 if tg_op='UPDATE' and old.state='completed' then return new;end if;
 if new.kind='purchase' and new.state='completed' and not new.test_mode and new.provider_id is not null then
  update public.icash_seller_recovery_attempts set contract_at=coalesce(contract_at,now()) where account_id=new.account_id and deal_id=new.deal_id and delivered_at is not null and delivered_at<=now();
  update public.icash_seller_gaps set state='resolved',resolved_at=now(),resolution='Purchase signatures verified',updated_at=now() where account_id=new.account_id and deal_id=new.deal_id and stage='draft' and state in ('open','queued','waiting');
 end if;
 return new;
end $$;
commit;
