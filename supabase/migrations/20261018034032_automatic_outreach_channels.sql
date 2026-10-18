begin;
set local lock_timeout='5s';
-- Owner instruction 2026-10-17: calling and texting are automatic for all
-- current and future accounts. Campaign acknowledgment/selection is no longer
-- a prerequisite. Existing explicit channel disables and SMS-only choices stay
-- effective; Run/Pause, paid work, provider configuration and recipient evidence
-- remain enforced by their existing admission functions.
-- No customer acknowledgment, recipient permission, charge or call is invented.
create or replace function public.icash_outreach_sms_current(p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_accounts a
  join public.icash_customer_identities i on i.account_id=a.id
  where a.id=p_account and nullif(trim(i.principal),'') is not null
  and not exists(select 1 from public.icash_outreach_campaigns c
   where c.account_id=a.id and not c.enabled)
 );
$$;

create or replace function public.icash_outreach_voice_current(p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select public.icash_outreach_sms_current(p_account)
  and not exists(select 1 from public.icash_outreach_campaigns c
   where c.account_id=p_account and c.mode='sms_inbound');
$$;

create or replace function public.icash_sms_inbound_campaign_status(p_account uuid,p_user uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_outreach_campaigns;x public.icash_campaign_acknowledgments;principal text;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user)
  then raise exception 'Account ownership required';end if;
 select * into c from public.icash_outreach_campaigns where account_id=p_account;
 select * into x from public.icash_campaign_acknowledgments
  where id=c.acknowledgment_id and account_id=p_account and user_id=p_user;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 return jsonb_build_object('automatic',true,'configured',nullif(trim(principal),'') is not null,
  'released',public.icash_outreach_sms_current(p_account),
  'mode',coalesce(c.mode,'outbound_voice_sms'),'principal',principal,
  'acknowledgment',case when x.id is not null then jsonb_build_object('version',x.policy_version,'acceptedAt',x.accepted_at) else null end);
end $$;

revoke all on function public.icash_outreach_sms_current(uuid),public.icash_outreach_voice_current(uuid),public.icash_sms_inbound_campaign_status(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_outreach_sms_current(uuid),public.icash_outreach_voice_current(uuid),public.icash_sms_inbound_campaign_status(uuid,uuid) to service_role;
comment on function public.icash_outreach_sms_current(uuid) is 'Automatic channel configuration for current and future accounts; no campaign setup. Actual contact, spend, provider and Run/Pause admission is separate.';
comment on function public.icash_outreach_voice_current(uuid) is 'Automatic seller-call configuration without a campaign prerequisite; preserves explicit SMS-only choice. Buyer outbound calls remain disabled downstream.';
commit;
