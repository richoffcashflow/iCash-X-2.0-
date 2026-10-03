-- Apply after research-contract-separation.sql. No rows are seeded and no provider requests run here.
-- Geography is provider availability evidence only, never a legal/contract review or contact permission.
begin;
create table if not exists public.icash_property_zip_geographies(
 zip text primary key check(zip ~ '^[0-9]{5}$'),
 state_code text check(state_code in ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC')),name text,
 property_count bigint check(property_count between 0 and 9007199254740991),
 source_ref text,checked_at timestamptz,expires_at timestamptz,
 lookup_token uuid,lookup_account uuid references public.icash_accounts(id),
 lookup_until timestamptz,retry_after timestamptz
);
alter table public.icash_property_zip_geographies enable row level security;
revoke all on public.icash_property_zip_geographies from public,anon,authenticated;
grant select,insert,update on public.icash_property_zip_geographies to service_role;
create or replace function public.icash_research_zip_known(p_zip text) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_market_shortlist where zip=p_zip and state ~ '^[A-Z]{2}$')
 or exists(select 1 from public.icash_property_zip_geographies where zip=p_zip and state_code is not null
 and property_count>0 and checked_at<=now() and expires_at>now());
$$;
create or replace function public.icash_property_research_market_ready(p_account uuid,p_zip text) returns boolean
language sql stable security invoker set search_path='' as $$
 select public.icash_research_zip_known(p_zip) and not exists(
  select 1 from public.icash_bot_setups s where s.account_id=p_account
  and s.profile->>'marketMode'='city' and trim(s.profile->>'market') ~ '^[0-9]{5}$'
  and trim(s.profile->>'market')<>p_zip
 );
$$;
create or replace function public.icash_claim_requested_property_zip(p_user uuid,p_account uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare profile jsonb;requested text;g public.icash_property_zip_geographies;token uuid;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 if not exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null) then return jsonb_build_object('status','funding_required');end if;
 select s.profile into profile from public.icash_bot_setups s where s.account_id=p_account;
 requested:=trim(profile->>'market');
 if profile->>'marketMode' is distinct from 'city' or requested is null or requested !~ '^[0-9]{5}$' then return jsonb_build_object('status','not_requested');end if;
 if public.icash_research_zip_known(requested) then return jsonb_build_object('status','known','zip',requested);end if;
 insert into public.icash_property_zip_geographies(zip) values(requested) on conflict do nothing;
 select * into strict g from public.icash_property_zip_geographies where zip=requested for update;
 if g.state_code is not null and g.property_count>0 and g.checked_at<=now() and g.expires_at>now() then return jsonb_build_object('status','known','zip',requested);end if;
 if g.lookup_until>now() or g.retry_after>now() then return jsonb_build_object('status','market_lookup_held');end if;
 if not public.icash_take_request('requested-zip-account:'||p_account,5,3600)
 or not public.icash_take_request('requested-zip-global',50,3600) then return jsonb_build_object('status','market_lookup_held');end if;
 token:=gen_random_uuid();
 update public.icash_property_zip_geographies set lookup_token=token,lookup_account=p_account,lookup_until=now()+interval '10 minutes',retry_after=now()+interval '10 minutes' where zip=requested;
 return jsonb_build_object('status','lookup_required','zip',requested,'token',token);
