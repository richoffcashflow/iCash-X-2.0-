-- An abandoned consumed capability is not actionable outreach. Preserve it for
-- reconciliation, but do not let it indefinitely block unrelated new research.
begin;
set local lock_timeout='5s';
do $patch$
declare d text;needle text:=$old$     and held.state='held' and held.outcome='held_for_reconciliation')$old$;
begin
 d:=pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure);
 if md5(d)<>'b5b9b09de560b651bc88e218713b9d24'
  or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then
  raise exception 'Research priority source changed; review before applying';
 end if;
 execute replace(d,needle,$new$     and ((held.state='held' and held.outcome='held_for_reconciliation')
      or (held.kind='seller_opener' and held.state='consumed' and held.expires_at<now()-interval '5 minutes')))$new$);
end $patch$;
commit;
