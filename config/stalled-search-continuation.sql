-- Recover independent research after the exclusion-query timeout incident.
-- Unknown purchases retain their original identity, money hold and late-receipt path.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

alter table icash_research_private.settings add column exclusions_enabled boolean not null default true;
alter table icash_research_private.settings add column stalled_search_continuation_enabled boolean not null default false;
create index research_requests_operation on icash_research_private.requests(operation_key,kind) where admitted and operation_key is not null;
create table icash_research_private.stalled_searches(
 operation_key text primary key references public.icash_operation_spend(operation_key),
 account_id uuid not null references public.icash_accounts(id),
 request_id uuid not null unique references icash_research_private.requests(id),
 zip text not null check(zip ~ '^[0-9]{5}$'),
 configuration jsonb not null,
 quarantined_at timestamptz not null default now()
);
create index stalled_searches_account_zip on icash_research_private.stalled_searches(account_id,zip);
alter table icash_research_private.stalled_searches enable row level security;
revoke all on icash_research_private.stalled_searches from public,anon,authenticated,service_role;

-- Existing service-only invoker RPCs use narrow definer readers; never grant
-- raw private-table access merely to add an admission fence or receipt lookup.
create function public.icash_stalled_research_zip(p_account uuid,p_zip text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_research_private.stalled_searches where account_id=p_account and zip=p_zip);
$$;
create function public.icash_stalled_search_configuration(p_account uuid,p_operation text) returns jsonb
language sql stable security definer set search_path='' as $$
 select configuration from icash_research_private.stalled_searches where account_id=p_account and operation_key=p_operation;
