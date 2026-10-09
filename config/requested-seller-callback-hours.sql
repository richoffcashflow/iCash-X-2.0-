begin;
-- Only an explicit, current seller request changes the ordinary contact window.
-- Consent, route revision, latest reply, account, property, opt-out, wallet and
-- provider idempotency checks remain required. No buyer outbound calls.
create function public.icash_requested_seller_call_current(p_account uuid,p_job uuid)
returns boolean language sql security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
  join public.icash_text_messages m on m.id=j.sms_source_message_id and m.account_id=j.account_id
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=j.account_id
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=j.account_id and d.screening_id=p.screening_id
  where j.id=p_job and j.account_id=p_account and j.state in ('ready','issued')
  and j.operational_contact_id is null and j.callback_id is null and p.party='seller' and t.party='seller'
  and p.seller_intake_id is not null and t.seller_intake_id=p.seller_intake_id and t.recipient=p.phone
  and m.direction='incoming' and m.state='received' and m.created_at<=now()
  and j.sms_requested_at between now()-interval '5 minutes' and now()
  and ((j.sms_requested_by is null and m.created_at>=now()-interval '5 minutes')
   or (m.created_at>=now()-interval '24 hours' and exists(select 1 from public.icash_accounts a where a.id=j.account_id and a.owner_user_id=j.sms_requested_by)))
  and public.icash_seller_voice_permission_current(j.account_id,p.id)
  and public.icash_seller_sms_call_current(j.account_id,m.id)
 );
$$;
revoke all on function public.icash_requested_seller_call_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_requested_seller_call_current(uuid,uuid) to service_role;

do $$declare definition text;needle text;begin
 definition:=pg_get_functiondef('public.icash_claim_voice_job(uuid)'::regprocedure);
 needle:=$old$if h<greatest(9,p.local_start_hour) or h>=least(case when public.icash_seller_voice_permission_current(j.account_id,p.id) then 20 else 18 end,p.local_end_hour) then return false;end if;$old$;
 if position(needle in definition)=0 then raise exception 'Voice contact window prerequisite changed';end if;
 execute replace(definition,needle,$new$if (h<greatest(9,p.local_start_hour) or h>=least(case when public.icash_seller_voice_permission_current(j.account_id,p.id) then 20 else 18 end,p.local_end_hour)) and not public.icash_requested_seller_call_current(j.account_id,j.id) then return false;end if;$new$);
end $$;
commit;
