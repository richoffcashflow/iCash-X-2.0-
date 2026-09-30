begin;
-- No source permissions, sender/route, rates, provider credentials or live flag are seeded.
create table public.icash_campaign_acknowledgments(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 user_id uuid not null references auth.users(id),policy_version text not null,policy_text text not null,
 accepted_at timestamptz not null default now(),unique(account_id,user_id,policy_version)
);
create table public.icash_outreach_campaigns(
 account_id uuid primary key references public.icash_accounts(id),mode text not null check(mode='sms_inbound'),
 acknowledgment_id uuid not null references public.icash_campaign_acknowledgments(id),reviewed_principal text,enabled boolean not null default false,updated_at timestamptz not null default now()
);
create table public.icash_sms_inbound_invitations(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 thread_id uuid not null unique references public.icash_text_threads(id),deal_id uuid not null references public.icash_deal_files(id),screening_id uuid not null references public.icash_screening_jobs(id),
 opener_id uuid not null references public.icash_text_messages(id),reply_id uuid not null unique references public.icash_text_messages(id),
 message_id uuid not null unique references public.icash_text_messages(id),called_number text not null references public.icash_inbound_voice_routes(called_number),
 sender text not null,recipient text not null,created_at timestamptz not null default now(),expires_at timestamptz not null check(expires_at>created_at)
);
alter table public.icash_inbound_voice_routes add column agent_config_hash text check(agent_config_hash ~ '^[a-f0-9]{64}$');
alter table public.icash_inbound_voice_receipts add column invitation_id uuid references public.icash_sms_inbound_invitations(id);
-- Existing routes are preserved. The new SMS-inbound path separately requires this hash.
alter table public.icash_campaign_acknowledgments enable row level security;
alter table public.icash_outreach_campaigns enable row level security;
alter table public.icash_sms_inbound_invitations enable row level security;
revoke all on public.icash_campaign_acknowledgments,public.icash_outreach_campaigns,public.icash_sms_inbound_invitations from public,anon,authenticated;
grant select,insert on public.icash_campaign_acknowledgments,public.icash_sms_inbound_invitations to service_role;
grant select,insert,update on public.icash_outreach_campaigns to service_role;
create trigger icash_campaign_acknowledgment_immutable before update or delete on public.icash_campaign_acknowledgments for each row execute function public.icash_authority_no_mutation();
create trigger icash_sms_invitation_immutable before update or delete on public.icash_sms_inbound_invitations for each row execute function public.icash_authority_no_mutation();
create function public.icash_sms_inbound_campaign_current(p_account uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_outreach_campaigns c join public.icash_campaign_acknowledgments x on x.id=c.acknowledgment_id and x.account_id=c.account_id join public.icash_accounts a on a.id=c.account_id and a.owner_user_id=x.user_id where c.account_id=p_account and c.enabled and c.mode='sms_inbound' and x.policy_version='sms-inbound-2026-09-30.1' and exists(select 1 from public.icash_customer_identities i where i.account_id=c.account_id and length(trim(i.principal))>0 and i.principal=c.reviewed_principal));
$$;
create function public.icash_sms_inbound_campaign_status(p_account uuid,p_user uuid) returns jsonb language plpgsql set search_path='' as $$
declare x public.icash_campaign_acknowledgments;configured boolean;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 configured:=exists(select 1 from public.icash_outreach_campaigns c join public.icash_campaign_acknowledgments a on a.id=c.acknowledgment_id and a.account_id=c.account_id where c.account_id=p_account and a.user_id=p_user and c.mode='sms_inbound' and a.policy_version='sms-inbound-2026-09-30.1');
 if configured then select a.* into x from public.icash_campaign_acknowledgments a join public.icash_outreach_campaigns c on c.acknowledgment_id=a.id where c.account_id=p_account;end if;
 return jsonb_build_object('configured',configured,'released',public.icash_sms_inbound_campaign_current(p_account),'acknowledgment',case when x.id is not null then jsonb_build_object('version',x.policy_version,'acceptedAt',x.accepted_at) else null end);
