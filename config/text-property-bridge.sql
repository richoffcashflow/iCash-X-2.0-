create table public.icash_text_property_checks(
 thread_id uuid primary key references public.icash_text_threads(id),
 account_id uuid not null references public.icash_accounts(id),check_id uuid not null references public.icash_property_checks(id),
 assignment_fee_cents bigint not null default 1000000 check(assignment_fee_cents between 0 and 100000000)
);
alter table public.icash_text_property_checks enable row level security;
revoke all on public.icash_text_property_checks from public,anon,authenticated;
grant all on public.icash_text_property_checks to service_role;
create function public.icash_text_property_context(p_account uuid,p_thread uuid) returns jsonb language plpgsql set search_path='' as $$
declare prop jsonb;ceiling bigint; fetched timestamptz;t public.icash_text_threads;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.party<>'seller' then return null;end if;
 if exists(select 1 from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account and d.terms->>'practice'='true') then
 select c.result->'property',greatest(0,(c.result->'property'->>'screeningBuyerCeilingCents')::bigint-b.assignment_fee_cents)
 into prop,ceiling from public.icash_text_property_checks b join public.icash_property_checks c on c.id=b.check_id and c.account_id=b.account_id
 where b.thread_id=p_thread and b.account_id=p_account and c.state='complete' and c.result->>'addressMatched'='true';
 else
 select s.result->'property',(s.result->>'preliminarySellerCeilingCents')::bigint into prop,ceiling
 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id and s.state='complete'
 where d.id=t.deal_id and d.account_id=p_account and d.stage='draft';
 end if;
 fetched:=(prop->>'fetchedAt')::timestamptz;
 if prop is null or fetched is null or fetched>now() or fetched<now()-interval '24 hours' then return null;end if;
 return jsonb_build_object('address',prop->>'address','fetchedAt',fetched,'ceilingCents',ceiling,'titleReview',coalesce(prop->'financialScreening'->>'status'='title_review_needed',false));
end $$;
revoke all on function public.icash_text_property_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_text_property_context(uuid,uuid) to service_role;
-- Preserve current production functions and add only approved, non-binding clarification actions.
do $patch$
declare definition text;needle text:=$n$when 'ask_callback' then 'What date, time, and time zone work for a callback?'$n$;addition text:=$n$
 when 'ask_flexibility' then 'Is there flexibility in your asking price?'
 when 'ask_payoff' then 'Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?'$n$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_owner_reply(uuid,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Owner reply policy changed';end if;
 definition:=replace(definition,needle,needle||addition);
 definition:=replace(definition,' body:=case p_action', $n$
 if p_action in ('ask_flexibility','ask_payoff') and public.icash_text_property_context(t.account_id,t.id) is null then raise exception 'Fresh property context required';end if;
 if p_action in ('ask_flexibility','ask_payoff') and exists(select 1 from public.icash_owner_reply_attempts prior where prior.thread_id=t.id and prior.id<>a.id and prior.outgoing_id is not null and prior.result->'analysis'->>'action'=p_action) then raise exception 'Question already sent';end if;
 body:=case p_action$n$);
 execute definition;
 definition:=pg_get_functiondef('public.icash_queue_ai_reply(uuid,uuid,text)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Production reply policy changed';end if;
 definition:=replace(definition,needle,needle||addition);
 definition:=replace(definition,' if p_reply is distinct from', $n$
 if j.analysis->>'action' in ('ask_flexibility','ask_payoff') and public.icash_text_property_context(p_account,t.id) is null then return null;end if;
 if p_reply is distinct from$n$);
 execute definition;
end $patch$;
