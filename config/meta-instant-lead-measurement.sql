begin;
alter table public.icash_meta_leads add column offer_authorized_at timestamptz, add column offer_conversation_id text;
alter table public.icash_voice_jobs add column meta_offer_lead_id uuid unique references public.icash_meta_leads(lead_id);
drop index public.icash_voice_first_once;
create unique index icash_voice_first_once on public.icash_voice_jobs(permission_id) where callback_id is null and sms_source_message_id is null and cancellation_notice_id is null and meta_offer_lead_id is null;
create function public.icash_meta_offer_followup(p_lead uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;p public.icash_contact_permissions;j public.icash_voice_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_meta_leads where lead_id=p_lead for update;
 if not found or m.offer_ready_at is null or m.offer_authorized_at is not null or m.paused or m.voice_paused or m.declined_at is not null
 or not public.icash_outreach_voice_current(m.account_id) or not public.icash_membership_work_allowed(m.account_id)
 or not exists(select 1 from public.icash_accounts where id=m.account_id and not bot_paused)
 or not exists(select 1 from public.icash_wallets where account_id=m.account_id and balance_cents>0) then return null;end if;
 select * into p from public.icash_contact_permissions where account_id=m.account_id and seller_intake_id=m.lead_id and screening_id=m.screening_id and revoked_at is null;
 if p.id is null or not public.icash_seller_voice_permission_current(m.account_id,p.id) then return null;end if;
 -- Continue the present call. An accepted/uncertain call is never redialled.
 if exists(select 1 from public.icash_voice_jobs where permission_id=p.id and state in ('ready','issued','dispatching'))
 or exists(select 1 from public.icash_call_recordings where permission_id=p.id and call_ended_at is null)
 or exists(select 1 from public.icash_live_conversations where account_id=m.account_id and screening_id=m.screening_id and state in ('waiting','review'))
 or exists(select 1 from public.icash_voice_jobs where permission_id=p.id and state='held' and outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) then return null;end if;
 insert into public.icash_voice_jobs(account_id,permission_id,meta_offer_lead_id) values(m.account_id,p.id,m.lead_id) on conflict do nothing;
 select * into j from public.icash_voice_jobs where meta_offer_lead_id=m.lead_id and account_id=m.account_id;
 if j.state<>'ready' or j.due_at>now() then return null;end if;
 update public.icash_voice_jobs set state='issued',updated_at=now() where id=j.id;
 return jsonb_build_object('accountId',m.account_id,'voiceJobId',j.id);
end $$;
create function public.icash_meta_note_offer_authorized(p_hash text,p_conversation text,p_price bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare scope jsonb;
begin
 scope:=public.icash_meta_call_context(p_hash,p_conversation);
 if scope is null or scope->>'complete'<>'true' or p_price<=0 then return;end if;
 -- The server records this only after the ordinary offer tool returns an
 -- authorized quote. It stops an unnecessary second call, never grants a price.
 update public.icash_meta_leads set offer_authorized_at=coalesce(offer_authorized_at,now()),offer_conversation_id=p_conversation where lead_id=(scope->>'leadId')::uuid and account_id=(scope->>'accountId')::uuid;
end $$;
create function public.icash_meta_observe_call() returns trigger language plpgsql security invoker set search_path='' as $$
declare lead uuid;
begin
 select m.lead_id into lead from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 where m.account_id=new.account_id and m.screening_id=new.screening_id and new.party='seller' and new.contact_key=encode(sha256(convert_to(l.phone,'UTF8')),'hex');
 if lead is null then return new;end if;
 if new.state='complete' and new.completed_at is not null and public.icash_seller_human_answer(new.result->'transcript') then
  if new.result->>'optedOut'='true' or new.result->>'interested'='false' then
   update public.icash_meta_leads set declined_at=coalesce(declined_at,new.completed_at),paused=true where lead_id=lead;
  else
   update public.icash_meta_leads set response_at=coalesce(response_at,new.completed_at),response_channel=coalesce(response_channel,'call') where lead_id=lead;
  end if;
 end if;
 return new;
end $$;
create trigger icash_meta_call_observation after insert or update of state,result on public.icash_live_conversations for each row execute function public.icash_meta_observe_call();
create function public.icash_meta_observe_dial() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.call_sid is not null then update public.icash_meta_leads set first_outreach_at=coalesce(first_outreach_at,now()) where account_id=new.account_id and screening_id=new.screening_id;end if;
 return new;
end $$;
create trigger icash_meta_dial_observation after update of call_sid on public.icash_call_recordings for each row execute function public.icash_meta_observe_dial();

create table public.icash_meta_lead_events(
 id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.icash_meta_leads(lead_id),
 stage text not null check(stage in ('InstantFormReceived','SellerResponded','PropertyAddressConfirmed','CashOfferReady')),
 occurred_at timestamptz not null,delivered_at timestamptz,claim_token uuid,claimed_at timestamptz,attempts integer not null default 0,
 state text not null default 'pending' check(state in ('pending','sending','delivered','review')),unique(lead_id,stage)
);
alter table public.icash_meta_lead_events enable row level security;
revoke all on public.icash_meta_lead_events from public,anon,authenticated;
grant all on public.icash_meta_lead_events to service_role;
create function public.icash_meta_capture_stage() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP='INSERT' then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'InstantFormReceived',greatest(now(),new.submitted_at+interval '1 second')) on conflict do nothing;end if;
 if new.response_at is not null then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'SellerResponded',new.response_at) on conflict do nothing;end if;
 if new.address_confirmed_at is not null then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'PropertyAddressConfirmed',new.address_confirmed_at) on conflict do nothing;end if;
 if new.offer_ready_at is not null then insert into public.icash_meta_lead_events(lead_id,stage,occurred_at) values(new.lead_id,'CashOfferReady',new.offer_ready_at) on conflict do nothing;end if;
 return new;
end $$;
create trigger icash_meta_stage_capture after insert or update of response_at,address_confirmed_at,offer_ready_at on public.icash_meta_leads for each row execute function public.icash_meta_capture_stage();
create function public.icash_meta_claim_event() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_meta_lead_events;m public.icash_meta_leads;token uuid:=gen_random_uuid();
begin
 update public.icash_meta_lead_events set state='review' where state in ('pending','sending') and (occurred_at<now()-interval '7 days' or attempts>=5 and claimed_at<now()-interval '2 minutes');
 select * into e from public.icash_meta_lead_events where (state='pending' or state='sending' and claimed_at<now()-interval '2 minutes') and occurred_at<=now()
 and (claimed_at is null or claimed_at<now()-interval '2 minutes') order by occurred_at limit 1 for update skip locked;
 if not found then return null;end if;
 select * into m from public.icash_meta_leads where lead_id=e.lead_id;
 update public.icash_meta_lead_events set state='sending',claim_token=token,claimed_at=now(),attempts=attempts+1 where id=e.id;
 return jsonb_build_object('id',e.id,'token',token,'leadId',m.meta_id,'name',e.stage,'occurredAt',e.occurred_at);
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'icash_meta_%'
 loop execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);end loop;
end $$;
commit;
