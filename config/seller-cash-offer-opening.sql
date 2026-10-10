begin;
set local lock_timeout='3s';
-- Copy-only change for new seller openers. Retain the current contact gates,
-- stable recipient ordinals, sent history, identity answers and queue behavior.
select 1 from public.icash_operating_budget where id=1 for update;
do $copy$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_seller_recipient_opener(uuid,uuid,text,text,text)'::regprocedure);
 needle:=$old$body:=case ordinal
  when 1 then greeting||'AI for '||p_principal||' here about a possible cash offer. Are you the owner of '||p_address||'?'
  when 2 then greeting||'AI for '||p_principal||' asking about a possible cash offer. Do you own '||p_address||'?'
  when 3 then greeting||'AI for '||p_principal||' reaching out about a possible cash offer. Is '||p_address||' your property?'
 end||'';$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Seller recipient opening prerequisite changed';
 end if;
 definition:=replace(definition,needle,$new$body:=case ordinal
  when 1 then 'Is this '||case when p_seller ~ '^[A-Za-z][A-Za-z]{0,30}$' then p_seller||', ' else '' end||'the owner of '||p_address||'? I am reaching out about a possible cash offer.'
  when 2 then greeting||'do you own '||p_address||'? I wanted to ask about a possible cash offer.'
  when 3 then greeting||'is '||p_address||' your property? I am contacting you about a possible cash offer.'
 end;$new$);
 definition:=replace(definition,'Never shorten an identity/address, omit AI disclosure, or silently buy more segments.','Never truncate the property address or silently buy more segments.');
 execute definition;

 definition:=pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure);
 needle:=$old$message_body:=greeting||'AI for '||principal||'. Is this the owner of '||address||'?';$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Seller opening queue prerequisite changed';
 end if;
 execute replace(definition,needle,$new$message_body:='Is this '||case when seller is null then '' else seller||', ' end||'the owner of '||address||'? I am reaching out about a possible cash offer.';$new$);
end $copy$;
commit;