end $$;
create or replace function public.icash_save_requested_property_zip(p_user uuid,p_account uuid,p_zip text,p_token uuid,p_location jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g public.icash_property_zip_geographies;known boolean:=false;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 select * into g from public.icash_property_zip_geographies where zip=p_zip for update;
 if not found or g.lookup_token is distinct from p_token or g.lookup_account is distinct from p_account or g.lookup_until<=now() then return jsonb_build_object('status','stale_lookup');end if;
 if not exists(select 1 from public.icash_bot_setups where account_id=p_account and profile->>'marketMode'='city' and trim(profile->>'market')=p_zip) then return jsonb_build_object('status','request_changed');end if;
 if p_location is not null then
  if jsonb_typeof(p_location) is distinct from 'object' or p_location->>'type' is distinct from 'zip_code'
  or p_location->>'code' is distinct from p_zip or p_location->>'location_id' is distinct from 'loc_zip_code_'||p_zip
  or not coalesce(p_location->>'state' in ('AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC'),false)
  or jsonb_typeof(p_location->'name') is distinct from 'string' or length(trim(p_location->>'name')) not between 1 and 200
  or jsonb_typeof(p_location->'property_count') is distinct from 'number'
  or (p_location->>'property_count')::numeric<>trunc((p_location->>'property_count')::numeric)
  or (p_location->>'property_count')::numeric not between 0 and 9007199254740991 then raise exception 'Exact provider US ZIP required';end if;
  known:=(p_location->>'property_count')::bigint>0;
 end if;
 update public.icash_property_zip_geographies set state_code=p_location->>'state',name=p_location->>'name',
 property_count=(p_location->>'property_count')::bigint,source_ref='https://api.v2.dealmachine.com/v1/locations/loc_zip_code_'||p_zip,
 checked_at=now(),expires_at=case when known then now()+interval '30 days' else now() end,
 lookup_token=null,lookup_account=null,lookup_until=null,retry_after=case when known then null else now()+interval '1 hour' end where zip=p_zip;
 return jsonb_build_object('status',case when known then 'known' else 'provider_market_unavailable' end);
end $$;
revoke all on function public.icash_research_zip_known(text),public.icash_property_research_market_ready(uuid,text),public.icash_claim_requested_property_zip(uuid,uuid),public.icash_save_requested_property_zip(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_research_zip_known(text),public.icash_property_research_market_ready(uuid,text),public.icash_claim_requested_property_zip(uuid,uuid),public.icash_save_requested_property_zip(uuid,uuid,text,uuid,jsonb) to service_role;
-- The provider estimate is outside the database transaction. Bind its exact input
-- snapshot again while holding all mutable scope rows through BOTH reserve and claim.
-- Existing financial reservation/claim functions remain untouched and are called below.
create or replace function public.icash_reserve_and_claim_property_discovery(
 p_account uuid,p_zip text,p_revision uuid,p_page integer,p_per_page integer,p_rate uuid,
 p_unit bigint,p_permission_until timestamptz,p_setup_revision integer,p_market_mode text,p_market text)
returns boolean language plpgsql security invoker set search_path='' as $$
declare c public.icash_discovery_configs;s public.icash_bot_setups;g public.icash_property_zip_geographies;
 r public.icash_operation_rates;o public.icash_operation_spend;known_shortlist boolean:=false;op text;checked timestamptz;
begin
 -- Keep the existing global financial lock order before narrower account/config locks.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 if not found then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found then return false;end if;
 select * into s from public.icash_bot_setups where account_id=p_account for share;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 perform 1 from public.icash_market_shortlist where zip=p_zip and state ~ '^[A-Z]{2}$' for share;
 known_shortlist:=found;
 if not known_shortlist then select * into g from public.icash_property_zip_geographies where zip=p_zip for share;end if;
 checked:=clock_timestamp();
 if not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=checked
 or row(c.zip,c.revision,c.next_page,c.per_page,c.rate_id,c.property_credit_micros,c.data_rights_until)
 is distinct from row(p_zip,p_revision,p_page,p_per_page,p_rate,p_unit,p_permission_until)
 or row(s.revision,s.profile->>'marketMode',s.profile->>'market') is distinct from row(p_setup_revision,p_market_mode,p_market)
 or (s.profile->>'marketMode'='city' and trim(s.profile->>'market') ~ '^[0-9]{5}$' and trim(s.profile->>'market')<>p_zip)
 or r.operation is distinct from 'property_search' or not coalesce(r.enabled,false) or r.expires_at<=checked
 or p_page<1 or p_per_page not between 1 and 10 or p_unit<1
 or (not known_shortlist and (g.state_code is null or g.property_count is null or g.property_count<=0 or g.checked_at is null or g.checked_at>checked or g.expires_at is null or g.expires_at<=checked)) then return false;end if;
 op:='discovery:'||p_account||':'||p_revision||':'||p_page;
 select * into o from public.icash_operation_spend where operation_key=op for update;
 if found and (o.state<>'reserved' or row(o.account_id,o.rate_id,o.permission_until) is distinct from row(p_account,p_rate,p_permission_until)) then return false;end if;
 perform public.icash_reserve_operation(p_account,op,p_rate,p_permission_until,null,false);
 -- now() is the transaction start, so use wall-clock time again after any downstream wait.
 checked:=clock_timestamp();
 if c.data_rights_until<=checked or r.expires_at<=checked or (not known_shortlist and g.expires_at<=checked) then
  raise exception 'Property discovery scope expired before claim';
 end if;
 if not public.icash_claim_operation(op) then raise exception 'Property discovery claim held';end if;
 checked:=clock_timestamp();
 if c.data_rights_until<=checked or r.expires_at<=checked or (not known_shortlist and g.expires_at<=checked) then
  raise exception 'Property discovery scope expired during claim';
 end if;
 return true;
end $$;
revoke all on function public.icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text) from public,anon,authenticated;
grant execute on function public.icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text) to service_role;

