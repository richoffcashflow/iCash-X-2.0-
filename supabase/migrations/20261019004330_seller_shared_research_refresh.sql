begin;
set local lock_timeout='5s';

-- A delayed delivery can cross the 24-hour research limit. Keep a separate
-- provider receipt; never relabel old data as fresh or resubmit the lead.
create table public.icash_seller_research_refreshes(
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.icash_seller_intakes(id),
 source_fetched_at timestamptz not null,source_property jsonb not null,source_result jsonb not null,
 claim_token uuid not null,claimed_at timestamptz not null default now(),
 state text not null default 'checking' check(state in ('checking','complete','review')),
 lookup_costs jsonb not null,lookup_cap_micros bigint not null check(lookup_cap_micros>0),
 lookup_cost_basis text not null,data_rights_until timestamptz not null,
 result jsonb,hold_reason text,completed_at timestamptz,applied_screenings uuid[] not null default '{}',
 unique(lead_id,source_fetched_at)
);
alter table public.icash_seller_research_refreshes enable row level security;
revoke all on public.icash_seller_research_refreshes from public,anon,authenticated;
grant select,insert,update on public.icash_seller_research_refreshes to service_role;

-- Only a new, unstarted response may be recovered. Completed conversations,
-- receipts, ambiguous sends, signed deals, manual controls and opt-outs win.
create function public.icash_seller_research_refresh_targets(p_lead uuid default null)
returns table(lead_id uuid,screening_id uuid,account_id uuid)
language sql stable security invoker set search_path='' as $$
 select l.id,s.id,a.id from public.icash_seller_responses r
 join public.icash_seller_matches m on m.lead_id=r.lead_id and m.account_id=r.account_id and m.screening_id=r.screening_id
 join public.icash_seller_intakes l on l.id=r.lead_id
 join public.icash_screening_jobs s on s.id=r.screening_id and s.account_id=r.account_id
 join public.icash_accounts a on a.id=r.account_id
 join public.icash_wallets w on w.account_id=a.id
 join public.icash_deal_files d on d.screening_id=s.id and d.account_id=a.id
 where (p_lead is null or l.id=p_lead) and l.state='assigned' and l.ai_consented
 and l.contact_consent_scope is distinct from 'icash_x_demo'
 and l.data_rights_until>now() and l.checked_at>=now()-interval '8 days'
 and r.state in ('pending','needs_setup','queued') and m.assigned_at between now()-interval '24 hours' and now()
 and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 and s.snapshot->>'propertyId'=l.property->>'id' and s.snapshot->'sellerRequest'->>'id'=l.id::text
 and (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '8 days' and now()-interval '24 hours'
 and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
 and not a.bot_paused and w.balance_cents>0 and public.icash_membership_work_allowed(a.id)
 and (public.icash_outreach_sms_current(a.id) or public.icash_outreach_voice_current(a.id))
 and public.icash_seller_contact_evidence(a.id,s.id,l.id,l.phone) is not null
 and public.icash_research_state_allowed(public.icash_address_state(l.address))
 and not exists(select 1 from public.icash_billing_reviews b where b.account_id=a.id and b.resolved_at is null)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_handoffs h where h.account_id=a.id and h.screening_id=s.id and h.state<>'resolved')
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=l.phone)
 and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex'))
 and not exists(select 1 from public.icash_signing_envelopes e where e.account_id=a.id and e.deal_id=d.id and not e.test_mode)
 and not exists(select 1 from public.icash_text_threads t where t.account_id=a.id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone
  and (t.retired_at is not null or t.manual_only or t.ai_mode<>'auto' or t.paused))
 and not exists(select 1 from public.icash_text_threads t join public.icash_text_messages msg on msg.thread_id=t.id and msg.account_id=t.account_id
  where t.account_id=a.id and t.deal_id=d.id and t.party='seller' and t.recipient=l.phone
  and (msg.direction='incoming' or msg.state<>'ready' or msg.provider_id is not null
   or exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||msg.id)))
 and not exists(select 1 from public.icash_voice_jobs v join public.icash_contact_permissions p on p.id=v.permission_id and p.account_id=v.account_id
  where p.account_id=a.id and p.screening_id=s.id and (v.callback_id is not null or v.state not in ('ready','held')
   or (v.state='held' and v.outcome is distinct from 'fresh_screening_required')
   or v.operation_key is not null or v.provider_call_sid is not null or v.conversation_id is not null
   or exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||v.id)))
 and not exists(select 1 from public.icash_call_recordings cr where cr.account_id=a.id and cr.screening_id=s.id)
 and not exists(select 1 from public.icash_live_conversations cv where cv.account_id=a.id and cv.screening_id=s.id);
