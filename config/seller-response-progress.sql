begin;
set local lock_timeout='5s';
-- Scheduled/claimed calls are work in progress, not a customer setup task.
-- Only enabled automatic channels are required; explicit SMS-only choices stay effective.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_prepare_seller_responses(uuid)'::regprocedure);
 needle:='sms_started boolean;voice_started boolean;';
 if position(needle in definition)=0 then raise exception 'Seller response declaration changed';end if;
 definition:=replace(definition,needle,needle||'sms_enabled boolean;voice_enabled boolean;voice_pending boolean;voice_due timestamptz;response_state text;');
 needle:='sms_started:=false;voice_started:=false;';
 if position(needle in definition)=0 then raise exception 'Seller response initialization changed';end if;
 definition:=replace(definition,needle,needle||'sms_enabled:=public.icash_outreach_sms_current(r.account_id);voice_enabled:=public.icash_outreach_voice_current(r.account_id);voice_pending:=false;voice_due:=null;');
 needle:='if th.id is not null then';
 if position(needle in definition)=0 then raise exception 'Seller text preparation changed';end if;
 definition:=replace(definition,needle,'if th.id is not null and sms_enabled then');
 needle:='where p.account_id=r.account_id and p.screening_id=r.screening_id and p.party=''seller''';
 if position(needle in definition)=0 then raise exception 'Seller voice insertion changed';end if;
 definition:=replace(definition,needle,'where voice_enabled and p.account_id=r.account_id and p.screening_id=r.screening_id and p.party=''seller''');
 needle:='where v.account_id=r.account_id and p.screening_id=r.screening_id and p.phone=l.phone and v.callback_id is null and v.state=''ready''';
 if position(needle in definition)=0 then raise exception 'Seller voice selection changed';end if;
 definition:=replace(definition,needle,'where voice_enabled and v.account_id=r.account_id and p.screening_id=r.screening_id and p.phone=l.phone and v.callback_id is null and v.state=''ready''');
 needle:=$old$  update public.icash_seller_responses set state=case when sms_started and voice_started then 'contact_started' when message is not null or job.id is not null then 'queued' else 'needs_setup' end,
   detail=case when sms_started and voice_started then 'Text accepted and call started' when message is not null or job.id is not null then 'Response ready for final provider checks' when sms_started then 'First call needs setup or review' when voice_started then 'First text needs setup or review' else response_detail end,$old$;
 replacement:=$new$  select count(*)>0,min(v.due_at) into voice_pending,voice_due
   from public.icash_voice_jobs v join public.icash_contact_permissions p on p.id=v.permission_id and p.account_id=v.account_id
   where voice_enabled and v.account_id=r.account_id and p.screening_id=r.screening_id and p.phone=l.phone
    and v.callback_id is null and v.state in ('ready','issued','dispatching');
  response_state:=case when (sms_started or voice_started) and (sms_started or not sms_enabled) and (voice_started or not voice_enabled) then 'contact_started'
   when message is not null or job.id is not null or voice_pending then 'queued' else 'needs_setup' end;
  update public.icash_seller_responses set state=response_state,
   detail=case when response_state='contact_started' then case when sms_started and voice_started then 'Text accepted and call started' when sms_started then 'Text accepted' else 'Call started' end
    when voice_pending and voice_due>now() then case when sms_started then 'Text accepted; call scheduled' else 'Call scheduled; text status is tracked separately' end
    when message is not null or job.id is not null or voice_pending then 'Response queued for final provider checks'
    when sms_started then 'First call needs setup or review' when voice_started then 'First text needs setup or review' else response_detail end,$new$;
 if position(needle in definition)=0 then raise exception 'Seller response state changed';end if;
 definition:=replace(definition,needle,replacement);
 needle:=$old$'status',case when message is not null or job.id is not null then 'queued' else response_detail end$old$;
 if position(needle in definition)=0 then raise exception 'Seller response result changed';end if;
 definition:=replace(definition,needle,$new$'status',response_state$new$);
 execute definition;
end $patch$;
commit;
