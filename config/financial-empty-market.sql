-- A fresh broad zero estimate can finish this market without buying or probing
-- its narrower audiences. Installation alone never revisits historical work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $guard$
declare expected record;
begin
 for expected in select * from(values
  ('icash_research_private.financial_query_valid(jsonb,jsonb,jsonb,jsonb)','ceaa88f7c63d6cdc97147a45cda3f007'),
  ('icash_research_private.financial_filters(jsonb,jsonb)','b8652e71842c1e0dd7a2b2c3f5c1096d'),
  ('icash_research_private.combine_financial_filters(jsonb)','80f6c229ab7f4c02092e3d861bcdd488'),
  ('public.icash_targeting_filters(jsonb)','9ea52116dd7b674f265cfc3c68593001'),
  ('public.icash_targeting_definition_valid(jsonb)','cdd6cc0a79ad7a7b5ce6daf5b781f692'),
  ('public.icash_research_query_ready(uuid,jsonb,jsonb,jsonb)','d13bfe80456fbd21f5d29d2405703216'),
  ('public.icash_finish_empty_filter(uuid,uuid,integer,jsonb,text)','12e832f79c2a65a49971f8f1ade019ee'),
  ('public.icash_mark_inventory_empty(uuid,uuid,integer)','9bec31f64ab56edf19b9e4e2f5641d93'),
  ('public.icash_rotate_inventory_market(uuid)','b27eb4e03066cb7e0eaee1cec6a6c788')
 ) dependencies(signature,hash) loop
  if to_regprocedure(expected.signature) is null
   or md5(pg_get_functiondef(expected.signature::regprocedure)) is distinct from expected.hash then
   raise exception 'Financial empty market predecessor changed: %',expected.signature;
  end if;
 end loop;
end $guard$;

create table icash_research_private.empty_financial_markets(
 operation_key text primary key,
 account_id uuid not null references public.icash_accounts(id),
 revision uuid not null,zip text not null,
 scope jsonb not null,plan jsonb not null,policy jsonb not null,
 query jsonb not null,response jsonb not null,
 estimate_saved_at timestamptz not null,exclusion_synced_at timestamptz not null,
 cursors jsonb not null,recorded_at timestamptz not null default clock_timestamp(),
 unique(account_id,revision)
);
alter table icash_research_private.empty_financial_markets enable row level security;
revoke all on icash_research_private.empty_financial_markets from public,anon,authenticated,service_role;
create function icash_research_private.preserve_empty_financial_market() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Empty financial market decisions are immutable';end;
$$;
revoke all on function icash_research_private.preserve_empty_financial_market() from public,anon,authenticated,service_role;
create trigger empty_financial_market_immutable before update or delete or truncate
on icash_research_private.empty_financial_markets for each statement
execute function icash_research_private.preserve_empty_financial_market();

