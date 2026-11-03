-- Keep due, proven-unstarted retry families visible when no saved list remains.
-- Ranking only: the original candidate and renewal checks still authorize work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))<>'c7902fc7af9afac890d7e927454e8726'
  or md5(pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure))<>'100ad1fa690b1979e00388e6799a467a' then
  raise exception 'Owner retry priority prerequisite changed';
 end if;
end $guard$;

-- Distinct from the issued/consumed active-ticket index. Only the finite held
-- retry family enters this ordered lookup, never the full ticket history.
create index icash_automation_owner_retry_due on public.icash_automation_tickets(account_id,owner_preview_retry_after,id)
 include(owner_preview_retry_until)
 where kind='contacts' and state='held' and outcome='owner_preview_rate_limited' and owner_preview_deferrals between 1 and 7;

create function public.icash_owner_retry_due_at(p_account uuid) returns timestamptz
language plpgsql stable security definer set search_path='' as $$
declare due_at timestamptz;
begin
 select t.owner_preview_retry_after into due_at from public.icash_automation_tickets t
  where t.account_id=p_account and t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited'
   and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=now() and t.owner_preview_retry_until>now()
  order by t.owner_preview_retry_after,t.id limit 1;
 -- Ordinary accounts do no added membership/budget work in account ordering.
 if not found then return null;end if;
 if not exists(
  select 1 from public.icash_discovery_configs c
  join public.icash_accounts a on a.id=c.account_id and not a.bot_paused
  join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
  join public.icash_operation_rates r on r.id=c.contact_rate_id and r.operation='owner_enrichment'
   and r.enabled and r.verified_at<=now() and r.expires_at>now()
  where c.account_id=p_account and c.enabled and c.auto_enabled and c.contacts_enabled and c.data_rights_until>now()
   and jsonb_typeof(r.costs_micros->'dealmachine')='number'
   and c.contact_credit_cap::numeric*c.property_credit_micros<=case when jsonb_typeof(r.costs_micros->'dealmachine')='number' then (r.costs_micros->>'dealmachine')::numeric end
   and exists(select 1 from public.icash_operating_budget where id=1 and enabled)
   and public.icash_membership_work_allowed(c.account_id)
   and public.icash_prospecting_available(c.account_id)>=public.icash_research_admission_quote(c.account_id,'owner_enrichment',r.charge_cents)
   and not exists(select 1 from public.icash_billing_reviews b where b.account_id=c.account_id and b.resolved_at is null)
 ) then return null;end if;
 -- This inexpensive hint is deliberately not admission proof. The unchanged
 -- final candidate repeats retry_current, original receipt/unstarted evidence,
 -- source hash/scope, immutable approval cap, recipient controls and same-property financial holds. A stale
 -- hint can only use one of the existing five candidate slots, never issue work.
 return due_at;
end
$$;
revoke all on function public.icash_owner_retry_due_at(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_owner_retry_due_at(uuid) to service_role;

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:=$old$   then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end nulls last,
  (d.next_run_at<now()-interval '5 minutes') desc,$old$;
 replacement:=$new$   then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end nulls last,
  case when d.contacts_enabled and d.contact_rate_id is not null
   and public.icash_owner_active_export_capacity() in ('disabled','ready')
   then public.icash_owner_retry_due_at(d.account_id) end nulls last,
  (d.next_run_at<now()-interval '5 minutes') desc,$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner retry account ordering changed';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 needle:=' order by public.icash_owner_preflight_due_at(p_account,s.id) nulls last,public.icash_opportunity_score';
 replacement:=$new$ order by public.icash_owner_preflight_due_at(p_account,s.id) nulls last,
  case when t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited'
   and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=now() and t.owner_preview_retry_until>now()
   then t.owner_preview_retry_after end nulls last,public.icash_opportunity_score$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner retry property ordering changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
