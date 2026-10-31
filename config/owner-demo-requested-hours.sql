-- Only the presenting owner's fresh, explicit self-demo request can override
-- automatic calling hours. Reuse the complete receipt/identity/recipient guard;
-- never refresh requests, release held work, or change ordinary outreach hours.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare definition text;needle text;replacement text;item record;
begin
 definition:=pg_get_functiondef('public.icash_voice_outreach_context(uuid,uuid)'::regprocedure);
 needle:=$old$ return jsonb_build_object('timezone',zone,$old$;
 replacement:=needle||$new$
  'ownerDemoRequestedUntil',case when public.icash_owner_demo_call_current(p_account,p_job) then
   (select r.expires_at from public.icash_optin_call_requests r
    join public.icash_seller_intakes l on l.id=r.lead_id and l.request_id=r.request_id and l.phone=r.phone
    join public.icash_contact_permissions cp on cp.seller_intake_id=l.id and cp.account_id=p_account
    where cp.id=j.permission_id and r.account_id=p_account and r.source='demo_form') else null end,$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then execute replace(definition,needle,replacement);
 else raise exception 'Owner demo context prerequisite changed';end if;

 definition:=pg_get_functiondef('public.icash_voice_outreach_hours_current(uuid,uuid)'::regprocedure);
 needle:=$old$ return public.icash_outreach_window_open(context->>'timezone',null,clock_timestamp());$old$;
 replacement:=$new$ return public.icash_owner_demo_call_current(p_account,p_job)
  or public.icash_outreach_window_open(context->>'timezone',null,clock_timestamp());$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then execute replace(definition,needle,replacement);
 else raise exception 'Owner demo final hours prerequisite changed';end if;

 -- These pre-LIMIT selectors use the direct window, not hours_current.
 -- Preserve their target bindings, locks, capacity snapshots and fairness.
 for item in select * from (values
  ('icash_issue_ready_voice_ticket()',2,4),
  ('icash_resume_prospecting_ticket()',1,5)
 ) expected(signature,copies,indentation) loop
  definition:=pg_get_functiondef(('public.'||item.signature)::regprocedure);
  needle:='public.icash_outreach_window_open(current_target.timezone,'||E'\n'||repeat(' ',item.indentation)||
   'case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts'||E'\n'||repeat(' ',item.indentation+1)||
   'where id=v.operational_contact_id and account_id=v.account_id and channel=''voice'') end,clock_timestamp())';
  replacement:='('||needle||' or public.icash_owner_demo_call_current(v.account_id,v.id))';
  if (length(definition)-length(replace(definition,replacement,'')))/length(replacement)=item.copies then null;
  elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=item.copies then execute replace(definition,needle,replacement);
  else raise exception 'Owner demo queue hours prerequisite changed: %',item.signature;end if;
 end loop;
end $patch$;
commit;
