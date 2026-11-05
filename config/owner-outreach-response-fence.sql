-- Skip disposition work for completed calls already proven to contain no
-- seller response. Source-word opt-outs always count as a response, and
-- incomplete calls still receive the original disposition check.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old_part text:=$old$ ), voice_evidence as materialized (
  -- Classify only the selected conversation, once per report.
  select v.*,
   case when ai_complete then public.icash_call_has_seller_response(v.result) else false end responded,
   case when has_conversation then public.icash_seller_call_disposition(v.result) end disposition
  from voice_source v
$old$;new_part text:=$new$ ), voice_responses as materialized (
  select v.*,
   case when ai_complete then public.icash_call_has_seller_response(v.result) else false end responded
  from voice_source v
 ), voice_evidence as materialized (
  -- A completed call without a response cannot contain a source-word opt-out:
  -- the response predicate includes every source-word opt-out explicitly.
  select v.*,
   case when has_conversation and (responded or ai_complete is not true)
    then public.icash_seller_call_disposition(v.result) end disposition
  from voice_responses v
$new$;
begin
 d:=pg_get_functiondef('public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'::regprocedure);
 if (length(d)-length(replace(d,old_part,'')))/length(old_part)<>1 then raise exception 'Owner outreach response boundary changed';end if;
 execute replace(d,old_part,new_part);
end $patch$;
commit;