$$;

create function public.icash_claim_seller_research_refresh() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.icash_seller_controls;l public.icash_seller_intakes;r public.icash_operation_rates;u public.icash_data_cost_settings;
 parts jsonb;cap bigint;refresh public.icash_seller_research_refreshes;
begin
 select * into c from public.icash_seller_controls where id=1 for update;
 if not found or not c.enabled or c.data_rights_until is null or c.data_rights_until<=now() or length(coalesce(c.review_ref,''))<10 then return null;end if;
 update public.icash_seller_research_refreshes set state='review',hold_reason='Refresh outcome unknown; do not repeat automatically'
 where state='checking' and claimed_at<now()-interval '2 minutes';
 select * into l from public.icash_seller_intakes i where exists(select 1 from public.icash_seller_research_refresh_targets(null) t where t.lead_id=i.id)
 and (i.property->>'fetchedAt')::timestamptz between now()-interval '8 days' and now()-interval '24 hours'
 and not exists(select 1 from public.icash_seller_research_refreshes f where f.lead_id=i.id and f.source_fetched_at=(i.property->>'fetchedAt')::timestamptz)
 order by i.checked_at,i.id limit 1 for update skip locked;
 if not found then return null;end if;
 select * into r from public.icash_operation_rates where operation='property_search' and enabled and verified_at<=now() and expires_at>now() order by verified_at desc,id limit 1;
 select * into u from public.icash_data_cost_settings where provider='dealmachine';
 if r.id is null or u.credit_micros is null then return null;end if;
 parts:=r.costs_micros||jsonb_build_object('dealmachine',u.credit_micros,'acquisition',0);
 select sum(value::numeric)::bigint into cap from jsonb_each_text(parts);
 if cap<=0 or c.lookup_used_micros+c.lookup_reserved_micros+cap>c.lookup_allowance_micros then return null;end if;
 insert into public.icash_seller_research_refreshes(lead_id,source_fetched_at,source_property,source_result,claim_token,lookup_costs,lookup_cap_micros,lookup_cost_basis,data_rights_until)
 values(l.id,(l.property->>'fetchedAt')::timestamptz,l.property,l.result,gen_random_uuid(),parts,cap,u.cost_basis||'; '||u.source_ref||'; non-data allocations: '||r.evidence_ref,least(l.data_rights_until,c.data_rights_until)) returning * into refresh;
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros+cap where id=1;
 return jsonb_build_object('id',refresh.id,'token',refresh.claim_token,'address',l.address,'assignmentFeeCents',c.assignment_fee_cents,'sellerCostReserveCents',c.seller_cost_reserve_cents);
end $$;

