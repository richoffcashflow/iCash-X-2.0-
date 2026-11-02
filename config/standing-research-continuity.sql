-- Complete the existing standing-review rollout without touching held purchases.
begin;
set local lock_timeout='5s';
create function public.icash_repair_standing_research(p_account uuid) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $fn$
declare c public.icash_discovery_configs;r public.icash_operation_rates;n public.icash_operation_rates;
 mapping jsonb:='{}';base uuid;new_base uuid;after_value jsonb;item record;
 old_until constant timestamptz:='2026-10-29 14:41:50.348487+00';
 standing_until constant timestamptz:='9999-12-31T23:59:59Z';
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or p_account='48dfb798-8c1a-404f-88c0-c396cc067062'
  or not public.icash_membership_work_allowed(p_account)
  or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
  or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from public.icash_support_cancel_requests where account_id=p_account and confirmed_at is not null) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.enabled or not c.auto_enabled or not c.contacts_enabled or c.data_rights_until<>old_until then return false;end if;
 -- Only quarantined searches in a different ZIP may coexist with this change.
 -- Current/unknown purchases keep their exact config and remain visible outages.
 if exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates rate on rate.id=o.rate_id
  where o.account_id=p_account and o.state in ('reserved','dispatched') and rate.operation='property_search'
   and not exists(select 1 from icash_research_private.stalled_searches s
    where s.operation_key=o.operation_key and s.account_id=p_account and s.zip<>c.zip
     and s.configuration->>'rate_id'=o.rate_id::text
     and s.configuration->>'account_id'=p_account::text)) then return false;end if;
 if exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind in ('discovery','contacts')
  and (state='issued' and expires_at>now() or state='consumed' and expires_at>now()-interval '5 minutes')) then return false;end if;
 select base_rate into base from icash_research_private.account_rates where account_id=p_account;
 for r in select * from public.icash_operation_rates where id in(c.rate_id,c.contact_rate_id,base) loop
  if not r.enabled or r.expires_at<>old_until then return false;end if;
  select * into n from public.icash_operation_rates where version=r.version||':standing-research-20261026';
  if not found or not n.enabled or n.expires_at<>standing_until
   or (to_jsonb(n)-array['id','version','expires_at']) is distinct from (to_jsonb(r)-array['id','version','expires_at'])
   or not exists(select 1 from icash_owner_review_private.changes
    where kind='rate' and record_key=r.id::text and before_row=to_jsonb(r) and after_row=to_jsonb(n)) then return false;end if;
  mapping:=mapping||jsonb_build_object(r.id::text,n.id);
 end loop;
 if not(mapping ? c.rate_id::text and mapping ? c.contact_rate_id::text)
  or base is not null and (not(mapping ? base::text) or (base<>c.rate_id and not exists(
   select 1 from icash_research_private.rate_versions where base_rate=base and batch_rate=c.rate_id and unit_micros=c.property_credit_micros))) then return false;end if;
 -- Same cursor, scope and caps. Original owner-contact receipts bind to their
 -- operation/source and do not use these current rate IDs for settlement.
 update public.icash_discovery_configs set rate_id=(mapping->>c.rate_id::text)::uuid,
  contact_rate_id=(mapping->>c.contact_rate_id::text)::uuid,data_rights_until=standing_until,
  next_run_at=least(next_run_at,now()) where account_id=p_account returning to_jsonb(icash_discovery_configs.*) into after_value;
 insert into icash_owner_review_private.changes(kind,record_key,before_row,after_row,authority)
 values('discovery_continuation',p_account::text,to_jsonb(c),after_value,
 'Owner repair 2026-11-02; complete already-approved 2026-10-26 review for independent work; original unknown operations and ZIP fences unchanged');
 if base is not null then
  update icash_research_private.account_rates set base_rate=(mapping->>base::text)::uuid where account_id=p_account;
  insert into icash_owner_review_private.changes(kind,record_key,before_row,after_row,authority)
  values('account_rate_continuation',p_account::text,jsonb_build_object('account_id',p_account,'base_rate',base),
   jsonb_build_object('account_id',p_account,'base_rate',(mapping->>base::text)::uuid),'Exact standing rate lineage; original operations unchanged');
 end if;
 for item in select * from public.icash_inventory_markets where account_id=p_account and eligible_until=old_until for update loop
  update public.icash_inventory_markets set eligible_until=standing_until where account_id=p_account and zip=item.zip returning to_jsonb(icash_inventory_markets.*) into after_value;
  insert into icash_owner_review_private.changes(kind,record_key,before_row,after_row,authority)
  values('inventory_continuation',p_account::text||':'||item.zip,to_jsonb(item),after_value,
  'Same saved geography under existing standing owner review; no source evidence renewed');
 end loop;
 return true;
end $fn$;
create function public.icash_repair_expired_research_configs() returns integer
language plpgsql security definer set search_path='' set lock_timeout='1s' set statement_timeout='5s' as $fn$
declare a uuid;repaired integer:=0;
begin
 for a in select d.account_id from public.icash_discovery_configs d join public.icash_accounts a on a.id=d.account_id
  where d.enabled and d.auto_enabled and d.contacts_enabled and not a.bot_paused
   and d.data_rights_until='2026-10-29 14:41:50.348487+00'::timestamptz
   and a.id<>'48dfb798-8c1a-404f-88c0-c396cc067062'
  order by d.account_id limit 20 loop
  if public.icash_repair_standing_research(a) then repaired:=repaired+1;end if;
 end loop;
 return repaired;
end $fn$;
revoke all on function public.icash_repair_standing_research(uuid),public.icash_repair_expired_research_configs() from public,anon,authenticated;
grant execute on function public.icash_repair_standing_research(uuid),public.icash_repair_expired_research_configs() to service_role;
commit;
