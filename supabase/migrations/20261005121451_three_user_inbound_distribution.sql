-- Three distinct paying users: immediate, +24 hours, +72 hours.
-- User explicitly selected three recipients, superseding the old eight-user draft.
-- Internal timing only; historical assignments and charges are never rewritten.
create or replace function public.icash_seller_assignment_due(p_completed integer,p_first timestamptz,p_now timestamptz) returns timestamptz language sql immutable security invoker set search_path='' as $$
 select case when p_completed>=3 then 'infinity'::timestamptz
 when p_completed<=0 then coalesce(p_now,'-infinity'::timestamptz)
 when p_completed=1 then greatest(p_first+interval '24 hours',p_now+interval '24 hours')
 else greatest(p_first+interval '72 hours',p_now+interval '24 hours') end
$$;

-- A targeted durable claim lets the submission callback process its own lead.
-- Existing cron callers keep the no-argument queue interface and all spend gates.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_claim_seller_lookup()'::regprocedure);
 definition:=replace(definition,'icash_claim_seller_lookup()','icash_claim_seller_lookup_for(p_id uuid)');
 needle:=$old$where state='received' order by created_at,id$old$;
 if position(needle in definition)=0 then raise exception 'Seller claim selection changed';end if;
 definition:=replace(definition,needle,$new$where state='received' and (p_id is null or id=p_id) order by created_at,id$new$);
 execute definition;
end $patch$;
revoke all on function public.icash_claim_seller_lookup_for(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_seller_lookup_for(uuid) to service_role;
create or replace function public.icash_claim_seller_lookup() returns jsonb language sql security invoker set search_path='' as $$select public.icash_claim_seller_lookup_for(null)$$;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_assign_seller_lead()'::regprocedure);
 -- Recheck pacing from actual match history, even if a receipt resets queue time.
 needle:='and (select count(*) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<8';
 if position(needle in definition)=0 then raise exception 'Seller assignment cap changed';end if;
 definition:=replace(definition,needle,replace(needle,'<8','<3')||$new$
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<=now()
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=icash_seller_intakes.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations c on c.account_id=sm.account_id and c.screening_id=sm.screening_id join public.icash_contact_suppressions s on s.account_id=c.account_id and s.contact_key=c.contact_key where sm.lead_id=icash_seller_intakes.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=icash_seller_intakes.id)
$new$);
 needle:=$old$'maximumBuyers',8$old$;
 if position(needle in definition)=0 then raise exception 'Seller sharing metadata changed';end if;
 definition:=replace(definition,needle,$new$'maximumBuyers',3$new$);
 -- Share the original research; don't buy the same lookup for every recipient.
 -- Calls and offers retain their separate, stricter freshness requirements.
 needle:=$old$if l.checked_at<now()-interval '24 hours' then
  update public.icash_seller_intakes set state='received',numbers_passed=false,market_qualified=false,hold_reason='Refreshing stale property data before matching' where id=l.id;
  return jsonb_build_object('status','property_refresh_queued');
 end if;$old$;
 if position(needle in definition)=0 then raise exception 'Seller research freshness changed';end if;
 definition:=replace(definition,needle,$new$if l.checked_at is null or l.checked_at<now()-interval '8 days' then
  update public.icash_seller_intakes set state='review',hold_reason='Shared research window ended' where id=l.id;
  return jsonb_build_object('status','research_window_ended');
 end if;$new$);
 definition:=replace(definition,$old$least(l.checked_at+interval '24 hours',l.data_rights_until)$old$,$new$least(now()+interval '24 hours',l.checked_at+interval '8 days',l.data_rights_until)$new$);
 -- Preserve research age internally so downstream offer/call gates cannot mistake
 -- distribution time for a new financial screening. No public lead-age label.
 definition:=replace(definition,$old$'complete',l.result,now()) returning id into screen$old$,$new$'complete',l.result,l.checked_at) returning id into screen$new$);
 needle:='for a in select ac.id,least(';
 if position(needle in definition)=0 then raise exception 'Seller candidate selection changed';end if;
 definition:=replace(definition,needle,'for a in select candidate.* from (select ac.id,least(');
 needle:='order by capacity desc,(select max(assigned_at) from public.icash_seller_matches where account_id=ac.id) asc nulls first,ac.id limit 50 loop';
 if position(needle in definition)=0 then raise exception 'Seller priority ordering changed';end if;
 definition:=replace(definition,needle,$new$) candidate where capacity>=charge
 -- Larger available budgets receive more opportunities; a square-root weight
 -- keeps smaller funded accounts competitive. First access rotates separately.
 order by
 case when exists(select 1 from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '24 hours') then 1 else 0 end,
 (case when match_count=0 then (select count(*) from public.icash_seller_intakes i where i.assigned_account=candidate.id and i.assigned_at>now()-interval '7 days') else (select count(*) from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '7 days') end + 1)
 /sqrt(greatest(candidate.capacity,charge)::numeric/charge)
 / (1+least(7,greatest(0,extract(epoch from(now()-coalesce((select max(m.assigned_at) from public.icash_seller_matches m where m.account_id=candidate.id),now()-interval '7 days')))/86400))),
 (select count(*) from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '7 days'),
 capacity desc,candidate.id limit 50 loop$new$);
 definition:=replace(definition,'-- Largest funded bid wins at the same cost-based price, with oldest assignment','-- Weighted distribution at the same recorded cost-based price;');
 definition:=replace(definition,'-- first for equal capacity. A bid is bounded by wallet AND rolling daily usage.','-- eligibility remains bounded by wallet AND rolling daily usage.');
 definition:=replace(definition,'-- Cap at eight actual buyers. This never simulates buyers or contact.','-- Cap at three distinct users. This never simulates buyers or contact.');
 definition:=replace(definition,'-- Three immediate matches; additional buyers are spread over subsequent days.','-- One immediate user, second after 24 hours, third after 72 hours.');
 execute definition;