end $$;
create function public.icash_record_sms_inbound_campaign(p_account uuid,p_user uuid,p_version text,p_accepted boolean) returns jsonb language plpgsql set search_path='' as $$
declare x uuid;
begin
 if p_accepted is distinct from true or p_version is distinct from 'sms-inbound-2026-09-30.1' then raise exception 'Current explicit acknowledgment required';end if;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;if not found then raise exception 'Account ownership required';end if;
 insert into public.icash_campaign_acknowledgments(account_id,user_id,policy_version,policy_text) values(p_account,p_user,p_version,'I am responsible for using lawful, permitted SMS contact sources with prior contact and required permission for the actual sending business, and for complying with applicable consent, do-not-call, calling-time, state and provider rules. The platform must honor STOP and other opt-outs. An interested recipient may be invited to call our AI assistant. This acknowledgment is not recipient consent or legal clearance, and it does not authorize outbound AI calls, offers or contracts. Missing required evidence or provider setup keeps outreach paused.') on conflict(account_id,user_id,policy_version) do nothing;
 select id into x from public.icash_campaign_acknowledgments where account_id=p_account and user_id=p_user and policy_version=p_version;
 insert into public.icash_outreach_campaigns(account_id,mode,acknowledgment_id,enabled) values(p_account,'sms_inbound',x,false) on conflict(account_id) do update set mode='sms_inbound',acknowledgment_id=excluded.acknowledgment_id,enabled=case when public.icash_outreach_campaigns.acknowledgment_id=excluded.acknowledgment_id then public.icash_outreach_campaigns.enabled else false end,updated_at=now();
 return public.icash_sms_inbound_campaign_status(p_account,p_user);
end $$;
-- Reply classification is deliberately bounded. No model output can authorize an invitation.
create function public.icash_prepare_sms_inbound_reply(p_account uuid,p_thread uuid,p_reply uuid) returns uuid language plpgsql set search_path='' as $$
declare t public.icash_text_threads;m public.icash_text_messages;opener public.icash_text_messages;d public.icash_deal_files;r public.icash_inbound_voice_routes;outgoing uuid;expiry timestamptz;body text;positive boolean;
begin
 if not public.icash_sms_inbound_campaign_current(p_account) then return null;end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account for update;
 if not found or t.party<>'seller' or t.paused or t.ai_mode<>'auto' then return null;end if;
 select * into m from public.icash_text_messages where id=p_reply and thread_id=t.id and account_id=p_account and direction='incoming' and state='received';if not found then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 if exists(select 1 from public.icash_sms_inbound_invitations where thread_id=t.id) then return null;end if;
 select msg.* into opener from public.icash_seller_opener_assignments a join public.icash_text_messages msg on msg.id=a.message_id and msg.account_id=a.account_id and msg.thread_id=a.thread_id where a.thread_id=t.id and a.account_id=p_account and msg.state in ('accepted','delivered') and msg.provider_id is not null and not a.opted_out;
 positive:=lower(trim(m.body)) ~ '^(yes|yeah|yep|sure|yes please|i am interested|i''m interested|interested|yes i am interested|yes i''m interested)[.! ]*$';
 if opener.id is null or m.created_at<opener.created_at or exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.id not in (m.id,opener.id) and x.created_at>opener.created_at) then positive:=false;end if;
 if not positive then
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis) values(p_account,t.id,m.id,'needs_review',jsonb_build_object('summary','SMS-first campaign: no unambiguous positive response to the recorded opener. No invitation sent.','action','review','sourceMessageId',m.id)) on conflict(message_id) do nothing;
 return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';if not found or d.screening_id is null then return null;end if;
 -- A shared sender must map to exactly one reviewed inbound number.
 if (select count(*) from public.icash_inbound_voice_routes where business_number=t.sender and enabled and reviewed_until>now() and agent_config_hash is not null)<>1 then return null;end if;
 select * into r from public.icash_inbound_voice_routes where business_number=t.sender and enabled and reviewed_until>now() and agent_config_hash is not null;
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) or not exists(select 1 from public.icash_customer_identities where account_id=p_account and length(trim(principal))>0) then return null;end if;
 if t.permission_until is null or t.permission_until<=now() or length(coalesce(t.permission_evidence,''))<10 or not t.dnc_clear or t.dnc_checked_at is null or t.dnc_checked_at>now() or t.dnc_checked_at<now()-interval '30 days' then return null;end if;
 expiry:=least(t.permission_until,r.reviewed_until,now()+interval '7 days');
 body:='Call '||substring(r.called_number from 2)||' to discuss a possible cash offer for your property with our AI assistant. Reply STOP to opt out.';
 outgoing:=public.icash_queue_text(p_account,t.id,m.id,body,'{}');
 insert into public.icash_sms_inbound_invitations(account_id,thread_id,deal_id,screening_id,opener_id,reply_id,message_id,called_number,sender,recipient,expires_at) values(p_account,t.id,d.id,d.screening_id,opener.id,m.id,outgoing,r.called_number,t.sender,t.recipient,expiry);
 return outgoing;
