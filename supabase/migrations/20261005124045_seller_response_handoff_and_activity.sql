begin;
-- A delivery of a paid lead must also produce a durable response handoff.
-- This is work tracking, NOT a contact permission or approval record.
create table public.icash_seller_responses (
 lead_id uuid not null,account_id uuid not null,screening_id uuid not null unique references public.icash_screening_jobs(id),
 state text not null default 'pending' check(state in ('pending','needs_setup','queued','contact_started','stopped')),
 detail text not null default 'Preparing seller response',outcome jsonb not null default '{}',
 next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 primary key(lead_id,account_id),foreign key(lead_id,account_id) references public.icash_seller_matches(lead_id,account_id)
);
create index icash_seller_response_due on public.icash_seller_responses(next_attempt_at) where state in ('pending','needs_setup','queued');
alter table public.icash_seller_responses enable row level security;
revoke all on public.icash_seller_responses from public,anon,authenticated;
grant select,insert,update on public.icash_seller_responses to service_role;
create function public.icash_track_seller_response() returns trigger language plpgsql set search_path='' as $$
begin
 insert into public.icash_seller_responses(lead_id,account_id,screening_id) values(new.lead_id,new.account_id,new.screening_id) on conflict do nothing;
 return new;
end $$;
create trigger icash_seller_response_created after insert on public.icash_seller_matches for each row execute function public.icash_track_seller_response();
insert into public.icash_seller_responses(lead_id,account_id,screening_id) select lead_id,account_id,screening_id from public.icash_seller_matches on conflict do nothing;

create function public.icash_prepare_seller_responses(p_lead uuid default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.icash_seller_responses;l public.icash_seller_intakes;a public.icash_accounts;d public.icash_deal_files;
 th public.icash_text_threads;job public.icash_voice_jobs;message uuid;principal text;result jsonb:='[]';response_detail text;sms_started boolean;voice_started boolean;
begin
 -- Same lock order as spending/Stop; per-response locks exclude another tick.
 perform 1 from public.icash_operating_budget where id=1 for update;
 for r in select * from public.icash_seller_responses where state in ('pending','needs_setup','queued')
  and (p_lead is null or lead_id=p_lead) and next_attempt_at<=now() order by next_attempt_at,created_at limit 1 for update skip locked
 loop
  message:=null;job:=null;th:=null;response_detail:='Contact setup required';sms_started:=false;voice_started:=false;
  select * into l from public.icash_seller_intakes where id=r.lead_id;
  select * into a from public.icash_accounts where id=r.account_id for update;
  if a.bot_paused then
   update public.icash_seller_responses set detail='Bot is stopped',next_attempt_at=now()+interval '1 minute',updated_at=now() where lead_id=r.lead_id and account_id=r.account_id;
   continue;
  end if;
  if exists(select 1 from public.icash_text_suppressions where phone=l.phone)
   or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex'))
   or exists(select 1 from public.icash_seller_matches m join public.icash_deal_files f on f.account_id=m.account_id and f.screening_id=m.screening_id join public.icash_signing_envelopes e on e.account_id=f.account_id and e.deal_id=f.id and e.kind='purchase' and not e.test_mode and e.state='completed' where m.lead_id=r.lead_id)
   or exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.id=r.screening_id and s.account_id=r.account_id where pc.account_id=r.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   or exists(select 1 from public.icash_handoffs h where h.account_id=r.account_id and h.screening_id=r.screening_id and h.state<>'resolved') then
   update public.icash_seller_responses set state='stopped',detail='Contact stopped or under human control',updated_at=now() where lead_id=r.lead_id and account_id=r.account_id;
   continue;
  end if;
  select i.principal into principal from public.icash_customer_identities i where i.account_id=r.account_id;
  if nullif(trim(principal),'') is null then response_detail:='Save the buying principal';
  else
   -- Preserve all existing negotiated terms. Form names are statements, not
   -- verified ownership, agreement, or a legal seller/signing identity.
   insert into public.icash_deal_files(account_id,screening_id,terms)
   values(r.account_id,r.screening_id,jsonb_build_object('address',l.property->>'address','state',l.property->>'state','buyer',principal,'seller','','priceCents',null,'priceSource','proposed'))
   on conflict(account_id,screening_id) do nothing;
   select * into d from public.icash_deal_files where account_id=r.account_id and screening_id=r.screening_id;
   if d.stage<>'draft' then response_detail:='Existing deal controls the next step';
   else
    -- Only existing, independently admitted channels can proceed. Never turn
    -- the intake checkbox into a manufactured DNC or market-review receipt.
    select * into th from public.icash_text_threads where account_id=r.account_id and deal_id=d.id and recipient=l.phone and party='seller' and not paused and ai_mode='auto' order by id limit 1;
    if th.id is not null then
     begin
      message:=public.icash_queue_seller_opener(r.account_id,th.id);
      if message is null then select m.id into message from public.icash_seller_opener_assignments o join public.icash_text_messages m on m.id=o.message_id and m.account_id=o.account_id where o.thread_id=th.id and o.account_id=r.account_id and m.state='ready';end if;
     exception when others then response_detail:='Text preparation requires review';end;
     sms_started:=exists(select 1 from public.icash_text_messages where account_id=r.account_id and thread_id=th.id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null);
    end if;
    -- Insert only against a real, unrevoked permission. All provider, budget,
    -- hour, DNC, freshness and recording checks still run at final dispatch.
    insert into public.icash_voice_jobs(account_id,permission_id)
    select r.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled
    where p.account_id=r.account_id and p.screening_id=r.screening_id and p.party='seller' and p.phone=l.phone and p.revoked_at is null and p.permission_until>now()
    and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null) on conflict do nothing;
    select v.* into job from public.icash_voice_jobs v join public.icash_contact_permissions p on p.id=v.permission_id and p.account_id=v.account_id
    where v.account_id=r.account_id and p.screening_id=r.screening_id and p.phone=l.phone and v.callback_id is null and v.state='ready' and v.due_at<=now() order by v.created_at limit 1 for update of v skip locked;
    if job.id is not null then update public.icash_voice_jobs set state='issued',updated_at=now() where id=job.id;end if;
    voice_started:=exists(select 1 from public.icash_voice_jobs v join public.icash_contact_permissions p on p.id=v.permission_id where p.account_id=r.account_id and p.screening_id=r.screening_id and p.phone=l.phone and v.state='dispatched' and v.provider_call_sid is not null);
   end if;
  end if;
  update public.icash_seller_responses set state=case when sms_started and voice_started then 'contact_started' when message is not null or job.id is not null then 'queued' else 'needs_setup' end,
   detail=case when sms_started and voice_started then 'Text accepted and call started' when message is not null or job.id is not null then 'Response ready for final provider checks' when sms_started then 'First call needs setup or review' when voice_started then 'First text needs setup or review' else response_detail end,
   next_attempt_at=now()+interval '1 minute',updated_at=now() where lead_id=r.lead_id and account_id=r.account_id;
  result:=result||jsonb_build_array(jsonb_build_object('leadId',r.lead_id,'accountId',r.account_id,'screeningId',r.screening_id,'smsMessageId',message,'voiceJobId',job.id,'status',case when message is not null or job.id is not null then 'queued' else response_detail end));
 end loop;
 return result;
