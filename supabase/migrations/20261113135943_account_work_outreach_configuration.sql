-- Keep invalid calling configuration observable during closed outreach hours.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('icash_reliability_private.account_outreach_wait(uuid,timestamptz,timestamptz)'::regprocedure);
 if md5(d)<>'3cf72e201728ade473624fc1d3df1e2a'
  or not exists(select 1 from icash_reliability_private.outreach_wait_settings where id=1 and not enabled)
 then raise exception 'Staged outreach wait configuration predecessor changed';end if;
 needle:=$old$or public.icash_outreach_voice_current(p_account) is distinct from true then return false;end if;$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Outreach wait configuration boundary changed';end if;
 execute replace(d,needle,$new$or public.icash_outreach_voice_current(p_account) is distinct from true
  or not exists(select 1 from public.icash_voice_configs v
   join public.icash_operation_rates r on r.id=v.seller_rate_id and r.enabled and r.expires_at>p_clock
   where v.account_id=p_account and v.enabled and v.reviewed_until>p_clock) then return false;end if;$new$);
end $patch$;
commit;
