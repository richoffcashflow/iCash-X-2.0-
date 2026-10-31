-- Wait before selecting contact work when the organization export slot is held.
-- This changes scheduling only. Final admission, receipts, money and all
-- existing recipient/account/retry checks remain authoritative.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_enrichment_candidate(uuid)'::regprocedure);
 needle:='when public.icash_dealmachine_capacity_available() then';
 if md5(d)<>'dc58d9c0f7bc23bb2bec40347bfb5a6b' or position(needle in d)=0 then raise exception 'Owner export candidate prerequisite changed';end if;
 execute replace(d,needle,'when public.icash_dealmachine_capacity_available() and public.icash_owner_active_export_capacity() in (''disabled'',''ready'') then');

 -- A blocked contact quote cannot make an unaffordable discovery look eligible.
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:='where c.contacts_enabled and r.id=c.contact_rate_id';
 if md5(d)<>'9287385735800b70dc23c78047447e58' or position(needle in d)=0 then raise exception 'Owner export acquisition prerequisite changed';end if;
 execute replace(d,needle,'where c.contacts_enabled and public.icash_owner_active_export_capacity() in (''disabled'',''ready'') and r.id=c.contact_rate_id');

 -- Filter before LIMIT so parked contacts cannot starve unrelated work.
 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 needle:='and (x.kind not in (''contacts'',''discovery'') or (public.icash_dealmachine_capacity_available() and not a.waiting_for_outreach))';
 if md5(d)<>'c8419c3aadfa32e40442848f6b593701' or position(needle in d)=0 then raise exception 'Owner export resume prerequisite changed';end if;
 execute replace(d,needle,needle||E'\n  and (x.kind<>''contacts'' or public.icash_owner_active_export_capacity() in (''disabled'',''ready''))');
end $patch$;
commit;