end $$;
create function public.icash_note_seller_response(p_lead uuid,p_account uuid,p_outcome jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
 if jsonb_typeof(p_outcome)<>'object' or length(p_outcome::text)>1000 or p_outcome-array['sms','voice']<>'{}'::jsonb then raise exception 'Invalid response outcome';end if;
 update public.icash_seller_responses set outcome=outcome||p_outcome,updated_at=now(),
  detail='Check the recorded channel outcomes',state='queued' where lead_id=p_lead and account_id=p_account and state<>'stopped';
end $$;

-- An inbound request should not wait for a speculative cold-outreach budget
-- time slot. This removes ONLY pacing, not quiet hours or any spending gate.
do $$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure);
 needle:=$n$ if p.party='seller' and j.callback_id is null and exists(select 1 from public.icash_daytime_pacing_settings where id=1 and enabled)$n$;
 if position(needle in def)=0 then raise exception 'Voice pacing definition changed';end if;
 execute replace(def,needle,needle||$n$
 and not exists(select 1 from public.icash_seller_matches m join public.icash_seller_intakes i on i.id=m.lead_id where m.account_id=p_account and m.screening_id=p.screening_id and i.phone=p.phone and i.ai_consented and i.created_at between now()-interval '15 minutes' and now())$n$);
end $$;

