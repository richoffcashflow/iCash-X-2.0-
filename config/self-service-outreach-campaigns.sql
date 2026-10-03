begin;
-- Customer-owned channel configuration only. No recipient consent, independent
-- identity verification, operator approval, account start, or spend is created.
create table public.icash_campaign_channel_selections(
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 user_id uuid not null references auth.users(id),
 acknowledgment_id uuid not null references public.icash_campaign_acknowledgments(id),
 mode text not null check(mode in ('outbound_voice_sms','sms_inbound')),
 sending_principal text not null check(length(trim(sending_principal)) between 1 and 200),
 source text not null default 'customer_ui' check(source='customer_ui'),
 selected_at timestamptz not null default clock_timestamp(),
 unique(account_id,user_id,acknowledgment_id,mode,sending_principal)
);
alter table public.icash_campaign_channel_selections enable row level security;
revoke all on public.icash_campaign_channel_selections from public,anon,authenticated,service_role;
grant select,insert on public.icash_campaign_channel_selections to service_role;
create trigger icash_campaign_channel_selection_immutable before update or delete on public.icash_campaign_channel_selections
 for each row execute function public.icash_authority_no_mutation();
create trigger icash_campaign_channel_selection_no_truncate before truncate on public.icash_campaign_channel_selections
 for each statement execute function public.icash_authority_no_mutation();
alter table public.icash_outreach_campaigns drop constraint icash_outreach_campaigns_mode_check;
alter table public.icash_outreach_campaigns add constraint icash_outreach_campaigns_mode_check check(mode in ('sms_inbound','outbound_voice_sms'));
alter table public.icash_outreach_campaigns add column channel_selection_id uuid references public.icash_campaign_channel_selections(id);
comment on column public.icash_outreach_campaigns.channel_selection_id is 'Actual authenticated customer channel choice, separately bound to the stored principal. Not independent identity review or recipient consent.';

create function public.icash_outreach_choice_current(p_account uuid,p_mode text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_outreach_campaigns c
 join public.icash_campaign_channel_selections s on s.id=c.channel_selection_id and s.account_id=c.account_id and s.mode=c.mode and s.acknowledgment_id=c.acknowledgment_id
 join public.icash_campaign_acknowledgments x on x.id=s.acknowledgment_id and x.account_id=s.account_id and x.user_id=s.user_id
 join public.icash_accounts a on a.id=s.account_id and a.owner_user_id=s.user_id
 join public.icash_customer_identities i on i.account_id=a.id and i.principal=s.sending_principal
 where c.account_id=p_account and c.enabled and c.mode=p_mode and s.source='customer_ui'
 and x.policy_version='outreach-channels-2026-10-03.1' and length(trim(i.principal))>0)