end $$;
-- Keep ordinary AI handling intact for other modes; this campaign never turns a positive
-- response into permission for an outbound AI call or a free-form model-authored SMS.
do $$declare definition text;needle text:=' if new.direction<>''incoming'' or new.account_id is null or new.thread_id is null then return new;end if;';begin
 definition:=pg_get_functiondef('public.icash_enqueue_text_ai()'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'SMS enqueue implementation changed';end if;
 execute replace(definition,needle,needle||E'\n update public.icash_text_ai_jobs set state=''superseded'',updated_at=now() where thread_id=new.thread_id and state in (''pending'',''issued'',''drafted''); if public.icash_sms_inbound_campaign_current(new.account_id) then perform public.icash_prepare_sms_inbound_reply(new.account_id,new.thread_id,new.id);return new;end if;');
end $$;
alter function public.icash_queue_seller_opener(uuid,uuid) rename to icash_queue_seller_opener_before_campaign;
create function public.icash_queue_seller_opener(p_account uuid,p_thread uuid) returns uuid language plpgsql set search_path='' as $$
declare choice jsonb;message_body text;
begin
 if not public.icash_sms_inbound_campaign_current(p_account) then return null;end if;
 perform 1 from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto' and permission_until>now() for update;
 if not found or exists(select 1 from public.icash_text_messages where thread_id=p_thread) then return null;end if;
 choice:=public.icash_assign_seller_opener(p_account,p_thread);if choice is null then return null;end if;
 message_body:='I am the AI assistant for this property inquiry. '||replace(choice->>'body','cash offer','all cash offer')||' Reply STOP to opt out.';
 update public.icash_seller_opener_assignments set body=message_body where thread_id=p_thread and account_id=p_account and message_id is null;
 return public.icash_queue_text(p_account,p_thread,p_thread,message_body,'{}');
end $$;
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_campaign;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
declare invitation public.icash_sms_inbound_invitations;t public.icash_text_threads;m public.icash_text_messages;d public.icash_deal_files;s public.icash_screening_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select th.* into t from public.icash_text_threads th join public.icash_text_messages msg on msg.thread_id=th.id and msg.account_id=th.account_id where msg.id=p_message and msg.account_id=p_account;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 perform 1 from public.icash_outreach_campaigns where account_id=p_account for share;
 select * into t from public.icash_text_threads where id=t.id and account_id=p_account for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=t.id for update;
 if not found or m.state<>'ready' or m.direction<>'outgoing' then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete' for share;
 if not found or s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours' then return null;end if;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual) then return null;end if;
 if exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account) then return null;end if;
 if t.dnc_checked_at>now() then return null;end if;
 if not public.icash_sms_inbound_campaign_current(p_account) then return null;end if;
 select * into invitation from public.icash_sms_inbound_invitations where message_id=p_message and account_id=p_account;
 if found then
  select * into t from public.icash_text_threads where id=invitation.thread_id and account_id=p_account;
  if t.id is null or t.sender<>invitation.sender or t.recipient<>invitation.recipient or t.deal_id<>invitation.deal_id or invitation.expires_at<=now() then return null;end if;
  if not exists(select 1 from public.icash_inbound_voice_routes where called_number=invitation.called_number and business_number=p_sender and enabled and reviewed_until>now() and agent_config_hash is not null) then return null;end if;
  if exists(select 1 from public.icash_text_messages where thread_id=t.id and direction='incoming' and id<>invitation.reply_id and created_at>=(select created_at from public.icash_text_messages where id=invitation.reply_id)) then return null;end if;
 end if;
 return public.icash_claim_text_before_campaign(p_account,p_message,p_sender);
