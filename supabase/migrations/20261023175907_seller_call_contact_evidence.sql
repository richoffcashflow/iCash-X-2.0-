-- Derived response/interest signals only. Original conversations and cost
-- receipts remain immutable; source-word opt-outs remain effective.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create or replace function public.icash_call_has_seller_response(p_result jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'transcript')='array' then p_result->'transcript' else '[]'::jsonb end) t
 where t->>'role'='user' and (
  public.icash_seller_response_disposition(t->>'message')='opt_out'
  or (t->>'message' ~ '[[:alpha:]]'
   and t->>'message' !~* '^\s*[\[(*]?\s*(music|silence|noise|background noise|inaudible|unintelligible|no speech|no audio)\s*[\])*]?\s*[.!]*\s*$'
   and t->>'message' !~* 'leave (a |an |your )?(additional )?message|record (a |your )?message|(at|after) the (beep|tone)|mailbox (is|has)|voicemail (for|system)|has been disconnected|number you (have )?dialed|press (one|two|three|four|five|six|seven|eight|nine|zero|pound|star|[0-9#*])|automated (voice|system)|please (stay|hold|remain) on the line|please (say|state) your name|screening (this|your) call|call has been forwarded|cannot take your call|can.t take your call'
  )));
$$;

-- Use the existing account/property/message-bound selling-interest predicate.
-- A yes to ownership and unsent messages still cannot create interest.
do $patch$
declare d text;old text:='coalesce(v.interested,false),';replacement text:='(coalesce(v.interested,false) or public.icash_filter_sms_interest(p_account,s.id)), ';
begin
 d:=pg_get_functiondef('public.icash_refresh_opportunity_outcomes(uuid)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Opportunity interest boundary changed';end if;
 execute replace(d,old,replacement);
end $patch$;
-- Refresh derived history through the existing bounded account refresh path.
update public.icash_opportunity_refreshes set refreshed_at='-infinity'::timestamptz;
revoke all on function public.icash_call_has_seller_response(jsonb) from public,anon,authenticated;
grant execute on function public.icash_call_has_seller_response(jsonb) to service_role;
commit;
