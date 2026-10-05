-- Eight distinct paying users: immediate, +1 hour, then days 1,2,3,4,5,7.
-- Internal timing only; historical assignments and charges are never rewritten.
create or replace function public.icash_seller_assignment_due(p_completed integer,p_first timestamptz,p_now timestamptz) returns timestamptz language sql immutable security invoker set search_path='' as $$
 select case when p_completed>=8 then 'infinity'::timestamptz
 when p_completed<=0 then coalesce(p_now,'-infinity'::timestamptz)
 when p_completed=1 then greatest(p_first+interval '1 hour',p_now+interval '1 hour')
 else greatest(p_first+(case when p_completed=7 then 7 else p_completed-1 end)*interval '1 day',p_now+interval '1 day') end
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
 definition:=replace(definition,needle,needle||$new$
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<=now()
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=icash_seller_intakes.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations c on c.account_id=sm.account_id and c.screening_id=sm.screening_id join public.icash_contact_suppressions s on s.account_id=c.account_id and s.contact_key=c.contact_key where sm.lead_id=icash_seller_intakes.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=icash_seller_intakes.id)
$new$);
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
 definition:=replace(definition,'-- Three immediate matches; additional buyers are spread over subsequent days.','-- One immediate user, second after one hour, six more over the following week.');
 execute definition;
end $patch$;