end $$;
-- SMS-inbound mode blocks all outbound AI voice, including pre-existing callbacks.
alter function public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb) rename to icash_claim_reviewed_voice_before_campaign;
create function public.icash_claim_reviewed_voice_job(p_job uuid,p_offer_snapshot jsonb default null,p_buyer_snapshot jsonb default null) returns boolean language plpgsql set search_path='' as $$
declare allowed boolean;
begin
 if exists(select 1 from public.icash_voice_jobs j join public.icash_outreach_campaigns c on c.account_id=j.account_id where j.id=p_job and c.mode='sms_inbound') then return false;end if;
 begin
  allowed:=public.icash_claim_reviewed_voice_before_campaign(p_job,p_offer_snapshot,p_buyer_snapshot);
  if not allowed then return false;end if;
  -- The legacy successful claim holds the account row. Campaign selection takes
  -- the same row, so a concurrently committed selection is checked atomically.
  if exists(select 1 from public.icash_voice_jobs j join public.icash_outreach_campaigns c on c.account_id=j.account_id where j.id=p_job and c.mode='sms_inbound') then raise exception using errcode='P0C01',message='Campaign changed during voice claim';end if;
  return true;
 exception when sqlstate 'P0C01' then return false; -- Subtransaction restores the prior claim.
 end;
end $$;
-- Reuse existing worker capability and text dispatch; no new external job type.
alter function public.icash_next_automation() rename to icash_next_before_sms_inbound_campaign;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_text_threads;m uuid;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 if exists(select 1 from public.icash_operating_budget where id=1 and enabled) and not exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '1 minute') then
 select th.* into t from public.icash_text_threads th join public.icash_accounts a on a.id=th.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true' join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now() join pg_timezone_names tz on tz.name=th.timezone
 where public.icash_sms_inbound_campaign_current(th.account_id) and not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual) and th.party='seller' and not th.paused and th.ai_mode='auto' and th.permission_until>now() and extract(hour from now() at time zone tz.name) between 9 and 19 and not exists(select 1 from public.icash_text_suppressions s where s.phone=th.recipient)
 and (not exists(select 1 from public.icash_text_messages where thread_id=th.id) or exists(select 1 from public.icash_sms_inbound_invitations i join public.icash_text_messages msg on msg.id=i.message_id and msg.state='ready' where i.thread_id=th.id and i.expires_at>now() and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id))) order by th.id for update of th skip locked limit 1;
 if found then
  select i.message_id into m from public.icash_sms_inbound_invitations i join public.icash_text_messages msg on msg.id=i.message_id and msg.state='ready' where i.thread_id=t.id and i.expires_at>now();
  if m is null then m:=public.icash_queue_seller_opener(t.account_id,t.id);end if;
  if m is not null then insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(t.account_id,'seller_opener',m) returning * into ticket;return jsonb_build_object('token',ticket.token);end if;
 end if;end if;
 return public.icash_next_before_sms_inbound_campaign();