alter function public.icash_customer_update_sources(uuid) rename to icash_customer_update_sources_before_seller_journey;
create function public.icash_customer_update_sources(p_account uuid)
returns table(source_key text,kind text,screening_id uuid,event_at timestamptz,priority integer)
language sql stable security invoker set search_path='' as $$
 with events as (
 select * from public.icash_customer_update_sources_before_seller_journey(p_account)
 union all select 'lead:'||m.lead_id,'lead_assigned',m.screening_id,m.assigned_at,2 from public.icash_seller_matches m where m.account_id=p_account
 union all select 'response:'||r.lead_id,'response_held',r.screening_id,r.created_at,0 from public.icash_seller_responses r where r.account_id=p_account and r.state='needs_setup'
 union all select 'buyer-reply:'||m.id,'buyer_reply',d.screening_id,m.created_at,2 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id where m.account_id=p_account and t.party='buyer' and m.direction='incoming' and m.state='received'
 union all select 'call:'||c.id,'call_complete',c.screening_id,c.completed_at,2 from public.icash_live_conversations c where c.account_id=p_account and c.state='complete' and c.operation_key like 'voice:%'
 union all select 'showing:'||s.id||':'||s.state,'showing_update',d.screening_id,coalesce(s.seller_confirmed_at,s.buyer_confirmed_at,s.created_at),1 from public.icash_showing_requests s join public.icash_deal_files d on d.id=s.deal_id where d.account_id=p_account and s.state in ('proposed','confirmed','cancelled')
 union all select 'title-reply:'||r.id,'title_reply',d.screening_id,r.received_at,1 from public.icash_title_replies r join public.icash_deal_files d on d.id=r.deal_id and d.account_id=r.account_id where r.account_id=p_account and r.sender_verified
 union all select 'buyer-email:'||e.id,'buyer_package',d.screening_id,e.updated_at,3 from public.icash_deal_emails e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id where e.account_id=p_account and e.direction='outgoing' and e.state='accepted' and e.provider_id is not null and e.contact_key like 'buyer-request:%' and e.subject like 'Requested buyer package:%'
 ) select e.* from events e join public.icash_screening_jobs s on s.id=e.screening_id and s.account_id=p_account
 where e.event_at>now()-interval '14 days' and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.result->'property'->>'propertyId','') not like 'practice_%'
 and not exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=s.id and coalesce(d.terms->>'practice','false')='true')
 order by e.event_at desc,e.source_key limit 50;
$$;
create function public.icash_seller_call_request(p_account uuid,p_screening uuid,p_phone text) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('name',i.name,'submittedAt',i.created_at) from public.icash_seller_matches m join public.icash_seller_intakes i on i.id=m.lead_id
 where m.account_id=p_account and m.screening_id=p_screening and i.phone=p_phone and i.ai_consented and i.state<>'duplicate';
$$;
revoke all on function public.icash_seller_call_request(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_call_request(uuid,uuid,text) to service_role;
create function public.icash_seller_response_readiness()
returns table(processing_enabled boolean,allowance_available boolean,markets bigint,active_accounts bigint,senders bigint,voice_accounts bigint,pending_responses bigint,held_responses bigint,started_responses bigint)
language sql stable security invoker set search_path='' as $$
 select coalesce(c.enabled and c.data_rights_until>now(),false),c.lookup_allowance_micros>c.lookup_used_micros+c.lookup_reserved_micros,
 (select count(*) from public.icash_seller_markets where enabled and reviewed_until>now()),
 (select count(distinct p.account_id) from public.icash_daily_plans p join public.icash_accounts a on a.id=p.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents where p.mode='live' and p.state='active'),
 (select count(*) from public.icash_text_senders where enabled),
 (select count(*) from public.icash_voice_configs where enabled and reviewed_until>now()),
 (select count(*) from public.icash_seller_responses where state in ('pending','queued')),
 (select count(*) from public.icash_seller_responses where state='needs_setup'),
 (select count(*) from public.icash_seller_responses where state='contact_started')
 from public.icash_seller_controls c where c.id=1;
$$;
revoke all on function public.icash_seller_response_readiness() from public,anon,authenticated;
grant execute on function public.icash_seller_response_readiness() to service_role;
revoke all on function public.icash_track_seller_response(),public.icash_prepare_seller_responses(uuid),public.icash_note_seller_response(uuid,uuid,jsonb),public.icash_customer_update_sources(uuid),public.icash_customer_update_sources_before_seller_journey(uuid) from public,anon,authenticated;
grant execute on function public.icash_track_seller_response(),public.icash_prepare_seller_responses(uuid),public.icash_note_seller_response(uuid,uuid,jsonb),public.icash_customer_update_sources(uuid),public.icash_customer_update_sources_before_seller_journey(uuid) to service_role;
commit;