create or replace function public.icash_provision_before_voice_template(p_account uuid) returns jsonb language plpgsql set search_path='' as $$
declare search public.icash_operation_rates;contacts public.icash_operation_rates;buyers public.icash_operation_rates;profile jsonb;chosen text;requested text;unit bigint;until_at timestamptz;existing public.icash_discovery_configs;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,7301));
 if not exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null) then return jsonb_build_object('status','funding_required');end if;
 select * into search from public.icash_operation_rates where operation='property_search' and enabled and expires_at>now() order by verified_at desc limit 1;
 select * into contacts from public.icash_operation_rates where operation='owner_enrichment' and enabled and expires_at>now() order by verified_at desc limit 1;
 select * into buyers from public.icash_operation_rates where operation='buyer_discovery' and enabled and expires_at>now() order by verified_at desc limit 1;
 select credit_micros into unit from public.icash_data_cost_settings where provider='dealmachine';
 if search.id is null or contacts.id is null or buyers.id is null or unit is null then return jsonb_build_object('status','data_rates_required');end if;
 perform public.icash_claim_bot_setup(p_account);
 select s.profile into profile from public.icash_bot_setups s where account_id=p_account;
 select * into existing from public.icash_discovery_configs where account_id=p_account;
 chosen:=existing.zip;
 requested:=case when profile->>'marketMode'='city' and trim(profile->>'market') ~ '^[0-9]{5}$' then trim(profile->>'market') end;
 if requested is not null then
  -- Never switch an existing operator configuration or an in-flight search implicitly.
  if chosen is not null and chosen<>requested then return jsonb_build_object('status','existing_market_configuration_preserved');end if;
  chosen:=requested;
 end if;
 if chosen is null then
 select m.zip into chosen from public.icash_market_shortlist m
 where (coalesce(profile->>'marketMode','nationwide')='nationwide' or lower(trim(profile->>'market')) in (lower(m.city),lower(m.city||', '||m.state),m.zip)) and m.state ~ '^[A-Z]{2}$'
 order by (select count(*) from public.icash_discovery_configs c where c.zip=m.zip),m.priority limit 1;
 end if;
 if chosen is null or not public.icash_research_zip_known(chosen) then return jsonb_build_object('status','market_configuration_required');end if;
 until_at:=least(search.expires_at,contacts.expires_at,buyers.expires_at);
 insert into public.icash_discovery_configs(account_id,enabled,zip,rate_id,property_credit_micros,data_rights_until,seller_cost_reserve_cents,per_page,auto_enabled,contacts_enabled,contact_rate_id,contact_credit_cap)
 values(p_account,true,chosen,search.id,unit,until_at,0,5,true,true,contacts.id,least(25,greatest(1,(contacts.costs_micros->>'dealmachine')::bigint/unit))) on conflict(account_id) do nothing;
 -- Existing configurations and operator pauses are never overwritten on a refresh.
 insert into public.icash_buyer_search_configs(account_id,enabled,rate_id,unit_cost_micros,rights_until,zip,since,per_page,max_pages)
 values(p_account,true,buyers.id,unit,until_at,chosen,(current_date-365),10,5) on conflict(account_id) do nothing;
 insert into public.icash_inventory_markets(account_id,zip,priority,eligible_until)
 select p_account,m.zip,m.priority,until_at from public.icash_market_shortlist m
 where (coalesce(profile->>'marketMode','nationwide')='nationwide' or m.zip=chosen) and m.state ~ '^[A-Z]{2}$'
 on conflict(account_id,zip) do nothing;
 -- Explicit ZIP requests outside the default shortlist receive only that one ZIP.
 if requested is not null then
  insert into public.icash_inventory_markets(account_id,zip,priority,eligible_until) values(p_account,chosen,100,until_at) on conflict(account_id,zip) do nothing;
 end if;
 return jsonb_build_object('status','configured','zip',chosen,'costBasis','estimated','expiresAt',until_at);
end $$;
revoke all on function public.icash_provision_before_voice_template(uuid) from public,anon,authenticated;
grant execute on function public.icash_provision_before_voice_template(uuid) to service_role;

commit;
