-- Research candidates: priority is a test order, not a verified ZIP close-rate ranking.
create table public.icash_market_shortlist(
 zip text primary key check(zip ~ '^[0-9]{5}$'),city text not null,state text not null,
 priority integer not null unique check(priority>0),metro_investor_share numeric,
 evidence_year integer not null,source_url text not null,
 status text not null default 'research_candidate' check(status='research_candidate'),
 researched_at timestamptz not null default now()
);
alter table public.icash_market_shortlist enable row level security;
revoke all on public.icash_market_shortlist from public,anon,authenticated;
grant all on public.icash_market_shortlist to service_role;
insert into public.icash_market_shortlist(zip,city,state,priority,metro_investor_share,evidence_year,source_url) values
('38118','Memphis','TN',1,23.7,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('35206','Birmingham','AL',2,21,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('75217','Dallas','TX',3,15.6,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('78228','San Antonio','TX',4,15.9,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('38128','Memphis','TN',5,23.7,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('38111','Memphis','TN',6,23.7,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('38122','Memphis','TN',7,23.7,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('38109','Memphis','TN',8,23.7,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('35215','Birmingham','AL',9,21,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('35235','Birmingham','AL',10,21,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('75216','Dallas','TX',11,15.6,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('75227','Dallas','TX',12,15.6,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('75241','Dallas','TX',13,15.6,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('75215','Dallas','TX',14,15.6,2025,'https://www.realtor.com/research/investor-report-june-2026/'),
('78201','San Antonio','TX',15,15.9,2025,'https://www.realtor.com/research/investor-report-june-2026/');

-- Operators attach only independently eligible ZIPs to an already configured account.
-- No shortlist entry by itself authorizes outreach, asserts data rights, or enables automation.
create function public.icash_attach_inventory_shortlist(p_account uuid,p_zips text[],p_eligible_until timestamptz)
 returns integer language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;n integer;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or p_eligible_until is null or p_eligible_until<=now() or c.data_rights_until<=now() then raise exception 'Current account market eligibility and data rights required';end if;
 if p_zips is null or cardinality(p_zips) not between 1 and 15 or
 (select count(*) from public.icash_market_shortlist where zip=any(p_zips))<>cardinality(p_zips) then raise exception 'Unique researched ZIPs required';end if;
 insert into public.icash_inventory_markets(account_id,zip,priority,eligible_until)
 select p_account,s.zip,s.priority,least(p_eligible_until,c.data_rights_until) from public.icash_market_shortlist s where s.zip=any(p_zips)
 on conflict(account_id,zip) do update set priority=excluded.priority,eligible_until=excluded.eligible_until;
 get diagnostics n=row_count;
 -- Existing next_scan_at is deliberately preserved on updates: attaching never resets cooldown.
 return n;
end $$;
revoke all on function public.icash_attach_inventory_shortlist(uuid,text[],timestamptz) from public,anon,authenticated;
grant execute on function public.icash_attach_inventory_shortlist(uuid,text[],timestamptz) to service_role;
