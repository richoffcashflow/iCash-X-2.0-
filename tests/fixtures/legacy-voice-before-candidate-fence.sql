CREATE OR REPLACE FUNCTION public.icash_queue_voice_jobs_before_operational()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into public.icash_voice_jobs(account_id,permission_id)
 select p.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled join public.icash_accounts a on a.id=p.account_id and not a.bot_paused join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id and s.state='complete'
 where public.icash_outreach_voice_current(p.account_id) and p.revoked_at is null and p.permission_until>now() and (p.dnc_clear or public.icash_seller_voice_permission_current(p.account_id,p.id)) and (s.result->'financialCheck'->>'status'='eligible' or public.icash_seller_limited_contact(p.account_id,p.screening_id)) and p.party='seller' and not exists(select 1 from public.icash_voice_jobs prior join public.icash_operational_contacts oc on oc.id=prior.operational_contact_id where prior.account_id=p.account_id and oc.account_id=p.account_id and oc.screening_id=p.screening_id and oc.contact_key=p.contact_key and prior.callback_id is null)
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null) limit 100
 on conflict do nothing;
 -- Buyers receive outbound SMS/email only. Inbound buyer calls remain available.
 insert into public.icash_voice_jobs(account_id,permission_id,callback_id,due_at)
 select b.account_id,p.id,b.id,b.due_at from public.icash_live_callbacks b join public.icash_live_conversations c on c.id=b.conversation_id join public.icash_contact_permissions p on p.account_id=b.account_id and p.screening_id=b.screening_id and p.contact_key=c.contact_key and p.party=c.party
 where public.icash_outreach_voice_current(b.account_id) and c.party='seller' and c.state='complete' and (c.result->>'callbackDueAt')::timestamptz=b.due_at and b.state='pending_dispatch_review' and b.due_at>now()-interval '15 minutes' and p.revoked_at is null and p.permission_until>b.due_at and not exists(select 1 from public.icash_voice_jobs v where v.callback_id=b.id) limit 100 on conflict do nothing;
 update public.icash_voice_jobs set state='held',outcome='Callback time passed; review required' where state='ready' and callback_id is not null and due_at<now()-interval '15 minutes';
 update public.icash_live_callbacks b set state='missed' where state='pending_dispatch_review' and due_at<now()-interval '15 minutes';
 -- An expired one-use ticket may be issued again only before provider dispatch was claimed.
 update public.icash_voice_jobs set state='ready' where state='issued' and updated_at<now()-interval '5 minutes';
end $function$
