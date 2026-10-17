begin;
-- Match equivalent checkout phone formatting without changing the saved consent recipient.
create or replace function public.icash_purchase_text_contact(p_membership uuid,p_visitor uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_memberships m join public.icash_webinar_visitors v on v.id=p_visitor
 cross join lateral (select regexp_replace(coalesce(m.payer_phone,''),'[ ()-]','','g') value) number
 where m.id=p_membership and v.phone ~ '^\+[1-9][0-9]{7,14}$'
 and (v.funding_guest_hash=m.guest_hash or v.account_id=m.account_id)
 and (v.email is null or lower(trim(v.email))=lower(trim(m.payer_email)))
 and (number.value='' or v.phone=case when number.value ~ '^[0-9]{10}$' then '+1'||number.value when number.value ~ '^1[0-9]{10}$' then '+'||number.value else number.value end)
 and v.sms_consent_at is not null and v.sms_opted_out_at is null
 and v.sms_consent_version in ('webinar-sms-campaign-2026-10-08','webinar-sms-ongoing-2026-10-09','webinar-sms-bounded-2026-10-17','webinar-sms-recovery-2026-10-17')
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=v.phone)
 and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=v.phone));
$$;
revoke all on function public.icash_purchase_text_contact(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_purchase_text_contact(uuid,uuid) to service_role;
commit;