$$;
-- Preserve the genuine historical operator-reviewed SMS-only path. A new choice
-- never populates reviewed_principal or converts its old acknowledgment to voice.
create or replace function public.icash_sms_inbound_campaign_current(p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select public.icash_outreach_choice_current(p_account,'sms_inbound') or exists(
 select 1 from public.icash_outreach_campaigns c join public.icash_campaign_acknowledgments x on x.id=c.acknowledgment_id and x.account_id=c.account_id
 join public.icash_accounts a on a.id=c.account_id and a.owner_user_id=x.user_id
 where c.account_id=p_account and c.channel_selection_id is null and c.enabled and c.mode='sms_inbound' and x.policy_version='sms-inbound-2026-09-30.1'
 and exists(select 1 from public.icash_customer_identities i where i.account_id=c.account_id and length(trim(i.principal))>0 and i.principal=c.reviewed_principal))
$$;
create function public.icash_outreach_sms_current(p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select public.icash_sms_inbound_campaign_current(p_account) or public.icash_outreach_choice_current(p_account,'outbound_voice_sms')
$$;
create function public.icash_outreach_voice_current(p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select public.icash_outreach_choice_current(p_account,'outbound_voice_sms')
$$;

create or replace function public.icash_sms_inbound_campaign_status(p_account uuid,p_user uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_outreach_campaigns;x public.icash_campaign_acknowledgments;principal text;configured boolean;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 select * into c from public.icash_outreach_campaigns where account_id=p_account;
 select * into x from public.icash_campaign_acknowledgments where id=c.acknowledgment_id and account_id=p_account and user_id=p_user;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 configured:=x.id is not null;
 return jsonb_build_object('configured',configured,'released',public.icash_outreach_sms_current(p_account),'mode',c.mode,'principal',principal,
 'acknowledgment',case when x.id is not null then jsonb_build_object('version',x.policy_version,'acceptedAt',x.accepted_at) else null end);
end $$;
create function public.icash_record_outreach_campaign(p_account uuid,p_user uuid,p_mode text,p_version text,p_accepted boolean) returns jsonb language plpgsql security invoker set search_path='' as $$
declare acknowledgment uuid;selection uuid;principal text;
begin
 if p_accepted is distinct from true or p_version is distinct from 'outreach-channels-2026-10-03.1' or p_mode is null or p_mode not in ('outbound_voice_sms','sms_inbound') then raise exception 'Choose channels and confirm the current responsibilities';end if;
 -- Match dispatch lock order. A concurrent mode/principal change is serialized
 -- with the final provider claim; saving never changes the paused state.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account ownership required';end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account for share;
 if coalesce(length(trim(principal)),0) not between 1 and 200 then raise exception 'Stored sending business required';end if;
 insert into public.icash_campaign_acknowledgments(account_id,user_id,policy_version,policy_text)
 values(p_account,p_user,p_version,'I choose the channels shown above for my account’s outreach. I am responsible for lawful use of leads and for required contact permissions, opt-outs, documents, and investment decisions. The platform does not independently verify recipient consent or legal suitability. Data and do-not-call results are not recipient consent. This selection does not start my bot, change my spending limit, or authorize offers, contracts, or property marketing. Existing provider, do-not-call, timing, and budget checks still apply.')
 on conflict(account_id,user_id,policy_version) do nothing;
 select id into acknowledgment from public.icash_campaign_acknowledgments where account_id=p_account and user_id=p_user and policy_version=p_version;
 insert into public.icash_campaign_channel_selections(account_id,user_id,acknowledgment_id,mode,sending_principal)
 values(p_account,p_user,acknowledgment,p_mode,principal) on conflict(account_id,user_id,acknowledgment_id,mode,sending_principal) do nothing;
 select id into selection from public.icash_campaign_channel_selections where account_id=p_account and user_id=p_user and acknowledgment_id=acknowledgment and mode=p_mode and sending_principal=principal;
 insert into public.icash_outreach_campaigns(account_id,mode,acknowledgment_id,channel_selection_id,enabled)
 values(p_account,p_mode,acknowledgment,selection,true)
 on conflict(account_id) do update set mode=excluded.mode,acknowledgment_id=excluded.acknowledgment_id,channel_selection_id=excluded.channel_selection_id,enabled=true,updated_at=clock_timestamp();
 return public.icash_sms_inbound_campaign_status(p_account,p_user);
end $$;

-- Only bounded SMS callers gain the SMS-capable predicate. The invitation
-- implementation and inbound route predicate retain SMS-inbound-only meaning.
do $sms$
declare signature text;definition text;needle text:='public.icash_sms_inbound_campaign_current(';
begin
 foreach signature in array array[
 'public.icash_claim_text_before_owner_question(uuid,uuid,text)',
 'public.icash_enqueue_text_ai()',
 'public.icash_next_before_operational_sms()',
 'public.icash_next_before_owner_question()',
 'public.icash_next_before_unstarted_sms_recovery()',
 'public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)',
 'public.icash_project_operational_sms_contacts(uuid)',
 'public.icash_queue_seller_opener(uuid,uuid)',
 'public.icash_sms_thread_review_current(uuid,uuid,boolean)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'SMS campaign predicate changed: %',signature;end if;
  execute replace(definition,needle,'public.icash_outreach_sms_current(');
 end loop;
end $sms$;
-- Old invitation messages cannot be claimed after choosing outbound mode.
do $invitations$
declare definition text;needle text:=' if found then';
begin
 definition:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Invitation claim boundary changed';end if;
 execute replace(definition,needle,needle||E'\n  if not public.icash_sms_inbound_campaign_current(p_account) then return null;end if;');
end $invitations$;

-- Filter both legacy and operational queue candidates before they reserve/spend.
do $voice_queue$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure);
 needle:='where p.revoked_at is null';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Legacy seller queue boundary changed';end if;
 definition:=replace(definition,needle,'where public.icash_outreach_voice_current(p.account_id) and p.revoked_at is null');
 needle:='where p.party=''buyer''';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Legacy buyer queue boundary changed';end if;
 definition:=replace(definition,needle,'where public.icash_outreach_voice_current(p.account_id) and p.party=''buyer''');
 needle:='where c.state=''complete''';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Legacy callback queue boundary changed';end if;
 definition:=replace(definition,needle,'where public.icash_outreach_voice_current(b.account_id) and c.state=''complete''');execute definition;
 definition:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
 needle:='where op.channel=';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Operational seller queue boundary changed';end if;
 definition:=replace(definition,needle,'where public.icash_outreach_voice_current(op.account_id) and op.channel=');
 needle:='where call.party=''seller''';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Operational callback queue boundary changed';end if;
 definition:=replace(definition,needle,'where public.icash_outreach_voice_current(cb.account_id) and call.party=''seller''');execute definition;
end $voice_queue$;

-- Source-defined wrapper preserves every existing final claim, snapshot, budget,
-- DNC, STOP, hours, buyer/offer, and recording check; failed post-check rolls back.
alter function public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb) rename to icash_claim_reviewed_voice_before_channel_choice;
create function public.icash_claim_reviewed_voice_job(p_job uuid,p_offer_snapshot jsonb default null,p_buyer_snapshot jsonb default null) returns boolean language plpgsql security invoker set search_path='' as $$
declare account uuid;allowed boolean;
begin
 select account_id into account from public.icash_voice_jobs where id=p_job;
 if account is null or not public.icash_outreach_voice_current(account) then return false;end if;
 begin
  allowed:=public.icash_claim_reviewed_voice_before_channel_choice(p_job,p_offer_snapshot,p_buyer_snapshot);
  if not allowed then return false;end if;
  if not public.icash_outreach_voice_current(account) then raise exception using errcode='P0C02',message='Channel choice changed during voice claim';end if;
  return true;
 exception when sqlstate 'P0C02' then return false;
 end;
end $$;
revoke all on function public.icash_outreach_choice_current(uuid,text),public.icash_outreach_sms_current(uuid),public.icash_outreach_voice_current(uuid),
 public.icash_record_outreach_campaign(uuid,uuid,text,text,boolean),public.icash_claim_reviewed_voice_before_channel_choice(uuid,jsonb,jsonb),public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_outreach_choice_current(uuid,text),public.icash_outreach_sms_current(uuid),public.icash_outreach_voice_current(uuid),
 public.icash_record_outreach_campaign(uuid,uuid,text,text,boolean),public.icash_claim_reviewed_voice_before_channel_choice(uuid,jsonb,jsonb),public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb) to service_role;
commit;