create function public.icash_finish_empty_financial_market(p_account uuid,p_scope jsonb,p_plan jsonb,p_policy jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c public.icash_discovery_configs;e icash_research_private.estimates;
 x icash_research_private.exclusions;op text;before_cursors jsonb;cursor_row record;definition jsonb;expected record;
 checked timestamptz;
begin
 if p_policy->>'version' is distinct from 'financial-prefilter-v1' or p_policy->'tier' is distinct from '2'::jsonb
  or p_plan->>'version' is distinct from 'seller-filters-v1' or p_plan->>'strategy' is distinct from 'baseline'
  or p_plan->'providerPage' is distinct from '1'::jsonb
  or public.icash_discovery_filter_plan_valid(p_plan) is distinct from true then return false;end if;
 -- This reviewed implication applies only to these exact builders. Future
 -- query changes fall back to ordinary per-arm discovery until reviewed.
 for expected in select * from(values
  ('icash_research_private.financial_query_valid(jsonb,jsonb,jsonb,jsonb)','ceaa88f7c63d6cdc97147a45cda3f007'),
  ('icash_research_private.financial_filters(jsonb,jsonb)','b8652e71842c1e0dd7a2b2c3f5c1096d'),
  ('icash_research_private.combine_financial_filters(jsonb)','80f6c229ab7f4c02092e3d861bcdd488'),
  ('public.icash_targeting_filters(jsonb)','9ea52116dd7b674f265cfc3c68593001'),
  ('public.icash_targeting_definition_valid(jsonb)','cdd6cc0a79ad7a7b5ce6daf5b781f692'),
  ('public.icash_research_query_ready(uuid,jsonb,jsonb,jsonb)','d13bfe80456fbd21f5d29d2405703216'),
  ('public.icash_finish_empty_filter(uuid,uuid,integer,jsonb,text)','12e832f79c2a65a49971f8f1ade019ee'),
  ('public.icash_mark_inventory_empty(uuid,uuid,integer)','9bec31f64ab56edf19b9e4e2f5641d93'),
  ('public.icash_rotate_inventory_market(uuid)','b27eb4e03066cb7e0eaee1cec6a6c788')
 ) dependencies(signature,hash) loop
  if to_regprocedure(expected.signature) is null
   or md5(pg_get_functiondef(expected.signature::regprocedure)) is distinct from expected.hash then return false;end if;
 end loop;
 -- Match research admission's global/customer/config lock order. The exclusion
 -- row remains shared-locked through the decision, so an updated generation
 -- cannot become covered by an older receipt while this transaction commits.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=p_account for update;
 if not found then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found then return false;end if;
 perform 1 from icash_research_private.financial_settings where id=1 for share;
 select * into x from icash_research_private.exclusions where id=1 for share;
 if not found or x.state is distinct from 'ready' or x.list_id is distinct from p_policy->>'exclusionListId'
  or x.token is not null or x.lease_until is not null then return false;end if;
 if public.icash_research_query_ready(p_account,p_scope,p_plan,p_policy) is distinct from true then return false;end if;
 op:='discovery:'||p_account||':'||c.revision||':'||c.next_page;
 -- A broad empty observation cannot discard ANY unresolved arm purchase,
 -- even when the baseline's own claim would pass its original readiness gate.
 if exists(select 1 from public.icash_operation_spend where operation_key=op)
  or exists(select 1 from public.icash_discovery_filter_pages where account_id=p_account and revision=c.revision and state='claimed')
  or exists(select 1 from public.icash_operation_spend spent
   where spent.account_id=p_account and starts_with(spent.operation_key,'discovery:'||p_account||':'||c.revision||':')
    and spent.state is distinct from 'settled' and spent.state is distinct from 'cancelled')
  or exists(select 1 from icash_research_private.empty_financial_markets where account_id=p_account and revision=c.revision)
  then return false;end if;
 select * into e from icash_research_private.estimates where operation_key=op and account_id=p_account for update;
 checked:=clock_timestamp();
 if not found or e.token is not null or e.lease_until is not null or e.shared_from_operation is not null
  or e.saved_at is null or e.saved_at not between checked-interval '5 minutes' and checked
  or e.query->'page' is distinct from '1'::jsonb
  or icash_research_private.financial_query_valid(e.query,p_policy,p_plan,p_scope) is distinct from true
  or e.response#>'{estimated_credits,this_page}' is distinct from '0'::jsonb
  or e.response#>'{estimated_credits,breakdown,people}' is distinct from '0'::jsonb
  or e.response#>'{totals,properties}' is distinct from '0'::jsonb
  or e.response#>'{pagination,total_results}' is distinct from '0'::jsonb
  or e.response#>'{pagination,has_next_page}' is distinct from 'false'::jsonb
  or e.exclusion_synced_at is distinct from x.last_synced_at
  or x.last_synced_at is null or x.last_synced_at>checked then return false;end if;
 perform 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=c.revision
  order by strategy for update;
 if not exists(select 1 from public.icash_discovery_filter_cursors where account_id=p_account and revision=c.revision
  and zip=c.zip and strategy='baseline' and next_page=1 and not exhausted) then return false;end if;
 for cursor_row in select * from public.icash_discovery_filter_cursors where account_id=p_account and revision=c.revision loop
  if cursor_row.zip is distinct from c.zip then return false;end if;
  if cursor_row.strategy in('baseline','vacant','absentee','repairs') then continue;end if;
  select experiments.definition into definition from icash_research_private.targeting_experiments experiments
   where 'target_'||experiments.id=cursor_row.strategy for share;
  if not found or public.icash_targeting_definition_valid(definition) is distinct from true
   or definition->>'segment' not in('off_market','sale_7_10','sale_10_plus','buyer_fit','out_of_state_absentee','vacant_absentee','out_of_state_old_sale','off_market_repairs','mobile')
   then return false;end if;
 end loop;
 select jsonb_agg(to_jsonb(original) order by strategy) into before_cursors
  from public.icash_discovery_filter_cursors original where account_id=p_account and revision=c.revision;
 -- Only the actual baseline estimate becomes an empty page. Narrower cursors
 -- are covered by this decision: no invented observations, costs or arm pages.
 update public.icash_discovery_filter_cursors set exhausted=true
  where account_id=p_account and revision=c.revision and strategy<>'baseline';
 if public.icash_finish_empty_filter(p_account,c.revision,c.next_page,p_plan,'empty') is distinct from true then
  raise exception 'Financial empty market finalization changed';
 end if;
 insert into icash_research_private.empty_financial_markets(operation_key,account_id,revision,zip,scope,plan,policy,query,response,estimate_saved_at,exclusion_synced_at,cursors)
 values(op,p_account,c.revision,c.zip,p_scope,p_plan,p_policy,e.query,e.response,e.saved_at,e.exclusion_synced_at,before_cursors);
 return true;
end;
$$;
revoke all on function public.icash_finish_empty_financial_market(uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_finish_empty_financial_market(uuid,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
