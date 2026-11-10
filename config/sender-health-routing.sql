-- Reuse signed, receipt-bound temporary-number health for first SMS allocation.
-- Established identities, caller eligibility and all final-send guards remain intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $patch$
declare source text:=pg_get_functiondef('public.icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure);
begin
 if md5(source) in ('f36fdc250af52096ae518b53d99ad6da','930f94654dc7c15fdcc20056ab87642d') then return;end if;
 if md5(source) not in ('4721351baeb15d046dfe902a79a62fda','44b20b926b46aecb9b70e69161e7be1d') then raise exception 'Unexpected sender health routing predecessor';end if;
 if md5(pg_get_functiondef('icash_text_receipt_private.sender_opener_available(text)'::regprocedure))<>'298ceef9b89fd406c751ad4a8a2906f0' then raise exception 'Unexpected sender recovery health policy';end if;
 source:=replace(source,$before$declare chosen text;identities integer;$before$,$after$declare unavailable text[]:=array[]::text[];existing_identity boolean;chosen text;identities integer;$after$);
 source:=replace(source,$before$ select s.phone into chosen from public.icash_text_senders s$before$,$after$ -- Check health only after deterministic selection, avoiding a health query
 -- for every number on the normal healthy path. Each rejected sender is removed
 -- from this bounded eligible pool; original identities are never reassigned.
 existing_identity:=chosen is not null;
 loop
 select s.phone into chosen from public.icash_text_senders s$after$);
 source:=replace(source,$before$  and not public.icash_text_role_conflict(s.phone,p_recipient)$before$,$after$  and not (s.phone=any(unavailable))
  and not public.icash_text_role_conflict(s.phone,p_recipient)$after$);
 source:=replace(source,$before$ limit 1;
 return chosen;$before$,$after$ limit 1;
 exit when chosen is null or p_voice or existing_identity
  or icash_text_receipt_private.sender_opener_available(chosen);
 unavailable:=array_append(unavailable,chosen);chosen:=null;
 end loop;
 return chosen;$after$);
 if md5(source) not in ('f36fdc250af52096ae518b53d99ad6da','930f94654dc7c15fdcc20056ab87642d') then raise exception 'Unexpected sender health routing replacement';end if;
 execute source;
end $patch$;
commit;
