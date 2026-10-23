-- Owner authorized nationwide research and faster parallel outbound work on
-- 2026-10-23. Geographic metadata is free; paid research keeps all budget gates.
begin;
set local lock_timeout='5s';

insert into public.icash_inventory_geography_sources(state_code)
select state from unnest(string_to_array('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC',' ')) state
where public.icash_research_state_allowed(state)
on conflict(state_code) do nothing;

-- Exhaust fresh states before revisiting later pages, without stealing a lease
-- or overriding a provider failure's retry time.
create or replace function public.icash_claim_inventory_geographies() returns jsonb language plpgsql set search_path='' as $$
declare s public.icash_inventory_geography_sources;t uuid;
begin
 select * into s from public.icash_inventory_geography_sources
 where next_scan_at<=now() and (claim_until is null or claim_until<now()) and public.icash_research_state_allowed(state_code)
 order by checked_at nulls first,next_scan_at,state_code for update skip locked limit 1;
 if not found then return null;end if;
 t:=gen_random_uuid();update public.icash_inventory_geography_sources set claim_token=t,claim_until=now()+interval '2 minutes',next_scan_at=now()+interval '15 minutes' where state_code=s.state_code;
 return jsonb_build_object('state',s.state_code,'page',s.next_page,'token',t);
end $$;

-- Each refresh adds another bounded group, instead of repeatedly choosing the
-- same first 200 ZIPs. Existing cooldowns and explicit customer scope survive.
create or replace function public.icash_expand_inventory_markets(p_account uuid) returns integer language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;profile jsonb;n integer;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.auto_enabled or c.data_rights_until<=now() or c.inventory_refreshed_at>now()-interval '10 minutes' then return 0;end if;
 select s.profile into profile from public.icash_bot_setups s where s.account_id=p_account;
 if coalesce(profile->>'marketMode','nationwide')<>'nationwide' then return 0;end if;
 insert into public.icash_inventory_markets(account_id,zip,priority,eligible_until)
 select p_account,g.zip,100,least(c.data_rights_until,g.expires_at)
 from public.icash_property_zip_geographies g
 where g.property_count>0 and g.checked_at<=now() and g.expires_at>now() and public.icash_research_state_allowed(g.state_code)
 and not exists(select 1 from public.icash_inventory_markets m where m.account_id=p_account and m.zip=g.zip and m.eligible_until>=least(c.data_rights_until,g.expires_at))
 order by case when g.property_count>=1000 then 0 else 1 end,md5(g.zip||p_account::text) limit 200
 on conflict(account_id,zip) do update set eligible_until=greatest(public.icash_inventory_markets.eligible_until,excluded.eligible_until);
 get diagnostics n=row_count;
 update public.icash_discovery_configs set inventory_refreshed_at=now() where account_id=p_account;
 return n;
end $$;

-- Change only global launch spacing. Real capacity, recipient spacing, urgent
-- callbacks, fair account selection, budget and final admission remain exact.
do $patch$
declare d text;old_gate text:=$old$last_voice<now()-interval '30 seconds'$old$;
begin
 d:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 if (length(d)-length(replace(d,old_gate,'')))/length(old_gate)<>1
 or position('public.icash_voice_queue_slot_open(v.account_id,v.id)' in d)=0
 or position('public.icash_seller_phone_call_current(v.account_id,v.id)' in d)=0
 or position('order by last_ticket.created_at asc nulls first' in d)=0 then raise exception 'Parallel dispatch prerequisite changed';end if;
 execute replace(d,old_gate,$new$last_voice<now()-interval '3 seconds'$new$);
end $patch$;

revoke all on function public.icash_claim_inventory_geographies(),public.icash_expand_inventory_markets(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_inventory_geographies(),public.icash_expand_inventory_markets(uuid) to service_role;
commit;