create function public.icash_finish_seller_research_refresh(p_id uuid,p_token uuid,p_output jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare f public.icash_seller_research_refreshes;l public.icash_seller_intakes;s public.icash_screening_jobs;t record;
 used integer;parts jsonb;cost bigint;numbers boolean;applied uuid[]:='{}';fresh timestamptz;
begin
 perform 1 from public.icash_seller_controls where id=1 for update;
 select * into f from public.icash_seller_research_refreshes where id=p_id for update;
 if not found or f.claim_token is distinct from p_token then return false;end if;
 if f.state='complete' then return f.result=p_output;end if;
 if f.state<>'checking' or f.claimed_at<now()-interval '2 minutes' then return false;end if;
 used:=(p_output->>'creditsUsed')::integer;
 if used is null or used not between 0 and 1 or octet_length(p_output::text)>64000 then raise exception 'Invalid refresh receipt';end if;
 parts:=f.lookup_costs||jsonb_build_object('dealmachine',(f.lookup_costs->>'dealmachine')::bigint*used);
 select sum(value::numeric)::bigint into cost from jsonb_each_text(parts);
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros-f.lookup_cap_micros,lookup_used_micros=lookup_used_micros+cost where id=1;
 update public.icash_seller_research_refreshes set result=p_output,lookup_costs=parts,completed_at=now(),state='review',hold_reason='Fresh matching property required' where id=f.id;
 select * into l from public.icash_seller_intakes where id=f.lead_id for update;
 fresh:=(p_output->'property'->>'fetchedAt')::timestamptz;
 if l.property is distinct from f.source_property or l.result is distinct from f.source_result or f.data_rights_until<=now()
  or p_output->'property'->>'id' is distinct from f.source_property->>'id'
  or p_output->'result'->'property'->>'propertyId' is distinct from f.source_property->>'id'
  or fresh is null or fresh not between f.claimed_at and now() then return false;end if;
 numbers:=coalesce((p_output->>'numbersPassed')::boolean,false) and p_output->'result'->'financialCheck'->>'status'='eligible'
  and coalesce((p_output->'result'->>'preliminarySellerCeilingCents')::bigint,0)>0;
 for t in select * from public.icash_seller_research_refresh_targets(l.id) loop
  select * into s from public.icash_screening_jobs where id=t.screening_id and account_id=t.account_id for update;
  if (s.snapshot->>'fetchedAt')::timestamptz<>f.source_fetched_at then continue;end if;
  -- Preserve the inquiry/identity binding, deal, message IDs and original charge.
  update public.icash_screening_jobs set snapshot=s.snapshot||jsonb_build_object('fetchedAt',p_output->'property'->>'fetchedAt','raw',p_output->'property'->'raw','sellerCostReserveCents',p_output->'property'->'sellerCostReserveCents'),
   result=p_output->'result',completed_at=fresh where id=s.id;
  if numbers then
   update public.icash_voice_jobs v set state='ready',outcome=null,due_at=now(),updated_at=now()
   from public.icash_contact_permissions p where p.id=v.permission_id and p.account_id=v.account_id and p.screening_id=s.id and p.account_id=s.account_id
    and v.state='held' and v.outcome='fresh_screening_required' and v.callback_id is null
    and v.operation_key is null and v.provider_call_sid is null and v.conversation_id is null
    and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||v.id)
    and not exists(select 1 from public.icash_call_recordings cr where cr.voice_job_id=v.id);
  end if;
  update public.icash_seller_responses set state='pending',detail='Property research refreshed; checking outreach',next_attempt_at=now(),updated_at=now()
   where screening_id=s.id and account_id=s.account_id and state in ('pending','needs_setup','queued');
  applied:=array_append(applied,s.id);
 end loop;
 -- Share the actual new provider data with future delayed recipients. Keep the
 -- original checked_at / eight-day sharing deadline and frozen customer prices.
 if cardinality(applied)>0 then
  update public.icash_seller_intakes set property=p_output->'property',result=p_output->'result',numbers_passed=coalesce(numbers,false),market_qualified=coalesce(numbers,false) where id=l.id;
 end if;
 update public.icash_seller_research_refreshes set state='complete',hold_reason=null,applied_screenings=applied where id=f.id;
 return true;
end $$;

-- The completion time follows the actual refreshed research, while checked_at
-- continues to bound the original eight-day sharing and cost reservation window.
do $patch$
declare definition text;needle text:=$old$'complete',l.result,l.checked_at)$old$;
begin
 definition:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Seller assignment research prerequisite changed';end if;
 execute replace(definition,needle,$new$'complete',l.result,(l.property->>'fetchedAt')::timestamptz)$new$);
end $patch$;

revoke all on function public.icash_seller_research_refresh_targets(uuid),public.icash_claim_seller_research_refresh(),public.icash_finish_seller_research_refresh(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_seller_research_refresh_targets(uuid),public.icash_claim_seller_research_refresh(),public.icash_finish_seller_research_refresh(uuid,uuid,jsonb) to service_role;
commit;
