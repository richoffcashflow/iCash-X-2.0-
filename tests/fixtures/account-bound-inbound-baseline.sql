CREATE OR REPLACE FUNCTION public.icash_search_due_before_prospecting_budget(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a public.icash_accounts;c public.icash_discovery_configs;policy public.icash_acquisition_policy;capacity bigint;research_spend bigint;cost bigint;target integer;pending_count integer;profile jsonb;
begin
 select * into policy from public.icash_acquisition_policy where id=1;
 if not found or policy.mode='inbound' then return false;end if;
 select * into a from public.icash_accounts where id=p_account;
 if not found or a.bot_paused or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now() or not public.icash_research_zip_known(c.zip) then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return false;end if;
 select charge_cents into cost from public.icash_operation_rates where id=c.rate_id and enabled and expires_at>now() and operation='property_search';
 if cost is null then return false;end if;
 select w.balance_cents into capacity from public.icash_wallets w where account_id=p_account;
 if capacity is null or capacity<=0 then return false;end if;
 if exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state in ('queued','running') and s.created_at>now()-interval '1 day') then return false;end if;
 if policy.mode='outbound' then return public.icash_pending_opportunity_count(p_account)<c.max_open_prospects;end if;
 select bs.profile into profile from public.icash_bot_setups bs where account_id=p_account;
 -- Let an affordable, due inbound request be delivered before buying a page.
 if public.icash_credit_acquisition_allowed(p_account) and exists(select 1 from public.icash_seller_intakes l where l.state in ('qualified','assigned') and l.next_assignment_at<=now() and l.data_rights_until>now() and l.checked_at>now()-interval '8 days'
 and public.icash_research_state_allowed(l.property->>'state') and (profile->>'marketMode'='nationwide' or lower(trim(profile->>'market')) in (lower(l.property->>'city'),lower(l.property->>'city')||', '||lower(l.property->>'state'),l.property->>'zip'))
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=p_account)
 and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations lc on lc.account_id=sm.account_id and lc.screening_id=sm.screening_id join public.icash_contact_suppressions cs on cs.account_id=lc.account_id and cs.contact_key=lc.contact_key where sm.lead_id=l.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=l.id)
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=l.id)<=now()
 and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>p_account)
 and ceil(ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,case when public.icash_seller_acquisition_quote(l.id) is not null then l.lookup_costs||jsonb_build_object('acquisition',(public.icash_seller_acquisition_quote(l.id)->>'costMicros')::bigint) end)))*coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 else 2 end)/10000)*case when public.icash_vip_active(p_account) then 0.7 else 1 end)<=capacity) then return false;end if;
 -- Keep a bounded buffer of fresh, unattempted work. Failed connections and
 -- real responses remain in history without consuming the discovery buffer.
 target:=c.max_open_prospects;
 pending_count:=public.icash_pending_opportunity_count(p_account);
 return pending_count<target;
end $function$
