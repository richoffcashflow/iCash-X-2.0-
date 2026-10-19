begin;
set local lock_timeout='5s';
-- Owner policy: verified inbound sellers have no clock-hour sending window.
-- Do not change consent evidence, expiry, callback appointments or cold contacts.
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_seller_sms_permission_current(uuid,uuid,boolean)'::regprocedure);
 needle:='return not p_check_hour or (h>=9 and h<20) or public.icash_seller_sms_inquiry_window(p_account,t.id);';
 if position(needle in d)=0 then raise exception 'Inbound SMS permission prerequisite changed';end if;
 execute replace(d,needle,'return true; -- All binding, consent and channel checks above still apply.');

 d:=pg_get_functiondef('public.icash_claim_text_before_ai(uuid,uuid,text)'::regprocedure);
 needle:='if (h<9 or h>=20) and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;';
 if position(needle in d)=0 then raise exception 'Text claim prerequisite changed';end if;
 execute replace(d,needle,'if (h<9 or h>=20) and not public.icash_seller_sms_permission_current(p_account,t.id,false) and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;');

 d:=pg_get_functiondef('public.icash_meta_claim_text(uuid,uuid,text)'::regprocedure);
 needle:=$n$if (h<9 or h>=20) and not (m.call_now and m.submitted_at>now()-interval '5 minutes') and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;$n$;
 if position(needle in d)=0 then raise exception 'Meta text claim prerequisite changed';end if;
 execute replace(d,needle,'-- Verified Meta contact evidence is checked above; no clock-hour gate.');

 d:=pg_get_functiondef('public.icash_meta_claim_voice(uuid,uuid)'::regprocedure);
 needle:='if (h<9 or h>=20) and not public.icash_meta_call_now(p_account,p_job) and not public.icash_requested_seller_call_current(p_account,p_job) then return false;end if;';
 if position(needle in d)=0 then raise exception 'Meta voice claim prerequisite changed';end if;
 execute replace(d,needle,'-- Meta voice context already verifies current inbound contact evidence.');

 d:=pg_get_functiondef('public.icash_claim_voice_job(uuid)'::regprocedure);
 needle:='if (h<greatest(9,p.local_start_hour) or h>=least(case when public.icash_seller_voice_permission_current(j.account_id,p.id) then 20 else 18 end,p.local_end_hour)) and not public.icash_requested_seller_call_current(j.account_id,j.id) and not public.icash_requested_optin_call_current(j.account_id,j.id) then return false;end if;';
 if position(needle in d)=0 then raise exception 'Voice claim prerequisite changed';end if;
 execute replace(d,needle,'if not public.icash_seller_voice_permission_current(j.account_id,p.id) and (h<greatest(9,p.local_start_hour) or h>=least(18,p.local_end_hour)) and not public.icash_requested_seller_call_current(j.account_id,j.id) and not public.icash_requested_optin_call_current(j.account_id,j.id) then return false;end if;');

 d:=pg_get_functiondef('public.icash_cancellation_voice_current(uuid,text)'::regprocedure);
 needle:=$n$and extract(hour from now() at time zone p.timezone)>=greatest(9,p.local_start_hour)
 and extract(hour from now() at time zone p.timezone)<least(case when public.icash_seller_voice_permission_current(p_account,p.id) then 20 else 18 end,p.local_end_hour)$n$;
 if position(needle in d)=0 then raise exception 'Seller cancellation claim prerequisite changed';end if;
 execute replace(d,needle,$n$and (public.icash_seller_voice_permission_current(p_account,p.id) or (
 extract(hour from now() at time zone p.timezone)>=greatest(9,p.local_start_hour)
 and extract(hour from now() at time zone p.timezone)<least(18,p.local_end_hour)))$n$);
end $patch$;

-- Wake only never-dispatched inbound jobs deferred solely by the retired window.
-- Preserve requested callback times, follow-up cadence and every prior receipt.
update public.icash_voice_jobs j set due_at=now(),outcome='Inbound contact ready',updated_at=now()
where j.state='ready' and j.outcome='Waiting for calling hours'
 and j.callback_id is null and j.sms_source_message_id is null
 and j.provider_call_sid is null and j.conversation_id is null and j.operation_key is null
 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||j.id)
 and public.icash_seller_voice_permission_current(j.account_id,j.permission_id)
 and (j.meta_followup_lead_id is null or public.icash_meta_followup_current(j.meta_followup_lead_id,'call'));
commit;