$$;
revoke all on function public.icash_stalled_research_zip(uuid,text),public.icash_stalled_search_configuration(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_stalled_research_zip(uuid,text),public.icash_stalled_search_configuration(uuid,text) to service_role;

create function public.icash_continue_stalled_research(p_account uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;o public.icash_operation_spend;r icash_research_private.requests;m public.icash_inventory_markets;op text;quote bigint;
begin
 if not exists(select 1 from icash_research_private.settings where id=1 and enabled
  and stalled_search_continuation_enabled and not exclusions_enabled) then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.enabled or not c.auto_enabled or c.data_rights_until<=now()
  or c.research_version<>2 or c.research_list_id is null then return false;end if;
 op:='discovery:'||p_account||':'||c.revision||':'||c.next_page;
 -- Never wait behind a late receipt writer while holding the configuration.
 select * into o from public.icash_operation_spend where operation_key=op and account_id=p_account for update skip locked;
 if not found or o.state<>'dispatched' or o.dispatched_at is null or o.dispatched_at>now()-interval '5 minutes'
  or o.rate_id<>c.rate_id or exists(select 1 from public.icash_discovery_results where operation_key=op)
  or exists(select 1 from public.icash_cost_observations where provider='dealmachine' and event_key=op)
  or exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind='discovery'
   and ((state='issued' and expires_at>now()) or (state='consumed' and greatest(created_at,expires_at)>now()-interval '5 minutes')))
  then return false;end if;
 select * into r from icash_research_private.requests where operation_key=op and account_id=p_account
  and kind='property_search' and admitted and result->>'outcome'='unknown'
  and finished_at<=now()-interval '5 minutes' order by created_at limit 1;
 if not found or (select count(*) from icash_research_private.requests where operation_key=op and kind='property_search' and admitted)<>1
  or not exists(select 1 from icash_research_private.query_claims where operation_key=op and account_id=p_account
   and policy=jsonb_build_object('version','research-efficiency-v2','exclusionListId',c.research_list_id))
  or not exists(select 1 from public.icash_discovery_filter_pages where operation_key=op and account_id=p_account
   and revision=c.revision and sequence=c.next_page and zip=c.zip and state='claimed')
  or exists(select 1 from public.icash_operation_spend other where other.account_id=p_account and other.operation_key like 'discovery:%'
   and other.state in ('reserved','dispatched') and other.operation_key<>op
   and not exists(select 1 from icash_research_private.stalled_searches q where q.operation_key=other.operation_key and q.account_id=p_account)) then return false;end if;
 select public.icash_research_admission_quote(p_account,'property_search',charge_cents) into quote
  from public.icash_operation_rates where id=c.rate_id and operation='property_search' and enabled and expires_at>now();
 if quote is null or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
  or public.icash_prospecting_available(p_account)<quote then return false;end if;
 perform public.icash_expand_inventory_markets(p_account);
 select * into m from public.icash_inventory_markets where account_id=p_account and zip<>c.zip
  and eligible_until>now() and next_scan_at<=now() and public.icash_research_zip_known(zip)
  and public.icash_inventory_scope_allowed(p_account,zip)
  and not exists(select 1 from icash_research_private.stalled_searches q where q.account_id=p_account and q.zip=icash_inventory_markets.zip)
  order by (select count(*) from public.icash_discovery_configs other where other.zip=icash_inventory_markets.zip and other.account_id<>p_account and other.enabled and not other.exhausted),
   public.icash_opportunity_market_score(p_account,zip) desc,priority,zip for update skip locked limit 1;
 if not found then return false;end if;
 insert into icash_research_private.stalled_searches(operation_key,account_id,request_id,zip,configuration)
 values(op,p_account,r.id,c.zip,to_jsonb(c));
 -- A different ZIP is disjoint from the uncertain original search. No operation,
 -- receipt, charge or reservation is reset, released, marked failed or replayed.
 update public.icash_discovery_configs set zip=m.zip,revision=gen_random_uuid(),next_page=1,
  research_list_id=null,exhausted=false,next_run_at=now() where account_id=p_account;
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=m.zip;
 return true;
end $$;
revoke all on function public.icash_continue_stalled_research(uuid) from public,anon,authenticated;
grant execute on function public.icash_continue_stalled_research(uuid) to service_role;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_prepare_research_efficiency(uuid)'::regprocedure);
 needle:='perform 1 from public.icash_operating_budget where id=1 for update;';
 if strpos(d,needle)=0 then raise exception 'Research preparation lock changed';end if;
 d:=replace(d,needle,'perform public.icash_continue_stalled_research(p_account);'||E'\n '||needle);
 needle:='where account_id=p_account and operation_key like ''discovery:%'' and state in (''reserved'',''dispatched''))';
 replacement:='where account_id=p_account and operation_key like ''discovery:%'' and state in (''reserved'',''dispatched'')
  and not exists(select 1 from icash_research_private.stalled_searches q where q.operation_key=public.icash_operation_spend.operation_key and q.account_id=p_account and q.zip<>c.zip))';
 if strpos(d,needle)=0 then raise exception 'Unknown purchase fence changed';end if;d:=replace(d,needle,replacement);
 needle:='list:=coalesce(list,c.research_list_id);';
 if strpos(d,needle)=0 then raise exception 'Exclusion attachment changed';end if;
 d:=replace(d,needle,'list:=case when (select exclusions_enabled from icash_research_private.settings where id=1) then coalesce(list,c.research_list_id) else null end;');execute d;

 -- Permanent account/ZIP fence applies to every final admission and rotation,
 -- including callers that bypass the ordinary scheduler or change query arms.
 d:=pg_get_functiondef('public.icash_reserve_and_claim_property_discovery(uuid,text,uuid,integer,integer,uuid,bigint,timestamptz,integer,text,text)'::regprocedure);
 needle:='if not public.icash_research_zip_known(p_zip) or not public.icash_outbound_search_due(p_account) then return false;end if;';
 if strpos(d,needle)=0 then raise exception 'Discovery final scope guard changed';end if;
 execute replace(d,needle,'if public.icash_stalled_research_zip(p_account,p_zip) then return false;end if;'||E'\n '||needle);
 d:=pg_get_functiondef('public.icash_rotate_inventory_market(uuid)'::regprocedure);
 needle:='and public.icash_inventory_scope_allowed(p_account,zip)';
 if strpos(d,needle)=0 then raise exception 'Inventory rotation scope changed';end if;
 execute replace(d,needle,needle||' and not public.icash_stalled_research_zip(p_account,zip)');

 -- Late original receipts use their immutable original configuration. They
 -- cannot advance, exhaust or relabel the new market's cursor.
 d:=pg_get_functiondef('public.icash_save_discovery(uuid,text,uuid,integer,jsonb)'::regprocedure);
 needle:='if not found or c.revision<>p_revision or c.next_page<>p_page or c.rate_id<>o.rate_id then raise exception ''Discovery configuration changed'';end if;';
 replacement:='if not found or c.revision<>p_revision or c.next_page<>p_page or c.rate_id<>o.rate_id then
  select (jsonb_populate_record(null::public.icash_discovery_configs,public.icash_stalled_search_configuration(p_account,p_operation))).* into c;
  if c.account_id is distinct from p_account or c.revision is distinct from p_revision or c.next_page is distinct from p_page or c.rate_id is distinct from o.rate_id
   or exists(select 1 from jsonb_array_elements(p_result->''rows'') receipt_row(value) where left(receipt_row.value->>''zip'',5) is distinct from c.zip)
   then raise exception ''Discovery configuration changed'';end if;
 end if;';
 if strpos(d,needle)=0 then raise exception 'Discovery receipt scope changed';end if;d:=replace(d,needle,replacement);
 needle:='then false else enabled end where account_id=p_account;';
 if strpos(d,needle)=0 then raise exception 'Discovery receipt cursor changed';end if;
 d:=replace(d,needle,'then false else enabled end where account_id=p_account and revision=p_revision and next_page=p_page;
 if used>(p_result->>''estimatedCredits'')::bigint then update public.icash_discovery_configs set enabled=false where account_id=p_account;end if;');execute d;
 d:=pg_get_functiondef('public.icash_record_discovery_inventory()'::regprocedure);
 needle:='select * into strict c from public.icash_discovery_configs where account_id=new.account_id;';
 if strpos(d,needle)=0 then raise exception 'Discovery inventory receipt scope changed';end if;
 execute replace(d,needle,'select (jsonb_populate_record(null::public.icash_discovery_configs,public.icash_stalled_search_configuration(new.account_id,new.operation_key))).* into c;
 if c.account_id is null then '||needle||' end if;');

 -- Scheduling progress is completed usage. Pending caps still constrain every
 -- existing financial admission; they are not evidence that the daily goal ran.
 d:=pg_get_functiondef('public.icash_daily_work_target(uuid)'::regprocedure);
 needle:='(u.spent::numeric+u.pending)/t.cents';
 if strpos(d,needle)=0 then raise exception 'Daily priority calculation changed';end if;
 d:=replace(d,needle,'u.spent::numeric/t.cents');
 needle:='''percent'',50,';
 if strpos(d,needle)=0 then raise exception 'Daily target changed';end if;
 d:=replace(d,needle,'''minimumPercent'',30,''minimumCents'',floor(t.baseline_cents*0.30)::bigint,
  ''minimumRemainingCents'',greatest(0,floor(t.baseline_cents*0.30)::bigint-u.spent),
  ''completedRemainingCents'',greatest(0,t.cents-u.spent),'||needle);execute d;
end $patch$;
commit;
