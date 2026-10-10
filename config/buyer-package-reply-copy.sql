begin;
set local lock_timeout='3s';
select 1 from public.icash_operating_budget where id=1 for update;
-- Buyer replies use the same plain business wording as the initial package.
do $copy$
declare item record;definition text;matched integer:=0;
begin
 for item in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'icash_buyer_factual_text%' loop
  definition:=pg_get_functiondef(item.oid);
  if position($old$answer:='Here is the approved deal summary: '||link;$old$ in definition)>0 then
   definition:=replace(definition,$old$answer:='Here is the approved deal summary: '||link;$old$,
    $new$answer:='Here is the buyer package: '||link;$new$);
   if position($old$return 'AI assistant: '||answer;$old$ in definition)=0 then raise exception 'Buyer reply prefix prerequisite changed';end if;
   definition:=replace(definition,$old$return 'AI assistant: '||answer;$old$,'return answer;');
   execute definition;matched:=matched+1;
  end if;
 end loop;
 if matched<>1 then raise exception 'Expected one buyer factual reply, found %',matched;end if;
end $copy$;
commit;