end $$;
-- Incoming caller identification is a routing hint only. Never expose stored deal facts.
alter function public.icash_begin_inbound_voice(text,text,text,text,text,text,text,text) rename to icash_begin_inbound_before_invitations;
create function public.icash_begin_inbound_voice(p_caller text,p_called text,p_agent text,p_call_sid text,p_conversation text,p_binding_hash text,p_token_hash text,p_agent_hash text)
returns jsonb language plpgsql set search_path='' as $$
declare route public.icash_inbound_voice_routes;receipt public.icash_inbound_voice_receipts;i public.icash_sms_inbound_invitations;t public.icash_text_threads;rate public.icash_operation_rates;choices jsonb;call_id uuid;op text;contact text;
begin
 if p_caller is null or p_caller !~ '^\+1[2-9][0-9]{9}$' or p_called is null or p_called !~ '^\+1[2-9][0-9]{9}$' or p_agent is null or p_agent !~ '^agent_[A-Za-z0-9]+$' or p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$' or p_conversation is null or p_conversation !~ '^conv_[A-Za-z0-9]+$' or p_binding_hash is null or p_binding_hash !~ '^[a-f0-9]{64}$' or p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' or p_agent_hash is null or p_agent_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into receipt from public.icash_inbound_voice_receipts where call_sid=p_call_sid;
 if found and receipt.invitation_id is null then return public.icash_begin_inbound_before_invitations(p_caller,p_called,p_agent,p_call_sid,p_conversation,p_binding_hash,p_token_hash,p_agent_hash);end if;
 select * into route from public.icash_inbound_voice_routes where called_number=p_called and enabled and agent_id=p_agent and reviewed_until>now() and agent_config_hash=p_agent_hash for share;
 if not found then return null;end if;
 -- Count all previously accepted open-deal bindings BEFORE filtering pauses/expiry.
 select jsonb_agg(to_jsonb(x)) into choices from (
  select distinct v.account_id,v.screening_id from public.icash_sms_inbound_invitations v join public.icash_text_messages m on m.id=v.message_id and m.account_id=v.account_id and m.thread_id=v.thread_id and m.state in ('accepted','delivered') and m.provider_id is not null join public.icash_deal_files d on d.id=v.deal_id and d.account_id=v.account_id and d.screening_id=v.screening_id
  where v.recipient=p_caller and v.called_number=p_called and v.sender=route.business_number and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true' limit 2
 ) x;
 if coalesce(jsonb_array_length(choices),0)<>1 then return null;end if;
 select v.* into i from public.icash_sms_inbound_invitations v join public.icash_text_messages m on m.id=v.message_id and m.account_id=v.account_id and m.thread_id=v.thread_id and m.state in ('accepted','delivered') and m.provider_id is not null where v.account_id=(choices->0->>'account_id')::uuid and v.screening_id=(choices->0->>'screening_id')::uuid and v.recipient=p_caller and v.called_number=p_called and v.sender=route.business_number and v.expires_at>now() limit 1 for share of v;
 if not found then return null;end if;
 contact:=encode(sha256(convert_to(p_caller,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_caller,74));perform pg_advisory_xact_lock(hashtextextended(contact,17));
 perform 1 from public.icash_accounts where id=i.account_id and not bot_paused for update;if not found then return null;end if;
 perform 1 from public.icash_outreach_campaigns where account_id=i.account_id for share;
 if not public.icash_sms_inbound_campaign_current(i.account_id) then return null;end if;
 perform 1 from public.icash_deal_files where id=i.deal_id and account_id=i.account_id and screening_id=i.screening_id and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;if not found then return null;end if;
 select * into t from public.icash_text_threads where id=i.thread_id and account_id=i.account_id and deal_id=i.deal_id and sender=i.sender and recipient=i.recipient and party='seller' and not paused for share;if not found then return null;end if;
 if not exists(select 1 from public.icash_customer_identities where account_id=i.account_id and length(trim(principal))>0) then return null;end if;
 if exists(select 1 from public.icash_contact_suppressions where contact_key=contact) or exists(select 1 from public.icash_text_suppressions where phone=p_caller) then return null;end if;
 if exists(select 1 from public.icash_property_controls c join public.icash_screening_jobs s on s.snapshot->>'propertyId'=c.property_id and s.account_id=c.account_id where s.id=i.screening_id and s.account_id=i.account_id and c.manual) then return null;end if;
 if exists(select 1 from public.icash_voice_test_config where agent_id=p_agent) or exists(select 1 from public.icash_voice_test_sessions where conversation_id=p_conversation) then return null;end if;
 if receipt.call_sid is not null then
  if receipt.binding_hash<>p_binding_hash or receipt.conversation_id<>p_conversation or receipt.invitation_id<>i.id or not exists(select 1 from public.icash_live_conversations where id=receipt.live_call_id and account_id=i.account_id and screening_id=i.screening_id and state='waiting' and tool_token_hash=p_token_hash and tool_expires_at>now()) then return null;end if;
  return jsonb_build_object('maxSeconds',receipt.max_duration_seconds);
 end if;
 if exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=i.account_id or contact_key=contact)) then return null;end if;
 if exists(select 1 from public.icash_voice_jobs j join public.icash_contact_permissions cp on cp.id=j.permission_id where (j.account_id=i.account_id or cp.contact_key=contact) and (j.state='dispatching' or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))) then return null;end if;
 select * into rate from public.icash_operation_rates where id=route.rate_id and operation='incoming_call' and enabled and verified_at<=now() and expires_at>now() and voice_max_duration_seconds>=route.max_duration_seconds for share;
 if not found then return null;end if;
 op:='inbound:'||p_call_sid;
 perform public.icash_reserve_operation(i.account_id,op,rate.id,least(i.expires_at,route.reviewed_until));
 if not public.icash_claim_operation(op) then raise exception 'Incoming call spend not authorized';end if;
 insert into public.icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,tool_token_hash,tool_expires_at) values(i.account_id,i.screening_id,'seller',p_agent,p_conversation,op,contact,'cash_interest',p_token_hash,now()+(route.max_duration_seconds+120)*interval '1 second') returning id into call_id;
 insert into public.icash_inbound_voice_receipts(call_sid,conversation_id,binding_hash,live_call_id,max_duration_seconds,invitation_id) values(p_call_sid,p_conversation,p_binding_hash,call_id,route.max_duration_seconds,i.id);
 return jsonb_build_object('maxSeconds',route.max_duration_seconds);
