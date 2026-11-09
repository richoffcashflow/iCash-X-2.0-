-- Avoid unrelated history/capacity work before checking whether it is needed.
-- Read-path optimization only: retain every admission predicate and receipt.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

do $check$
declare item record;
begin
 for item in select * from (values
  ('icash_work_private.warm_seller_due(uuid)','6a86c571cdc5d6177f9e1b705baaefe9'),
  ('public.icash_sms_outreach_window_current(uuid,uuid,timestamp with time zone)','23fb70c54acb78e99b7ba1acc71740f6')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.checksum then
   raise exception 'Workflow isolation prerequisite changed: %',item.signature;
  end if;
 end loop;
end $check$;

do $priority$
declare d text;
begin
 d:=pg_get_functiondef('icash_work_private.warm_seller_due(uuid)'::regprocedure);
 -- A zero-argument STABLE capacity function in WHERE becomes a one-time
 -- filter even when this account has no due callback. The procedural boundary
 -- prevents global voice history work on the ordinary no-callback path.
 d:=replace(d,' return exists (',' if exists (');
 d:=replace(d,' ) or exists (',E' ) then return true; end if;\n if exists (');
 d:=replace(d,'and public.icash_outgoing_voice_capacity_open() and public.icash_voice_outreach_hours_current',
  'and public.icash_voice_outreach_hours_current');
 d:=replace(d,E' );\nend',E' ) then return coalesce(public.icash_outgoing_voice_capacity_open(),false); end if;\n return false;\nend');
 execute d;
end $priority$;

do $hours$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_sms_outreach_window_current(uuid,uuid,timestamp with time zone)'::regprocedure);
 -- Ordinary daytime eligibility needs no historical-conversation exception.
 -- CASE guarantees the history branch is skipped; reversing OR does not.
 d:=replace(d,E'public.icash_outreach_active_conversation(p_account,d.screening_id,t.recipient,p_clock)\n   or public.icash_outreach_window_open(t.timezone,c.timezone_basis,p_clock)',
  E'case when public.icash_outreach_window_open(t.timezone,c.timezone_basis,p_clock) then true\n   else public.icash_outreach_active_conversation(p_account,d.screening_id,t.recipient,p_clock) end');
 execute d;
end $hours$;
commit;
