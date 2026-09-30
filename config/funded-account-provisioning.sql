-- Provision from existing, enabled pricing and the configured research shortlist.
-- Does not unpause an account, grant contact consent, send outreach, or change signed terms.
create function public.icash_provision_funded_account(p_account uuid) returns jsonb language plpgsql set search_path='' as $$
declare search public.icash_operation_rates;contacts public.icash_operation_rates;buyers public.icash_operation_rates;profile jsonb;chosen text;unit bigint;until_at timestamptz;existing public.icash_discovery_configs;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,7301));
 if not exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null) then return jsonb_build_object('status','funding_required');end if;
 select * into search from public.icash_operation_rates where operation='property_search' and enabled and expires_at>now() order by verified_at desc limit 1;
 select * into contacts from public.icash_operation_rates where operation='owner_enrichment' and enabled and expires_at>now() order by verified_at desc limit 1;
 select * into buyers from public.icash_operation_rates where operation='buyer_discovery' and enabled and expires_at>now() order by verified_at desc limit 1;
 select credit_micros into unit from public.icash_data_cost_settings where provider='dealmachine';
 if search.id is null or contacts.id is null or buyers.id is null or unit is null then return jsonb_build_object('status','data_rates_required');end if;
 select s.profile into profile from public.icash_bot_setups s where account_id=p_account;
 select * into existing from public.icash_discovery_configs where account_id=p_account;
 chosen:=existing.zip;
 if chosen is null then
 select m.zip into chosen from public.icash_market_shortlist m
 where coalesce(profile->>'marketMode','nationwide')='nationwide' or lower(trim(profile->>'market')) in (lower(m.city),lower(m.city||', '||m.state),m.zip)
 order by (select count(*) from public.icash_discovery_configs c where c.zip=m.zip),m.priority limit 1;
 end if;
 if chosen is null then return jsonb_build_object('status','market_configuration_required');end if;
 until_at:=least(search.expires_at,contacts.expires_at,buyers.expires_at);
 insert into public.icash_discovery_configs(account_id,enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,per_page,auto_enabled,contacts_enabled,contact_rate_id,contact_credit_cap)
 values(p_account,true,chosen,search.id,unit,until_at,0,5,true,true,contacts.id,least(25,greatest(1,(contacts.costs_micros->>'dealmachine')::bigint/unit))) on conflict(account_id) do nothing;
 -- Existing configurations and operator pauses are never overwritten on a refresh.
 insert into public.icash_buyer_search_configs(account_id,enabled,rate_id,unit_cost_micros,rights_until,zip,since,per_page,max_pages)
 values(p_account,true,buyers.id,unit,until_at,chosen,(current_date-365),10,5) on conflict(account_id) do nothing;
 insert into public.icash_inventory_markets(account_id,zip,priority,eligible_until)
 select p_account,m.zip,m.priority,until_at from public.icash_market_shortlist m
 where coalesce(profile->>'marketMode','nationwide')='nationwide' or m.zip=chosen
 on conflict(account_id,zip) do nothing;
 return jsonb_build_object('status','configured','zip',chosen,'costBasis','estimated','expiresAt',until_at);
end $$;
revoke all on function public.icash_provision_funded_account(uuid) from public,anon,authenticated;
grant execute on function public.icash_provision_funded_account(uuid) to service_role;
