begin;
set local lock_timeout='3s';
create table public.icash_meta_lead_inbox(
 meta_id text primary key,source_id uuid not null references public.icash_meta_lead_sources(id),notice jsonb not null,
 state text not null default 'pending' check(state in ('pending','fetching','accepted','review')),
 attempts integer not null default 0,claim_token uuid,claimed_at timestamptz,next_attempt_at timestamptz not null default now(),
 reason text,lead_id uuid references public.icash_meta_leads(lead_id),created_at timestamptz not null default now()
);
alter table public.icash_meta_lead_inbox enable row level security;
revoke all on public.icash_meta_lead_inbox from public,anon,authenticated;
grant all on public.icash_meta_lead_inbox to service_role;
create function public.icash_meta_receive_notice(p_notice jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare src uuid;
begin
 select id into src from public.icash_meta_lead_sources where page_id=p_notice->>'page_id' and form_id=p_notice->>'form_id' and enabled and reviewed_until>now();
 if src is null then return false;end if;
 insert into public.icash_meta_lead_inbox(meta_id,source_id,notice) values(p_notice->>'leadgen_id',src,p_notice) on conflict do nothing;
 return true;
end $$;
create function public.icash_meta_claim_notice() returns jsonb language plpgsql security invoker set search_path='' as $$
declare row public.icash_meta_lead_inbox;token uuid:=gen_random_uuid();
begin
 select * into row from public.icash_meta_lead_inbox where (state='pending' or state='fetching' and claimed_at<now()-interval '2 minutes') and next_attempt_at<=now() and attempts<8
 order by next_attempt_at,created_at limit 1 for update skip locked;
 if not found then return null;end if;
 update public.icash_meta_lead_inbox set state='fetching',attempts=attempts+1,claim_token=token,claimed_at=now(),next_attempt_at=now()+interval '2 minutes' where meta_id=row.meta_id;
 return jsonb_build_object('metaId',row.meta_id,'sourceId',row.source_id,'notice',row.notice,'token',token);
end $$;

create function public.icash_meta_queue_message(p_lead uuid,p_purpose text,p_key text,p_body text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;t public.icash_text_threads;deal uuid;message uuid;
begin
 if p_purpose not in ('initial','address_link','reply','offer_ready') or length(p_key) not between 1 and 200 or length(p_body) not between 1 and 1000 then raise exception 'Invalid intake text';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 select * into l from public.icash_seller_intakes where id=p_lead;
 if m.lead_id is null or m.paused or m.declined_at is not null or not public.icash_outreach_sms_current(m.account_id) or not public.icash_membership_work_allowed(m.account_id)
  or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused)
  or not exists(select 1 from public.icash_wallets where account_id=m.account_id and balance_cents>0) then return null;end if;
 select mm.message_id into message from public.icash_meta_lead_messages mm where mm.lead_id=p_lead and mm.purpose=p_purpose and mm.evidence_key=p_key;
 if found then return message;end if;
 select id into deal from public.icash_deal_files where account_id=m.account_id and screening_id=m.screening_id and stage='draft';
 if deal is null then return null;end if;
 perform public.icash_prepare_seller_contacts(m.account_id,m.lead_id,m.screening_id,deal);
 select * into t from public.icash_text_threads where account_id=m.account_id and deal_id=deal and seller_intake_id=l.id and recipient=l.phone and party='seller' and not paused and not manual_only and ai_mode='auto';
 if t.id is null or not public.icash_seller_sms_permission_current(m.account_id,t.id,false) then return null;end if;
 -- Fixed purposes and a bounded conversational reply budget. No periodic blast.
 if p_purpose='reply' and (select count(*) from public.icash_meta_lead_messages mm where mm.lead_id=p_lead and mm.purpose='reply')>=6 then return null;end if;
 message:=public.icash_queue_text(m.account_id,t.id,gen_random_uuid(),p_body,'{}'::uuid[]);
 insert into public.icash_meta_lead_messages(message_id,lead_id,purpose,evidence_key) values(message,p_lead,p_purpose,p_key);
 return message;
end $$;

create function public.icash_meta_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare msg public.icash_text_messages;t public.icash_text_threads;m public.icash_meta_leads;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select ml.* into m from public.icash_meta_lead_messages mm join public.icash_meta_leads ml on ml.lead_id=mm.lead_id where mm.message_id=p_message and ml.account_id=p_account for share of ml;
 if not found then return null;end if;
 if not public.icash_sms_message_route_current(p_account,p_message) then return null;end if;
 select * into msg from public.icash_text_messages where id=p_message and account_id=p_account for update;
 if not found or msg.state<>'ready' or msg.direction<>'outgoing' or cardinality(msg.asset_ids)>0 or msg.attachments<>'[]'::jsonb then return null;end if;
 select * into t from public.icash_text_threads where id=msg.thread_id and account_id=p_account for update;
 if not found or t.seller_intake_id is distinct from m.lead_id or t.sender<>p_sender or not public.icash_seller_sms_permission_current(p_account,t.id,false) then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 if m.paused or m.declined_at is not null or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 h:=extract(hour from now() at time zone t.timezone);
 if (h<9 or h>=20) and not (m.call_now and m.submitted_at>now()-interval '5 minutes') and not public.icash_seller_sms_inquiry_window(p_account,t.id) then return null;end if;
 -- The normal reserve snapshots actual-cost pricing, membership, credits,
 -- explicit channel disables, billing reviews and uncertain-send protection.
 perform public.icash_reserve_operation(p_account,'text:'||msg.id,t.sms_rate_id,t.permission_until);
 if not public.icash_claim_operation('text:'||msg.id) then return null;end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=msg.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',msg.body,'attachments',msg.attachments);
end $$;

create function public.icash_meta_prepare_voice(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;p public.icash_contact_permissions;j public.icash_voice_jobs;deal uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 select * into l from public.icash_seller_intakes where id=p_lead;
 if m.lead_id is null or m.paused or m.voice_paused or m.declined_at is not null or not public.icash_outreach_voice_current(m.account_id)
  or not public.icash_membership_work_allowed(m.account_id) or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused)
  or not exists(select 1 from public.icash_wallets where account_id=m.account_id and balance_cents>0) then return null;end if;
 select id into deal from public.icash_deal_files where account_id=m.account_id and screening_id=m.screening_id and stage='draft';
 if deal is null then return null;end if;
 perform public.icash_prepare_seller_contacts(m.account_id,m.lead_id,m.screening_id,deal);
 select * into p from public.icash_contact_permissions where account_id=m.account_id and screening_id=m.screening_id and seller_intake_id=m.lead_id and phone=l.phone and revoked_at is null;
 if p.id is null or not public.icash_seller_voice_permission_current(m.account_id,p.id) then return null;end if;
 insert into public.icash_voice_jobs(account_id,permission_id) values(m.account_id,p.id) on conflict do nothing;
 select * into j from public.icash_voice_jobs where account_id=m.account_id and permission_id=p.id and callback_id is null and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null;
 if j.id is null then return null;end if;
 update public.icash_meta_leads set voice_job_id=coalesce(voice_job_id,j.id),next_attempt_at=now()+interval '1 minute' where lead_id=m.lead_id;
 if j.state<>'ready' or j.due_at>now() then return null;end if;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
 return jsonb_build_object('accountId',m.account_id,'voiceJobId',j.id);
end $$;

create function public.icash_meta_call_context(p_hash text,p_conversation text) returns jsonb
language sql security invoker set search_path='' as $$
 select jsonb_build_object('leadId',m.lead_id,'accountId',m.account_id,'screeningId',m.screening_id,'state',l.state,'metaId',m.meta_id,'submittedAt',m.submitted_at,'address',l.address,'complete',s.state='complete')
 from public.icash_call_recordings r join public.icash_meta_leads m on m.screening_id=r.screening_id and m.account_id=r.account_id
 join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
 where r.stop_token_hash=p_hash and r.conversation_id=p_conversation and r.party='seller' and r.to_phone=l.phone
 and r.call_ended_at is null and r.created_at>now()-interval '20 minutes' and r.state='recording' and r.recording_sid is not null
 and public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is not null;
$$;

create function public.icash_meta_observe_text() returns trigger language plpgsql security invoker set search_path='' as $$
declare lead uuid;body text:=lower(trim(new.body));
begin
 select m.lead_id into lead from public.icash_meta_leads m join public.icash_text_threads t on t.seller_intake_id=m.lead_id and t.account_id=m.account_id where t.id=new.thread_id and t.account_id=new.account_id;
 if lead is null then return new;end if;
 if new.direction='outgoing' and new.provider_id is not null and new.state in ('accepted','delivered') then
  update public.icash_meta_leads set first_outreach_at=coalesce(first_outreach_at,now()) where lead_id=lead;
 elsif new.direction='incoming' and new.state='received' then
  if body ~ '(don.t call|do not call|stop calling|text (me )?only|only text)' then
   update public.icash_meta_leads set voice_paused=true where lead_id=lead;
   update public.icash_voice_jobs j set state='held',outcome='seller_requested_text_only',updated_at=now() from public.icash_contact_permissions p where p.id=j.permission_id and p.seller_intake_id=lead and j.state in ('ready','issued') and j.provider_call_sid is null and j.conversation_id is null;
  end if;
  if body ~ '\m(stop|unsubscribe|wrong number|not interested|do not contact|don.t contact)\M' then
   update public.icash_meta_leads set declined_at=coalesce(declined_at,now()),paused=true where lead_id=lead;
  elsif body ~ '\m(human|real person|speak to someone|talk to someone)\M' then
   update public.icash_meta_leads set paused=true,response_at=coalesce(response_at,new.created_at),response_channel=coalesce(response_channel,'sms') where lead_id=lead;
   update public.icash_seller_intakes set hold_reason='Seller requested a person; automatic follow-up paused' where id=lead;
  elsif length(body)>=2 and body !~ '\m(automatic reply|auto.reply|delivery|voicemail|out of office)\M' then
   update public.icash_meta_leads set response_at=coalesce(response_at,new.created_at),response_channel=coalesce(response_channel,'sms') where lead_id=lead;
  end if;
 end if;
 return new;
end $$;
create trigger icash_meta_text_observation after insert or update of state,provider_id on public.icash_text_messages for each row execute function public.icash_meta_observe_text();

-- Contact-only messages belong to the address intake handler. Do not also
-- enqueue the existing property agent before a property is available.
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_enqueue_text_ai()'::regprocedure);
 needle:='if new.direction<>''incoming'' or new.account_id is null or new.thread_id is null then return new;end if;';
 if position(needle in def)=0 then raise exception 'SMS intake prerequisite changed';end if;
 execute replace(def,needle,needle||E'\n if exists(select 1 from public.icash_text_threads t join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id join public.icash_screening_jobs s on s.id=m.screening_id where t.id=new.thread_id and s.state=''awaiting_address'') then return new;end if;');
end $$;

do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
commit;
