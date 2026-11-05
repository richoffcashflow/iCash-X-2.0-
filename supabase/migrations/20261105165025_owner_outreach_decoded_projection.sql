-- Reduce owner-report reads without changing records, classifications or admission.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;interest text;parser text;old_part text;new_part text;r record;
begin
 for r in select * from (values
  ('public.icash_seller_call_disposition(jsonb)','070b7300e48791b0aa5f30c2c6caf6d3'),
  ('public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)','862ac24b9b3651c9545956d3f7df87c9'),
  ('public.icash_seller_interest_quote(jsonb)','100b79d54c2f094f32672cf5979bd689')
 ) expected(signature,definition_hash) loop
  if md5(pg_get_functiondef(r.signature::regprocedure))<>r.definition_hash then
   raise exception 'Outreach projection prerequisite changed: %',r.signature;
  end if;
 end loop;
 if to_regprocedure('icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb)') is not null then
  raise exception 'Outreach interest parser already exists';
 end if;
 -- Keep one shared parser. Ordinary callers still use the full canonical
 -- disposition check; only this report reuses its same-result materialized check.
 interest:=pg_get_functiondef('public.icash_seller_interest_quote(jsonb)'::regprocedure);
 parser:=replace(interest,'public.icash_seller_interest_quote(','icash_reliability_private.seller_interest_quote_from_clear_transcript(');
 old_part:=$old$
  or public.icash_seller_call_disposition(p_result) is not null$old$;
 if (length(parser)-length(replace(parser,old_part,'')))/length(old_part)<>1 then
  raise exception 'Interest disposition guard changed';
 end if;
 execute replace(parser,old_part,'');
 old_part:=$old$ for turn in select value from jsonb_array_elements(p_result->'transcript') loop
  if jsonb_typeof(turn->'message') is distinct from 'string' then continue;end if;
  body:=lower(trim(regexp_replace(translate(turn->>'message','’‘',$quote$''$quote$),'\s+',' ','g')));
  if turn->>'role'='agent' then question:=body;continue;end if;
  if turn->>'role' is distinct from 'user' then question:='';continue;end if;
  if public.icash_call_has_seller_response(jsonb_build_object('transcript',jsonb_build_array(turn))) and (
   body ~ $pattern$^((i am|i'm|we are|we're) (interested in|open to) selling|(i|we) (want|would like) to sell)( (my|our|the) (house|home|property))?[.! ]*$$pattern$
   or (body ~ $pattern$^(yes|yeah|yep|sure|interested|i am interested|i'm interested|yes i am|yes,? i am interested|yes,? interested)[.! ,]*$$pattern$
    and (question='would you be open to a cash offer if the price and timing worked for you?'
     or (question ~ $pattern$(would you (be (interested in|open to)|consider)|are you (interested in|open to)|do you want to) (sell(ing)?|a cash offer)$pattern$
    and right(question,1)='?' and length(question)-length(replace(question,'?',''))=1
    and question !~ '\y(owner|own|hearing|hear|discuss|talk|information|send|permission|not|never|if|unless|maybe|learn|learning)\y')))
  ) then evidence:=turn->>'message';end if;
  question:='';
 end loop;
 return evidence;$old$;
 new_part:=$new$ return icash_reliability_private.seller_interest_quote_from_clear_transcript(p_result);$new$;
 if (length(interest)-length(replace(interest,old_part,'')))/length(old_part)<>1 then
  raise exception 'Interest parser changed';
 end if;
 execute replace(interest,old_part,new_part);
 d:=pg_get_functiondef('public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'::regprocedure);
 old_part:=$old$ ), screens as materialized (
  select s.id,s.account_id,s.state,s.created_at,s.completed_at,a.label,a.bot_paused,
   coalesce(nullif(s.result->'property'->>'address',''),nullif(s.snapshot->>'address',''),'Address pending') address,
   coalesce(s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
    and s.snapshot->>'propertyType'='house' and s.snapshot->>'propertyId'=s.result->'property'->>'propertyId',false) eligible
  from public.icash_screening_jobs s join accounts a on a.id=s.account_id
  where s.event_key like 'discovery:%' and s.snapshot->'sellerRequest' is null
   and coalesce(s.snapshot->>'practice','false')<>'true'
   and coalesce(s.snapshot->>'propertyId','') not like 'practice_%' and s.created_at<end_at
$old$;
 new_part:=$new$ ), screens as materialized (
  select s.id,s.account_id,s.state,s.created_at,s.completed_at,a.label,a.bot_paused,
   coalesce(nullif(result_fields.property->>'address',''),nullif(snapshot_fields.address,''),'Address pending') address,
   coalesce(s.state='complete' and result_fields."financialCheck"->>'status'='eligible'
    and snapshot_fields."propertyType"='house' and snapshot_fields."propertyId"=result_fields.property->>'propertyId',false) eligible
  from public.icash_screening_jobs s join accounts a on a.id=s.account_id
  cross join lateral jsonb_to_record(case when jsonb_typeof(s.snapshot)='object' then s.snapshot else '{}'::jsonb end)
   as snapshot_fields("propertyId" text,"propertyType" text,practice text,address text)
  cross join lateral jsonb_to_record(case when jsonb_typeof(s.result)='object' then s.result else '{}'::jsonb end)
   as result_fields(property jsonb,"financialCheck" jsonb)
  where s.event_key like 'discovery:%' and s.snapshot->'sellerRequest' is null
   and coalesce(snapshot_fields.practice,'false')<>'true'
   and coalesce(snapshot_fields."propertyId",'') not like 'practice_%' and s.created_at<end_at
$new$;
 if (length(d)-length(replace(d,old_part,'')))/length(old_part)<>1 then
  raise exception 'Outreach screening projection changed';
 end if;
 d:=replace(d,old_part,new_part);
 old_part:=$old$then public.icash_seller_interest_quote(v.result) is not null else false end interested$old$;
 new_part:=$new$then icash_reliability_private.seller_interest_quote_from_clear_transcript(v.result) is not null else false end interested$new$;
 if (length(d)-length(replace(d,old_part,'')))/length(old_part)<>1
  or strpos(d,'case when responded and v.result->''optedOut'' is distinct from ''true''::jsonb and disposition is null')=0 then
  raise exception 'Outreach same-result disposition fence changed';
 end if;
 execute replace(d,old_part,new_part);
end $patch$;
revoke all on function icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb) from public,anon,authenticated;
grant execute on function icash_reliability_private.seller_interest_quote_from_clear_transcript(jsonb) to service_role;
commit;
