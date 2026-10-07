begin;
-- Future consented intake conversations only; preserve delivered history and STOP handling.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 needle:=$old$message_body:=greeting||'AI for '||principal||', '||buyer_description||'. Is this the owner of '||address||'? Reply STOP to opt out.';$old$;
 if position(needle in definition)=0 then raise exception 'Seller opener prerequisite changed';end if;
 execute replace(definition,needle,$new$if t.seller_intake_id is not null and public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient) is not null then
  select split_part(trim(l.name),' ',1) into seller from public.icash_seller_intakes l where l.id=t.seller_intake_id and l.phone=t.recipient;
  if seller is null or seller !~ '^[A-Za-z][A-Za-z]{0,30}$' then seller:=null;end if;
  message_body:='Hi, is this '||case when seller is null then '' else seller||', ' end||'the owner of '||address||'?';
 else
  message_body:=greeting||'AI for '||principal||'. Is this the owner of '||address||'? Reply STOP to opt out.';
 end if;$new$);
end $patch$;
do $patch$
declare signature text;definition text;
begin
 foreach signature in array array['public.icash_queue_ai_reply_before_campaign(uuid,uuid,text)','public.icash_prepare_owner_reply(uuid,text,jsonb)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if position('What date, time, and time zone work for a callback?' in definition)=0 then raise exception 'Callback template prerequisite changed';end if;
  execute replace(definition,'What date, time, and time zone work for a callback?','When is a good time to talk about a cash offer?');
 end loop;
end $patch$;
commit;