end $$;
revoke all on function public.icash_sms_inbound_campaign_current(uuid),public.icash_sms_inbound_campaign_status(uuid,uuid),public.icash_record_sms_inbound_campaign(uuid,uuid,text,boolean),public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid),public.icash_queue_seller_opener(uuid,uuid),public.icash_queue_seller_opener_before_campaign(uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_campaign(uuid,uuid,text),public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb),public.icash_claim_reviewed_voice_before_campaign(uuid,jsonb,jsonb),public.icash_next_automation(),public.icash_next_before_sms_inbound_campaign(),public.icash_begin_inbound_voice(text,text,text,text,text,text,text,text),public.icash_begin_inbound_before_invitations(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_sms_inbound_campaign_current(uuid),public.icash_sms_inbound_campaign_status(uuid,uuid),public.icash_record_sms_inbound_campaign(uuid,uuid,text,boolean),public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid),public.icash_queue_seller_opener(uuid,uuid),public.icash_queue_seller_opener_before_campaign(uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_campaign(uuid,uuid,text),public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb),public.icash_claim_reviewed_voice_before_campaign(uuid,jsonb,jsonb),public.icash_next_automation(),public.icash_next_before_sms_inbound_campaign(),public.icash_begin_inbound_voice(text,text,text,text,text,text,text,text),public.icash_begin_inbound_before_invitations(text,text,text,text,text,text,text,text) to service_role;

-- Selecting this mode cannot leave old model-driven qualification jobs eligible.
alter function public.icash_claim_text_ai(uuid,uuid) rename to icash_claim_text_ai_before_campaign;
create function public.icash_claim_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql set search_path='' as $$
begin if exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound') then return null;end if;return public.icash_claim_text_ai_before_campaign(p_account,p_job);end $$;
alter function public.icash_queue_ai_reply(uuid,uuid,text) rename to icash_queue_ai_reply_before_campaign;
create function public.icash_queue_ai_reply(p_account uuid,p_job uuid,p_reply text) returns uuid language plpgsql set search_path='' as $$
begin if exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound') then return null;end if;return public.icash_queue_ai_reply_before_campaign(p_account,p_job,p_reply);end $$;
revoke all on function public.icash_claim_text_ai(uuid,uuid),public.icash_claim_text_ai_before_campaign(uuid,uuid),public.icash_queue_ai_reply(uuid,uuid,text),public.icash_queue_ai_reply_before_campaign(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_text_ai(uuid,uuid),public.icash_claim_text_ai_before_campaign(uuid,uuid),public.icash_queue_ai_reply(uuid,uuid,text),public.icash_queue_ai_reply_before_campaign(uuid,uuid,text) to service_role;
commit;