end $patch$;


-- Align owner demand reporting with the three-recipient cap.
-- Read-only owner reporting. Does not change assignment, billing, schedule, or activation.
-- Aggregate owner planning only; no seller identities, lead ages, or cross-account
-- information are exposed to customer workspaces.
create or replace function public.icash_seller_demand_summary() returns jsonb language sql stable security invoker set search_path='' as $$
 with active as (
 select ac.id,least(w.balance_cents-w.reserved_cents,ac.daily_limit_cents-w.reserved_cents-coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=ac.id and kind='usage' and created_at>now()-interval '24 hours'),0)) capacity
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 where ac.billing_model='daily' and not ac.bot_paused
 and exists(select 1 from public.icash_daily_plans p where p.account_id=ac.id and p.state='active' and p.mode='live')
 and not exists(select 1 from public.icash_billing_reviews b where b.account_id=ac.id and b.resolved_at is null)
 ), mature as (
 select i.id,(select count(*) from public.icash_seller_matches m where m.lead_id=i.id) deliveries
 from public.icash_seller_intakes i where i.market_qualified and i.created_at between now()-interval '38 days' and now()-interval '8 days'
 ), due as (
 select i.id from public.icash_seller_intakes i where i.state in ('qualified','assigned') and i.ad_cost_micros is not null and i.next_assignment_at<now()+interval '24 hours'
 and i.checked_at>now()-interval '8 days' and i.data_rights_until>now()
 and (select case when count(*)=0 then now() else public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) end from public.icash_seller_matches m where m.lead_id=i.id)<now()+interval '24 hours'
 and (select count(*) from public.icash_seller_matches m where m.lead_id=i.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=i.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations c on c.account_id=sm.account_id and c.screening_id=sm.screening_id join public.icash_contact_suppressions s on s.account_id=c.account_id and s.contact_key=c.contact_key where sm.lead_id=i.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=i.id)
 )
 select jsonb_build_object(
 'activeAccounts',(select count(*) from active),
 'budgetAvailableAccounts',(select count(*) from active where capacity>0),
 'accountsWithoutLead24h',(select count(*) from active a where not exists(select 1 from public.icash_seller_matches m where m.account_id=a.id and m.assigned_at>now()-interval '24 hours')),
 'deliveries24h',(select count(*) from public.icash_seller_matches where assigned_at>now()-interval '24 hours'),
 'deliveries7d',(select count(*) from public.icash_seller_matches where assigned_at>now()-interval '7 days'),
 'qualified7d',(select count(*) from public.icash_seller_intakes where market_qualified and created_at>now()-interval '7 days'),
 'requests7d',(select count(*) from public.icash_seller_intakes where state<>'duplicate' and created_at>now()-interval '7 days'),
 'scheduledLeads24h',(select count(*) from due),
 'matureLeads',(select count(*) from mature),
 'observedRecipientsPerLead',(select avg(deliveries) from mature)
 )
$$;
revoke all on function public.icash_seller_demand_summary() from public,anon,authenticated;
grant execute on function public.icash_seller_demand_summary() to service_role;
