-- Recompute derived interest from exact saved source turns. Never rewrite the
-- original transcript/receipt, invent an offer, or relax model qualification.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
create function public.icash_seller_interest_quote(p_result jsonb) returns text
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;body text;question text:='';evidence text;
begin
 if jsonb_typeof(p_result->'transcript') is distinct from 'array'
  or p_result->>'contactEvidence' in ('automated_answer','no_response')
  or public.icash_seller_call_disposition(p_result) is not null then return null;end if;
 for turn in select value from jsonb_array_elements(p_result->'transcript') loop
  if jsonb_typeof(turn->'message') is distinct from 'string' then continue;end if;
  body:=lower(trim(regexp_replace(translate(turn->>'message','’‘',$quote$''$quote$),'\s+',' ','g')));
  if turn->>'role'='agent' then question:=body;continue;end if;
  if turn->>'role' is distinct from 'user' then question:='';continue;end if;
  if public.icash_call_has_seller_response(jsonb_build_object('transcript',jsonb_build_array(turn))) and (
   body ~ $pattern$^((i am|i'm|we are|we're) (interested in|open to) selling|(i|we) (want|would like) to sell)( (my|our|the) (house|home|property))?[.! ]*$pattern$
   or (body ~ $pattern$^(yes|yeah|yep|sure|interested|i am interested|i'm interested|yes i am|yes,? i am interested|yes,? interested)[.! ,]*$pattern$
    and question ~ $pattern$(would you (be (interested in|open to)|consider)|are you (interested in|open to)|do you want to) (sell(ing)?|a cash offer)$pattern$
    and right(question,1)='?' and length(question)-length(replace(question,'?',''))=1
    and question !~ '\y(owner|own|hearing|hear|discuss|talk|information|send|permission|not|never|if|unless|maybe|learn|learning)\y')
  ) then evidence:=turn->>'message';end if;
  question:='';
 end loop;
 return evidence;
end $$;
create function public.icash_call_selling_interest(p_result jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select public.icash_call_has_seller_response(p_result)
  and p_result->'optedOut' is distinct from 'true'::jsonb
  and public.icash_seller_call_disposition(p_result) is null
  and (p_result->'interested'='true'::jsonb or public.icash_seller_interest_quote(p_result) is not null) is true;
$$;
revoke all on function public.icash_seller_interest_quote(jsonb),public.icash_call_selling_interest(jsonb) from public,anon,authenticated;
grant execute on function public.icash_seller_interest_quote(jsonb),public.icash_call_selling_interest(jsonb) to service_role;

do $patch$
declare d text;signature text;old text;replacement text;
begin
 foreach signature in array array[
  'public.icash_refresh_opportunity_outcomes(uuid)',
  'public.icash_refresh_ranker_samples(uuid)',
  'public.icash_refresh_learning_before_ranker(uuid)',
  'public.icash_refresh_seller_interest(uuid)',
  'public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'
 ] loop
  d:=pg_get_functiondef(signature::regprocedure);
  old:='c.result->''interested''=''true''::jsonb';
  if strpos(d,old)=0 then raise exception 'Interest reader changed: %',signature;end if;
  execute replace(d,old,'public.icash_call_selling_interest(c.result)');
 end loop;
 -- The owner report previously omitted SMS interest altogether. Use the same
 -- receipt-bound question/reply predicate and the report's actual time window.
 d:=pg_get_functiondef('public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'::regprocedure);
 old:='coalesce(v.interested,false) and not(coalesce(v.opted_out,false) or coalesce(t.opted_out,false)) interested,';
 replacement:='(coalesce(v.interested,false) or exists(select 1 from public.icash_deal_files sms_deal
  join public.icash_text_threads sms_thread on sms_thread.deal_id=sms_deal.id and sms_thread.account_id=sms_deal.account_id and sms_thread.party=''seller''
  where sms_deal.screening_id=s.id and sms_deal.account_id=s.account_id
   and public.icash_seller_sms_interest_at(s.account_id,sms_thread.id,''-infinity''::timestamptz,end_at) is not null))
  and not(coalesce(v.opted_out,false) or coalesce(t.opted_out,false)) interested,';
 if strpos(d,old)=0 then raise exception 'Owner SMS interest prerequisite changed';end if;d:=replace(d,old,replacement);
 old:='coalesce(v.interest_in_period,false) and not(coalesce(v.opted_out,false) or coalesce(t.opted_out,false)) interest_in_period,';
 replacement:='(coalesce(v.interest_in_period,false) or exists(select 1 from public.icash_deal_files sms_deal
  join public.icash_text_threads sms_thread on sms_thread.deal_id=sms_deal.id and sms_thread.account_id=sms_deal.account_id and sms_thread.party=''seller''
  where sms_deal.screening_id=s.id and sms_deal.account_id=s.account_id
   and public.icash_seller_sms_interest_at(s.account_id,sms_thread.id,start_at,end_at) is not null))
  and not(coalesce(v.opted_out,false) or coalesce(t.opted_out,false)) interest_in_period,';
 if strpos(d,old)=0 then raise exception 'Owner SMS interest period prerequisite changed';end if;
 execute replace(d,old,replacement);
end $patch$;
-- Existing bounded account refreshes recalculate history; no provider reads,
-- money releases, contact scheduling, model activation or raw receipt updates.
update public.icash_opportunity_refreshes set refreshed_at='-infinity'::timestamptz;
commit;
