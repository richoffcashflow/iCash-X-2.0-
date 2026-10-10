begin;
set local lock_timeout='3s';

-- Capabilities are private to a single existing buyer/seller thread. Public
-- readers below return an explicit allowlist, never the underlying deal terms.
create table public.icash_deal_journeys (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id), screening_id uuid not null references public.icash_screening_jobs(id),
 request_id uuid not null references public.icash_buyer_viewing_requests(id), thread_id uuid not null references public.icash_text_threads(id),
 buyer_token text not null unique default replace(gen_random_uuid()::text,'-',''),
 seller_token text not null unique default replace(gen_random_uuid()::text,'-',''), seller_thread_id uuid references public.icash_text_threads(id),
 expires_at timestamptz not null default now()+interval '14 days',
 wants_assignment boolean not null default false, wants_viewing boolean not null default false,
 state text not null default 'collecting' check(state in ('collecting','ready','sending','signing','deposit_due','reserved','needs_review','closed')),
 buyer_details jsonb, envelope_id uuid references public.icash_signing_envelopes(id), deposit_due_at timestamptz, deposit_deadline_note text,
 review_reason text, next_run_at timestamptz not null default now(), last_progress_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(account_id,deal_id,thread_id)
);
create index icash_journey_due on public.icash_deal_journeys(next_run_at,id) where state<>'closed';
create index icash_journey_screen on public.icash_deal_journeys(account_id,screening_id);
create index icash_journey_request on public.icash_deal_journeys(request_id);
create index icash_journey_buyer_thread on public.icash_deal_journeys(thread_id);
create index icash_journey_seller_thread on public.icash_deal_journeys(seller_thread_id);
create index icash_journey_envelope on public.icash_deal_journeys(envelope_id);
create table public.icash_journey_messages (
 id uuid primary key default gen_random_uuid(), journey_id uuid not null references public.icash_deal_journeys(id),
 account_id uuid not null references public.icash_accounts(id), thread_id uuid not null references public.icash_text_threads(id),
 event_key text not null, body text not null, message_id uuid references public.icash_text_messages(id),
 showing_id uuid references public.icash_showing_requests(id), showing_version integer,
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 state text not null default 'ready' check(state in ('ready','sent','needs_review','cancelled')),
 created_at timestamptz not null default now(), unique(journey_id,event_key)
);
create index icash_journey_message_due on public.icash_journey_messages(next_attempt_at,id) where state='ready';
create index icash_journey_message_account on public.icash_journey_messages(account_id,created_at desc);
create index icash_journey_message_thread on public.icash_journey_messages(thread_id);
create index icash_journey_message_showing on public.icash_journey_messages(showing_id);
create index icash_journey_message_receipt on public.icash_journey_messages(message_id);
create table public.icash_closing_profiles (
 account_id uuid primary key references public.icash_accounts(id), payout jsonb, title_proposal jsonb,
 updated_at timestamptz not null default now()
);
alter table public.icash_deal_journeys enable row level security;
alter table public.icash_journey_messages enable row level security;
alter table public.icash_closing_profiles enable row level security;
revoke all on public.icash_deal_journeys,public.icash_journey_messages,public.icash_closing_profiles from public,anon,authenticated;
grant select,insert,update on public.icash_deal_journeys,public.icash_journey_messages,public.icash_closing_profiles to service_role;

-- Readiness is checked before scheduling AND immediately before sending.
create function public.icash_journey_allowed(p_account uuid,p_deal uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_deal_files d join public.icash_accounts a on a.id=d.account_id
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=a.id
 where d.id=p_deal and a.id=p_account and not a.bot_paused and s.state='complete'
 and d.stage in ('under_contract','buyer_selected','title_open','closing') and coalesce(d.terms->>'practice','false')='false'
 and not public.icash_buyer_outreach_held(p_account,p_deal)
 and not exists(select 1 from public.icash_property_controls c where c.account_id=a.id and c.property_id=s.snapshot->>'propertyId' and c.manual)
 and not exists(select 1 from public.icash_handoffs h where h.account_id=a.id and h.screening_id=s.id and h.state<>'resolved')
 and exists(select 1 from public.icash_signing_envelopes e where e.account_id=a.id and e.deal_id=d.id and e.kind='purchase' and e.state='completed' and not e.test_mode and public.icash_signing_action_allowed(a.id,e.id)))
$$;

create function public.icash_seed_deal_journey() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.state<>'needs_confirmation' or new.kind not in ('reservation','viewing','payment_reported') then return new;end if;
 if not exists(select 1 from public.icash_text_threads t where t.id=new.thread_id and t.account_id=new.account_id and t.deal_id=new.deal_id and t.party='buyer' and t.retired_at is null) then return new;end if;
 insert into public.icash_deal_journeys(account_id,deal_id,screening_id,request_id,thread_id,wants_assignment,wants_viewing,state,review_reason)
 values(new.account_id,new.deal_id,new.screening_id,new.id,new.thread_id,new.kind in ('reservation','payment_reported'),new.kind='viewing' or new.viewing_quote is not null,case when new.kind='payment_reported' then 'needs_review' else 'collecting' end,case when new.kind='payment_reported' then 'Buyer reports payment. Verify the signed assignment and cleared receipt.' end)
 on conflict(account_id,deal_id,thread_id) do update set wants_assignment=icash_deal_journeys.wants_assignment or excluded.wants_assignment,
 wants_viewing=icash_deal_journeys.wants_viewing or excluded.wants_viewing,next_run_at=least(icash_deal_journeys.next_run_at,now());
 return new;
end $$;
-- No historical requests are replayed into live outbound work.
create trigger zz_turnkey_buyer_request after insert or update of kind,viewing_quote on public.icash_buyer_viewing_requests for each row execute function public.icash_seed_deal_journey();

create function public.icash_journey_message(p_journey uuid,p_thread uuid,p_event text,p_body text,p_showing uuid default null,p_version integer default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.icash_journey_messages(journey_id,account_id,thread_id,event_key,body,showing_id,showing_version)
 select j.id,j.account_id,t.id,p_event,p_body,p_showing,p_version from public.icash_deal_journeys j
 join public.icash_text_threads t on t.id=p_thread and t.account_id=j.account_id and t.deal_id=j.deal_id and t.retired_at is null
 where j.id=p_journey and public.icash_sms_single_segment(p_body) on conflict(journey_id,event_key) do nothing;
end $$;

create function public.icash_journey_current(p_id uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_deal_journeys j where j.id=p_id and j.state<>'closed' and j.expires_at>now()
 and public.icash_journey_allowed(j.account_id,j.deal_id)
 and exists(select 1 from public.icash_text_threads t where t.id=j.thread_id and t.account_id=j.account_id and t.deal_id=j.deal_id and t.retired_at is null and not exists(select 1 from public.icash_text_suppressions where phone=t.recipient))
 and (not exists(select 1 from public.icash_buyer_deposit_receipts where account_id=j.account_id and deal_id=j.deal_id)
  or exists(select 1 from public.icash_buyer_deposit_receipts where account_id=j.account_id and deal_id=j.deal_id and envelope_id=j.envelope_id)))
$$;

create function public.icash_journey_message_current(p_id uuid) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare m public.icash_journey_messages;j public.icash_deal_journeys;s public.icash_showing_requests;slots jsonb;
begin
 select * into m from public.icash_journey_messages where id=p_id;select * into j from public.icash_deal_journeys where id=m.journey_id;
 if not found or not public.icash_journey_current(j.id) then return false;end if;
 if m.showing_id is not null then
  select * into s from public.icash_showing_requests where id=m.showing_id and deal_id=j.deal_id and buyer_request_id=j.request_id and version=m.showing_version;
  if not found then return false;end if;
  if m.event_key like 'cancelled_%' then return s.state='cancelled';end if;
  if s.starts_at<=now() then return false;end if;
  if m.event_key like 'confirm_seller:%' then return s.state='proposed' and s.seller_confirmed_at is null;end if;
  if m.event_key like 'confirm_buyer:%' then return s.state='proposed' and s.buyer_confirmed_at is null;end if;
  return s.state='confirmed';
 end if;
 if m.event_key='deposit_due' then return j.state='deposit_due' and not exists(select 1 from public.icash_buyer_deposit_receipts where account_id=j.account_id and deal_id=j.deal_id);end if;
 if m.event_key in ('buyer_intake','buyer_reminder_1','buyer_reminder_2') then
  return j.state='collecting' and (j.wants_assignment or not exists(select 1 from public.icash_showing_requests where buyer_request_id=j.request_id and state in ('proposed','confirmed','completed')));
 end if;
 if exists(select 1 from public.icash_showing_requests where buyer_request_id=j.request_id and state in ('proposed','confirmed','completed')) then return false;end if;
 slots:=public.icash_current_viewing_slots(j.account_id,j.deal_id);
 if m.event_key='seller_times' then return j.wants_viewing and jsonb_array_length(slots)=0;end if;
 if m.event_key like 'viewing_options:%' then return j.wants_viewing and m.event_key='viewing_options:'||encode(sha256(convert_to(slots::text,'UTF8')),'hex');end if;
 return false;
end $$;

-- Shared preferences are copied only into missing fields; verification and
-- "details shared" are always deal-specific and are never inherited.
alter function public.icash_save_closing_setup(uuid,uuid,uuid,text,jsonb) rename to icash_save_closing_setup_before_profile;
create function public.icash_save_closing_setup(p_account uuid,p_actor uuid,p_deal uuid,p_action text,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r jsonb;p public.icash_closing_profiles;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 if p_action='use_profile' then
  select * into p from public.icash_closing_profiles where account_id=p_account;
  if p.payout is not null and not exists(select 1 from public.icash_closing_setup where account_id=p_account and deal_id=p_deal and payout is not null) then
   perform public.icash_save_closing_setup_before_profile(p_account,p_actor,p_deal,'payout',p.payout||'{"detailsSharedWithTitle":false}');end if;
  if p.title_proposal is not null and not exists(select 1 from public.icash_closing_setup where account_id=p_account and deal_id=p_deal and title_proposal is not null)
   and not exists(select 1 from public.icash_title_contacts where account_id=p_account and deal_id=p_deal and enabled)
   and not exists(select 1 from public.icash_deal_files where id=p_deal and nullif(btrim(terms->>'titleEmail'),'') is not null) then
   perform public.icash_save_closing_setup_before_profile(p_account,p_actor,p_deal,'title_preference',p.title_proposal);end if;
  return jsonb_build_object('saved',true);
 end if;
 r:=public.icash_save_closing_setup_before_profile(p_account,p_actor,p_deal,p_action,p_data);
 if p_action='payout' then
  insert into public.icash_closing_profiles(account_id,payout) values(p_account,p_data||'{"detailsSharedWithTitle":false}')
  on conflict(account_id) do update set payout=excluded.payout,updated_at=now();
 elsif p_action='confirm_title' then
  insert into public.icash_closing_profiles(account_id,title_proposal) select p_account,title_proposal from public.icash_closing_setup where deal_id=p_deal and account_id=p_account
  on conflict(account_id) do update set title_proposal=excluded.title_proposal,updated_at=now();
 end if;
 return r;
end $$;
create function public.icash_inherit_closing_profile() returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.icash_closing_profiles;
begin
 select * into p from public.icash_closing_profiles where account_id=new.account_id;
 if new.payout is null then new.payout:=p.payout||'{"detailsSharedWithTitle":false}';end if;
 if new.title_proposal is null and not exists(select 1 from public.icash_deal_files where id=new.deal_id and nullif(btrim(terms->>'titleEmail'),'') is not null) then new.title_proposal:=p.title_proposal;end if;
 return new;
end $$;
create trigger inherit_closing_profile before insert on public.icash_closing_setup for each row execute function public.icash_inherit_closing_profile();

alter table public.icash_handoffs add column assigned_to text;
alter table public.icash_handoffs add column due_at timestamptz not null default now()+interval '2 hours';
alter table public.icash_handoffs add column resolution text;
alter table public.icash_handoffs add column updated_at timestamptz not null default now();
alter table public.icash_handoffs alter column assigned_to set default 'Account owner';
alter table public.icash_handoffs alter column conversation_id drop not null;
alter table public.icash_handoffs add column closing_setup_id uuid references public.icash_closing_setup(id);
alter table public.icash_handoffs add column text_attention_id uuid references public.icash_text_attention(id);
alter table public.icash_handoffs add constraint icash_handoff_one_source check(num_nonnulls(conversation_id,closing_setup_id,text_attention_id)=1);
create unique index icash_handoff_closing_source on public.icash_handoffs(closing_setup_id) where closing_setup_id is not null;
create unique index icash_handoff_text_source on public.icash_handoffs(text_attention_id) where text_attention_id is not null;
create function public.icash_track_closing_handoff() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.review_reason='setup' then return new;end if;
 if tg_op='UPDATE' and new.review_reason=old.review_reason and new.reply_id is not distinct from old.reply_id and new.buyer_request_id is not distinct from old.buyer_request_id then return new;end if;
 insert into public.icash_handoffs(account_id,screening_id,party,reason,summary,next_action,closing_setup_id)
 values(new.account_id,new.screening_id,'buyer',case new.review_reason when 'human_requested' then 'A buyer asked for a person' when 'payment_change' then 'Payment details changed' when 'title_declined' then 'Title cannot handle the file' else 'A closing issue needs a person' end,
 'Review the saved buyer request or title reply in Buyers & closing.','Contact the parties, resolve the issue and record the outcome.',new.id)
 on conflict(closing_setup_id) where closing_setup_id is not null do update set state='open',reason=excluded.reason,resolution=null,resolved_at=null,due_at=now()+interval '2 hours',updated_at=now();
 return new;
end $$;
create trigger track_closing_handoff after insert or update of review_reason,reply_id,buyer_request_id on public.icash_closing_setup for each row execute function public.icash_track_closing_handoff();
create function public.icash_track_text_handoff() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.kind<>'human' or new.state<>'open' or new.screening_id is null then return new;end if;
 insert into public.icash_handoffs(account_id,screening_id,party,reason,summary,next_action,text_attention_id)
 values(new.account_id,new.screening_id,new.party,'A person was requested',left(new.quote,6000),'Reply to the person and record how their request was resolved.',new.id)
 on conflict(text_attention_id) where text_attention_id is not null do update set state='open',summary=excluded.summary,resolution=null,resolved_at=null,due_at=now()+interval '2 hours',updated_at=now();
 return new;
end $$;
create trigger track_text_handoff after insert or update of message_id,state on public.icash_text_attention for each row execute function public.icash_track_text_handoff();
create function public.icash_manage_handoff(p_account uuid,p_actor uuid,p_id uuid,p_action text,p_assignee text default null,p_due timestamptz default null,p_resolution text default null,p_resume boolean default false) returns void
language plpgsql security invoker set search_path='' as $$
declare h public.icash_handoffs;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 select * into strict h from public.icash_handoffs where id=p_id and account_id=p_account for update;
 if h.state='resolved' then return;end if;
 if p_action='assign' then
  if length(btrim(coalesce(p_assignee,''))) not between 2 and 200 or p_due is null or p_due<=now() or p_due>now()+interval '30 days' then raise exception 'Name and future deadline required';end if;
  update public.icash_handoffs set state='acknowledged',assigned_to=btrim(p_assignee),due_at=p_due,updated_at=now() where id=h.id;
 elsif p_action='resolve' then
  if length(btrim(coalesce(p_resolution,''))) not between 5 and 2000 then raise exception 'Record the resolution';end if;
  update public.icash_handoffs set state='resolved',resolved_at=now(),resolution=btrim(p_resolution),updated_at=now() where id=h.id;
  if h.closing_setup_id is not null then
   update public.icash_closing_setup set review_reason='setup',state='needs_review',updated_at=now() where id=h.closing_setup_id and account_id=p_account;
  end if;
  if h.text_attention_id is not null then update public.icash_text_attention set state='acknowledged' where id=h.text_attention_id and account_id=p_account;end if;
  if p_resume and exists(select 1 from public.icash_closing_setup where account_id=p_account and screening_id=h.screening_id and review_reason<>'setup') then raise exception 'Resolve the separate closing issue before resuming';end if;
  if p_resume and not exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=h.screening_id and state<>'resolved') then
   perform public.icash_set_work_control(p_actor,p_account,'return_to_bot',h.screening_id);
  end if;
 else raise exception 'Unknown handoff action';end if;
end $$;
-- Do not let the generic return button silently close unresolved requests.
alter function public.icash_set_work_control(uuid,uuid,text,uuid) rename to icash_set_work_control_before_journey;
create function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_action='return_to_bot' and exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then raise exception 'Resolve the handoff before returning control';end if;
 perform public.icash_set_work_control_before_journey(p_user,p_account,p_action,p_screening);
 if p_action='return_to_bot' then
  -- Release only a resolved human-request hold. STOP, wrong numbers, contract
  -- withdrawals, later inbound signals and explicit manual-only threads remain held.
  update public.icash_text_threads t set paused=false
  from public.icash_text_attention a join public.icash_handoffs h on h.text_attention_id=a.id and h.account_id=a.account_id
  where t.id=a.thread_id and t.account_id=p_account and a.account_id=p_account and h.screening_id=p_screening
   and h.state='resolved' and h.resolution is not null and a.kind='human' and a.state='acknowledged'
   and t.retired_at is null and not t.manual_only and t.ai_mode='auto'
   and public.icash_sms_thread_review_current(p_account,t.id,false)
   and not exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
   and a.message_id=(select id from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='incoming' order by created_at desc,id desc limit 1)
   and not exists(select 1 from public.icash_text_attention other where other.account_id=p_account and other.thread_id=t.id and other.id<>a.id and other.state='open');
 end if;
end $$;
-- Existing notification consent, suppression and bounded delivery remain intact.
alter function public.icash_attention_sources(uuid) rename to icash_attention_sources_before_journey;
create function public.icash_attention_sources(p_account uuid)
returns table(kind text,category text,source_id uuid,source_version text,screening_id uuid,event_at timestamptz,priority integer)
language sql stable security invoker set search_path='' as $$
 select * from public.icash_attention_sources_before_journey(p_account)
 union all select 'handoff','needs_you',h.id,'assigned:'||h.updated_at::text||case when h.due_at<now() then ':overdue' else '' end,h.screening_id,h.due_at,case when h.due_at<now() then 0 else 2 end
 from public.icash_handoffs h join public.icash_screening_jobs s on s.id=h.screening_id and s.account_id=h.account_id and s.state='complete'
 where h.account_id=p_account and h.state='acknowledged'
$$;

-- Correct the previously double-escaped local date matcher/format. No guard is removed.
do $$ declare f text;begin
 f:=pg_get_functiondef('public.icash_manage_showing(uuid,uuid,uuid,text,uuid,integer,jsonb)'::regprocedure);
 f:=replace(f,E'\\\\d','[0-9]');f:=replace(f,E'\\"','"');execute f;
end $$;

-- Public capability read. Seller links never expose buyer prices or buyer details.
create function public.icash_read_journey(p_token text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare j public.icash_deal_journeys;d public.icash_deal_files;s public.icash_showing_requests;p jsonb;role text;
begin
 if p_token !~ '^[a-f0-9]{32}$' then return null;end if;
 select * into j from public.icash_deal_journeys where (buyer_token=p_token or seller_token=p_token) and expires_at>now();
 if not found or not public.icash_journey_current(j.id) then return null;end if;
 role:=case when j.buyer_token=p_token then 'buyer' else 'seller' end;
 if role='seller' and j.seller_thread_id is null then return null;end if;
 select * into d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id;
 select * into s from public.icash_showing_requests where buyer_request_id=j.request_id and deal_id=j.deal_id order by updated_at desc limit 1;
 p:=jsonb_build_object('role',role,'address',d.terms->>'address','state',j.state,'wantsAssignment',j.wants_assignment,'wantsViewing',j.wants_viewing,
 'showing',case when s.id is null then null else jsonb_build_object('id',s.id,'version',s.version,'start',s.starts_at,'end',s.ends_at,'timezone',s.timezone,'state',s.state,'sellerConfirmed',s.seller_confirmed_at is not null,'buyerConfirmed',s.buyer_confirmed_at is not null) end);
 if role='buyer' then
  p:=p||jsonb_build_object('slots',public.icash_current_viewing_slots(j.account_id,j.deal_id),'detailsSubmitted',j.buyer_details is not null,
   'askingPriceCents',public.icash_buyer_package_data(j.account_id,j.deal_id)->'askingPriceCents','depositCents',public.icash_buyer_package_data(j.account_id,j.deal_id)->'depositCents');
 end if;
 return p;
end $$;

create function public.icash_submit_journey(p_token text,p_action text,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_deal_journeys;d public.icash_deal_files;s public.icash_showing_requests;slot jsonb;start_at timestamptz;end_at timestamptz;role text;slots jsonb:='[]';v jsonb;
begin
 if p_token !~ '^[a-f0-9]{32}$' or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>5000 then raise exception 'Invalid request';end if;
 select * into strict j from public.icash_deal_journeys where (buyer_token=p_token or seller_token=p_token) and expires_at>now() for update;
 select * into strict d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for update;
 if not public.icash_journey_current(j.id) then raise exception 'Deal paused or unavailable';end if;
 role:=case when j.buyer_token=p_token then 'buyer' else 'seller' end;
 if role='seller' and j.seller_thread_id is null then raise exception 'Seller link unavailable';end if;
 if p_action='details' and role='buyer' then
  if not j.wants_assignment or j.state not in ('collecting','ready') then raise exception 'Assignment request already processed';end if;
  if p_data-array['legalName','signerName','email','fundsReady','authorized','titleCompany','askingPriceCents','depositCents']<>'{}'::jsonb
   or length(btrim(coalesce(p_data->>'legalName',''))) not between 2 and 200 or length(btrim(coalesce(p_data->>'signerName',''))) not between 2 and 200
   or coalesce(p_data->>'email','') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(p_data->>'email')>254
   or p_data->'askingPriceCents' is distinct from public.icash_buyer_package_data(j.account_id,j.deal_id)->'askingPriceCents'
   or p_data->'depositCents' is distinct from public.icash_buyer_package_data(j.account_id,j.deal_id)->'depositCents'
   or p_data->'fundsReady' is distinct from 'true'::jsonb or p_data->'authorized' is distinct from 'true'::jsonb
   or length(coalesce(p_data->>'titleCompany',''))>200 or concat_ws('',p_data->>'legalName',p_data->>'signerName',p_data->>'titleCompany') ~ E'[\r\n]' then raise exception 'Complete buyer and signing details required';end if;
  if j.buyer_details is not null and j.buyer_details<>p_data then raise exception 'Details already submitted; contact the team for a change';end if;
  if exists(select 1 from public.icash_signing_envelopes where account_id=j.account_id and deal_id=j.deal_id and kind='assignment' and not test_mode) then raise exception 'An assignment already exists; contact the team';end if;
  update public.icash_deal_journeys set buyer_details=p_data,state='ready',next_run_at=now(),last_progress_at=now(),updated_at=now() where id=j.id;
  if nullif(btrim(p_data->>'titleCompany'),'') is not null then update public.icash_buyer_viewing_requests set title_quote='Buyer preference: '||(p_data->>'titleCompany') where id=j.request_id and account_id=j.account_id;end if;
 elsif p_action='choose_time' and role='buyer' then
  if not j.wants_viewing then raise exception 'Viewing request required';end if;
  select value into slot from jsonb_array_elements(public.icash_current_viewing_slots(j.account_id,j.deal_id)) where value->>'startsAt'=p_data->>'startsAt';
  if slot is null then raise exception 'That seller time is no longer available';end if;
  start_at:=(slot->>'startsAt')::timestamptz;end_at:=least(coalesce((slot->>'endsAt')::timestamptz,start_at+interval '30 minutes'),start_at+interval '30 minutes');
  if end_at<=start_at then raise exception 'Invalid viewing window';end if;
  select * into s from public.icash_showing_requests where buyer_request_id=j.request_id and deal_id=j.deal_id and state in ('proposed','confirmed') for update;
  if found then
   if s.starts_at=start_at and s.buyer_confirmed_at is not null then return jsonb_build_object('saved',true);end if;
   raise exception 'Cancel the current visit before choosing a replacement';
  end if;
  if exists(select 1 from public.icash_showing_requests where deal_id=j.deal_id and state in ('proposed','confirmed') and starts_at<end_at and ends_at>start_at) then raise exception 'That time was just taken';end if;
  insert into public.icash_showing_requests(deal_id,buyer_name,starts_at,ends_at,timezone,buyer_request_id,buyer_confirmed_at,buyer_note)
  values(j.deal_id,coalesce(j.buyer_details->>'signerName','Buyer'),start_at,end_at,slot->>'timezone',j.request_id,now(),'Buyer selected this exact time through their private link');
  update public.icash_deal_journeys set next_run_at=now(),last_progress_at=now(),updated_at=now() where id=j.id;
 elsif p_action in ('confirm','cancel') then
  select * into strict s from public.icash_showing_requests where id=(p_data->>'id')::uuid and deal_id=j.deal_id and buyer_request_id=j.request_id and version=(p_data->>'version')::integer and state in ('proposed','confirmed') for update;
  if s.starts_at<=now() then raise exception 'Visit is in the past';end if;
  update public.icash_showing_requests set history=history||jsonb_build_array(jsonb_build_object('at',now(),'actorRole',role,'action',p_action,'previous',to_jsonb(s)-'history')) where id=s.id;
  if p_action='cancel' then
   update public.icash_showing_requests set state='cancelled',change_note=role||' cancelled through the private visit link',version=version+1,updated_at=now() where id=s.id;
  else
   update public.icash_showing_requests set seller_confirmed_at=case when role='seller' then now() else seller_confirmed_at end,buyer_confirmed_at=case when role='buyer' then now() else buyer_confirmed_at end,
    seller_note=case when role='seller' then 'Seller confirmed this exact time through their private link' else seller_note end,
    buyer_note=case when role='buyer' then 'Buyer confirmed this exact time through their private link' else buyer_note end,version=version+1,updated_at=now() where id=s.id returning * into s;
   if s.seller_confirmed_at is not null and s.buyer_confirmed_at is not null then update public.icash_showing_requests set state='confirmed' where id=s.id;end if;
  end if;
  update public.icash_deal_journeys set next_run_at=now(),last_progress_at=now(),updated_at=now() where id=j.id;
 elsif p_action='availability' and role='seller' then
  if jsonb_typeof(p_data->'windows') is distinct from 'array' or jsonb_array_length(p_data->'windows') not between 1 and 8 then raise exception 'Choose at least one future time';end if;
  for v in select value from jsonb_array_elements(p_data->'windows') loop
   slot:=public.icash_parse_viewing_slot(v#>>'{}',now());if slot is null then raise exception 'Choose an exact date, AM/PM and timezone';end if;slots:=slots||jsonb_build_array(slot);
  end loop;
  insert into public.icash_seller_viewing_availability(account_id,deal_id,screening_id,thread_id,source,source_id,quote,slots,state,timezone,stated_at)
  values(j.account_id,j.deal_id,j.screening_id,j.seller_thread_id,'portal',gen_random_uuid(),'Seller provided viewing times through their private link',slots,'available',slots->0->>'timezone',now());
  update public.icash_deal_journeys set next_run_at=now(),last_progress_at=now(),updated_at=now() where deal_id=j.deal_id and account_id=j.account_id and wants_viewing;
 else raise exception 'Action unavailable for this link';end if;
 return jsonb_build_object('saved',true);
end $$;
alter table public.icash_seller_viewing_availability drop constraint icash_seller_viewing_availability_source_check;
alter table public.icash_seller_viewing_availability add constraint icash_seller_viewing_availability_source_check check(source in ('call','outbound_call','text','owner','portal'));

-- Atomic preparation serializes competing buyers. Existing envelopes, advertised
-- prices and purchase terms are preserved. Sending never signs for the owner.
create function public.icash_claim_journey_assignment(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_deal_journeys;d public.icash_deal_files;t public.icash_text_threads;owner_id uuid;mail text;p jsonb;
begin
 select * into j from public.icash_deal_journeys where id=p_id and state='ready' and expires_at>now() for update;if not found then return null;end if;
 select * into d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for update;
 if not public.icash_journey_allowed(j.account_id,j.deal_id) then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=j.account_id and not paused and not manual_only and retired_at is null;
 if not found or public.icash_sms_thread_review_current(j.account_id,t.id,true) is distinct from true or exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 if exists(select 1 from public.icash_signing_envelopes where account_id=j.account_id and deal_id=j.deal_id and kind='assignment' and not test_mode)
  or exists(select 1 from public.icash_deal_journeys where deal_id=j.deal_id and id<>j.id and state in ('sending','signing','deposit_due','reserved')) then
  update public.icash_deal_journeys set state='needs_review',review_reason='Another buyer assignment is already in progress',updated_at=now() where id=j.id;return null;end if;
 select a.owner_user_id,u.email into owner_id,mail from public.icash_accounts a join auth.users u on u.id=a.owner_user_id where a.id=j.account_id and u.email_confirmed_at is not null;
 p:=public.icash_buyer_package_data(j.account_id,j.deal_id);
 if mail is null or j.buyer_details is null or p is null or j.buyer_details->'askingPriceCents' is distinct from p->'askingPriceCents' or j.buyer_details->'depositCents' is distinct from p->'depositCents' or p->'reserved'='true'::jsonb or (p->>'depositCents')::bigint not between 1 and 500000 then return null;end if;
 update public.icash_deal_files set terms=terms||jsonb_build_object('assignee',j.buyer_details->>'legalName'),updated_at=now() where id=d.id;
 update public.icash_deal_journeys set state='sending',updated_at=now(),next_run_at=now()+interval '10 minutes' where id=j.id;
 return jsonb_build_object('id',j.id,'accountId',j.account_id,'dealId',j.deal_id,'userId',owner_id,'customerEmail',mail,'signerName',j.buyer_details->>'signerName','email',j.buyer_details->>'email','phone',t.recipient);
end $$;

create function public.icash_advance_journey(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare j public.icash_deal_journeys;e public.icash_signing_envelopes;s public.icash_showing_requests;slots jsonb;ids uuid[];url text;label text;stamp text;due timestamptz;
begin
 select * into j from public.icash_deal_journeys where id=p_id for update;if not found or j.state='closed' then return;end if;
 update public.icash_deal_journeys set next_run_at=now()+interval '15 minutes' where id=j.id;
 if not exists(select 1 from public.icash_deal_files where id=j.deal_id and account_id=j.account_id and stage in ('under_contract','buyer_selected','title_open','closing')) then
  update public.icash_deal_journeys set state='closed' where id=j.id;return;end if;
 if not public.icash_journey_allowed(j.account_id,j.deal_id) then return;end if;
 if j.expires_at<=now() then update public.icash_deal_journeys set state='needs_review',review_reason='Buyer request link expired; follow up with the buyer' where id=j.id;return;end if;
 if j.seller_thread_id is null then
  select array_agg(t.id) into ids from public.icash_text_threads t where t.account_id=j.account_id and t.deal_id=j.deal_id and t.party='seller' and t.retired_at is null
   and exists(select 1 from public.icash_signing_envelopes signed cross join lateral jsonb_array_elements(signed.recipients) with ordinality r(v,n)
   where signed.deal_id=j.deal_id and signed.account_id=j.account_id and signed.kind='purchase' and signed.state='completed' and not signed.test_mode and r.n<jsonb_array_length(signed.recipients) and r.v->>'phone'=t.recipient);
  if cardinality(ids)=1 then update public.icash_deal_journeys set seller_thread_id=ids[1] where id=j.id;j.seller_thread_id:=ids[1];end if;
 end if;
 if j.state in ('sending','signing','deposit_due','needs_review') and j.buyer_details is not null then
  select * into e from public.icash_signing_envelopes where account_id=j.account_id and deal_id=j.deal_id and kind='assignment' and not test_mode and terms->>'assignee'=j.buyer_details->>'legalName'
   and recipients->0->>'phone'=(select recipient from public.icash_text_threads where id=j.thread_id and account_id=j.account_id) order by created_at desc limit 1;
  if e.id is not null then
   if e.state='completed' then
    if exists(select 1 from public.icash_buyer_deposit_receipts where account_id=j.account_id and deal_id=j.deal_id and envelope_id=e.id) then
     update public.icash_deal_journeys set state='reserved',envelope_id=e.id,review_reason=null,updated_at=now() where id=j.id;
    else
     -- The owner's original form has no deposit deadline. Only a separately
     -- verified agreed deadline may populate deposit_due_at.
     update public.icash_deal_journeys set state='deposit_due',envelope_id=e.id,updated_at=now() where id=j.id;
     perform public.icash_journey_message(j.id,j.thread_id,'deposit_due','Your assignment is signed. Please arrange the deposit through your verified deal contact. Receipt must be confirmed to reserve the property.');
    end if;
   elsif e.state in ('awaiting_counterparty','customer_signature_needed') then update public.icash_deal_journeys set state=case when j.state='needs_review' then 'needs_review' else 'signing' end,envelope_id=e.id,updated_at=now() where id=j.id;
   else update public.icash_deal_journeys set state='needs_review',envelope_id=e.id,review_reason='Assignment delivery or signature needs review',updated_at=now() where id=j.id;end if;
  elsif j.state='sending' and j.updated_at<now()-interval '10 minutes' then
   update public.icash_deal_journeys set state='needs_review',review_reason='Assignment send was interrupted; reconcile before retrying',updated_at=now() where id=j.id;
  end if;
 end if;
 url:='https://www.geticashx.com/next/'||j.buyer_token;
 if j.state='collecting' and (j.wants_assignment or not exists(select 1 from public.icash_showing_requests where buyer_request_id=j.request_id and state in ('proposed','confirmed','completed'))) then
  perform public.icash_journey_message(j.id,j.thread_id,'buyer_intake',case when j.wants_assignment then 'Your next step: buyer details for the assignment. ' else 'Choose a viewing time here. Seller confirmation is still needed. ' end||url);
  if j.last_progress_at<now()-interval '1 day' then perform public.icash_journey_message(j.id,j.thread_id,'buyer_reminder_1','Still interested? Complete your next step here: '||url);end if;
  if j.last_progress_at<now()-interval '3 days' then perform public.icash_journey_message(j.id,j.thread_id,'buyer_reminder_2','Would you like to move forward? Your next step: '||url);end if;
 end if;
 if j.state in ('collecting','needs_review','deposit_due') and j.last_progress_at<now()-interval '3 days' then
  insert into public.icash_title_tasks(account_id,deal_id,source_key,kind,label,state,evidence,payload)
  values(j.account_id,j.deal_id,'journey:'||j.id||':stalled','reply_review',case when j.state='deposit_due' then 'Follow up on the buyer deposit' when j.state='needs_review' then 'Resolve the buyer next step' else 'Follow up with the buyer' end,'needs_review','Open Buyer next step for the pending action and delivery records.',jsonb_build_object('journeyId',j.id)) on conflict(source_key) do nothing;
 else
  update public.icash_title_tasks set state='done',updated_at=now() where account_id=j.account_id and source_key='journey:'||j.id||':stalled' and state='needs_review';
 end if;
 if j.wants_viewing then
  slots:=public.icash_current_viewing_slots(j.account_id,j.deal_id);
  if jsonb_array_length(slots)=0 then
   perform public.icash_journey_message(j.id,j.seller_thread_id,'seller_times','A buyer requested a viewing. Please share good times here: https://www.geticashx.com/next/'||j.seller_token);
  else
   stamp:=encode(sha256(convert_to(slots::text,'UTF8')),'hex');
   perform public.icash_journey_message(j.id,j.thread_id,'viewing_options:'||stamp,'Seller viewing options are ready. Pick a time here: '||url);
  end if;
  select * into s from public.icash_showing_requests where deal_id=j.deal_id and buyer_request_id=j.request_id order by updated_at desc limit 1;
  if found then
   label:=to_char(s.starts_at at time zone s.timezone,'Mon DD FMHH12:MI AM')||' '||case s.timezone when 'America/Chicago' then 'Central' when 'America/New_York' then 'Eastern' when 'America/Denver' then 'Mountain' when 'America/Los_Angeles' then 'Pacific' else s.timezone end;
   if s.state='proposed' and s.starts_at>now() then
    if s.seller_confirmed_at is null then perform public.icash_journey_message(j.id,j.seller_thread_id,'confirm_seller:'||s.id||':'||s.version,'Please confirm the requested visit: https://www.geticashx.com/next/'||j.seller_token,s.id,s.version);end if;
    if s.buyer_confirmed_at is null then perform public.icash_journey_message(j.id,j.thread_id,'confirm_buyer:'||s.id||':'||s.version,'Please confirm the requested visit: '||url,s.id,s.version);end if;
   elsif s.state='confirmed' and s.starts_at>now() then
    perform public.icash_journey_message(j.id,j.thread_id,'confirmed_buyer:'||s.id||':'||s.version,'Visit confirmed: '||label||'. Manage: '||url,s.id,s.version);
    perform public.icash_journey_message(j.id,j.seller_thread_id,'confirmed_seller:'||s.id||':'||s.version,'Visit confirmed: '||label||'. Manage: https://www.geticashx.com/next/'||j.seller_token,s.id,s.version);
    if s.starts_at<=now()+interval '24 hours' then
     stamp:=case when s.starts_at<=now()+interval '2 hours' then '2h' else '24h' end;
     perform public.icash_journey_message(j.id,j.thread_id,'reminder_buyer:'||s.id||':'||s.version||':'||stamp,'Viewing reminder: '||label||'. Manage: '||url,s.id,s.version);
     perform public.icash_journey_message(j.id,j.seller_thread_id,'reminder_seller:'||s.id||':'||s.version||':'||stamp,'Viewing reminder: '||label||'. Manage: https://www.geticashx.com/next/'||j.seller_token,s.id,s.version);
    end if;
   elsif s.state='cancelled' then
    perform public.icash_journey_message(j.id,j.thread_id,'cancelled_buyer:'||s.id||':'||s.version,'This visit was cancelled. Choose another time: '||url,s.id,s.version);
    perform public.icash_journey_message(j.id,j.seller_thread_id,'cancelled_seller:'||s.id||':'||s.version,'This visit was cancelled. Share new availability: https://www.geticashx.com/next/'||j.seller_token,s.id,s.version);
   end if;
  end if;
 end if;
end $$;

create function public.icash_claim_journey_message() returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_journey_messages;j public.icash_deal_journeys;t public.icash_text_threads;x public.icash_text_messages;
begin
 select * into m from public.icash_journey_messages where state='ready' and next_attempt_at<=now() order by next_attempt_at,id for update skip locked limit 1;if not found then return null;end if;
 update public.icash_journey_messages set next_attempt_at=now()+interval '30 minutes' where id=m.id;
 select * into j from public.icash_deal_journeys where id=m.journey_id;
 if j.expires_at<=now() or j.state='closed' then update public.icash_journey_messages set state='cancelled' where id=m.id;return null;end if;
 if m.showing_id is not null and not exists(select 1 from public.icash_showing_requests where id=m.showing_id and version=m.showing_version) then update public.icash_journey_messages set state='cancelled' where id=m.id;return null;end if;
 if not public.icash_journey_allowed(m.account_id,j.deal_id) then return null;end if;
 if not public.icash_journey_message_current(m.id) then update public.icash_journey_messages set state='cancelled' where id=m.id;return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=m.account_id and not paused and not manual_only and retired_at is null;
 if not found or public.icash_sms_thread_review_current(m.account_id,t.id,true) is distinct from true or exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 if m.message_id is not null then
  select * into x from public.icash_text_messages where id=m.message_id and account_id=m.account_id;
  if x.state in ('accepted','delivered') then update public.icash_journey_messages set state='sent' where id=m.id;return null;end if;
  if x.state<>'ready' or x.provider_id is not null then update public.icash_journey_messages set state='needs_review' where id=m.id;return null;end if;
 end if;
 if m.attempts>=3 then update public.icash_journey_messages set state='needs_review' where id=m.id;return null;end if;
 if m.message_id is null then
  m.message_id:=public.icash_queue_text(m.account_id,m.thread_id,m.id,m.body,'{}');
 end if;
 update public.icash_journey_messages set message_id=m.message_id,attempts=attempts+1 where id=m.id;
 return jsonb_build_object('accountId',m.account_id,'messageId',m.message_id);
end $$;
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_journey;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_journey_messages;j public.icash_deal_journeys;
begin
 select * into m from public.icash_journey_messages where account_id=p_account and message_id=p_message;
 if found then
  select * into j from public.icash_deal_journeys where id=m.journey_id;
  if not public.icash_journey_message_current(m.id) or m.state<>'ready' then return null;end if;
  if m.showing_id is not null and not exists(select 1 from public.icash_showing_requests where id=m.showing_id and version=m.showing_version) then return null;end if;
  if not exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=m.thread_id and body=m.body) then return null;end if;
 end if;
 return public.icash_claim_text_before_journey(p_account,p_message,p_sender);
end $$;

-- A small fair scan, without locking across a provider request.
create function public.icash_due_journeys() returns jsonb language plpgsql security invoker set search_path='' as $$
declare ids uuid[];
begin
 select array_agg(id) into ids from (select id from public.icash_deal_journeys where state<>'closed' and next_run_at<=now() order by next_run_at,id for update skip locked limit 5) x;
 update public.icash_deal_journeys set next_run_at=now()+interval '5 minutes' where id=any(ids);
 return coalesce(to_jsonb(ids),'[]');
end $$;

create function public.icash_journey_progress(p_account uuid,p_screenings uuid[]) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item order by priority,created_at),'[]') from (
 select j.created_at,case when j.state='needs_review' then 0 when j.state='deposit_due' then 1 else 2 end priority,
 jsonb_build_object('id',j.id,'deal_id',j.deal_id,'screening_id',j.screening_id,'state',j.state,'wants_assignment',j.wants_assignment,'wants_viewing',j.wants_viewing,
 'review_reason',j.review_reason,'deposit_due_at',j.deposit_due_at,'last_progress_at',j.last_progress_at,
 'envelopeState',(select state from public.icash_signing_envelopes where id=j.envelope_id and account_id=p_account),
 'messageReview',exists(select 1 from public.icash_journey_messages m left join public.icash_text_messages t on t.id=m.message_id and t.account_id=m.account_id where m.journey_id=j.id and (m.state='needs_review' or t.state='needs_review')),
 'hasSlots',jsonb_array_length(public.icash_current_viewing_slots(p_account,j.deal_id))>0,
 'showingState',(select state from public.icash_showing_requests where deal_id=j.deal_id and buyer_request_id=j.request_id order by updated_at desc limit 1),
 'titleState',(select state from public.icash_title_requests where account_id=p_account and deal_id=j.deal_id order by created_at desc limit 1),
 'titleSelected',exists(select 1 from public.icash_title_contacts c where c.account_id=p_account and c.deal_id=j.deal_id and c.enabled and c.verified_until>now() and public.icash_title_contact_matches(p_account,j.deal_id,c.email)),
 'closingKind',(select kind from public.icash_closing_updates where account_id=p_account and deal_id=j.deal_id order by created_at desc limit 1)) item
 from public.icash_deal_journeys j where j.account_id=p_account and j.screening_id=any(p_screenings) and cardinality(p_screenings)<=6 order by priority,j.created_at limit 50
 ) rows
$$;

create function public.icash_save_journey_deadline(p_account uuid,p_actor uuid,p_deal uuid,p_due timestamptz,p_note text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) or length(btrim(coalesce(p_note,''))) not between 5 and 1000
  or p_due is null or p_due>now()+interval '90 days' or p_due<now()-interval '30 days' then raise exception 'Agreed deadline and its source required';end if;
 update public.icash_deal_journeys j set deposit_due_at=p_due,deposit_deadline_note=btrim(p_note),updated_at=now()
 where j.account_id=p_account and j.deal_id=p_deal and j.state='deposit_due' and exists(select 1 from public.icash_signing_envelopes e where e.id=j.envelope_id and e.account_id=p_account and e.state='completed' and not e.test_mode);
 if not found then raise exception 'Current signed assignment required';end if;
end $$;

create or replace function public.icash_buyer_purchase_intent(p_turns jsonb) returns jsonb
language plpgsql immutable security invoker set search_path='' as $$
declare turn jsonb;b text;intent jsonb;payment jsonb;
begin
 if jsonb_typeof(p_turns) is distinct from 'array' then return null;end if;
 for turn in select value from jsonb_array_elements(p_turns) loop
  if turn->>'role' is distinct from 'user' then continue;end if;b:=btrim(turn->>'message');
  if length(b) not between 1 and 1500 then continue;end if;
  if b ~* '^\s*(stop|unsubscribe|cancel|not interested|no thanks)[.! ]*$' or b ~* '\m(stop contacting|do not contact|don''t contact|remove me)\M' then intent:=null;payment:=null;
  elsif b ~* '\m(i|we) (did not|didn''t|have not|haven''t|never) (pay|paid|send|sent|wire|wired)\M' then payment:=null;
  elsif b ~* '\m(i|we) (have |already |just )*(paid|sent|wired|zell[ae]d)\M'
   and (b ~* '\m(deposit|emd|money|payment|funds|cash ?app|zelle|wire)\M' or b ~ '\$[0-9]') then payment:=jsonb_build_object('kind','payment_reported','quote',b);
  elsif b ~* '\m(not ready (to|for)|(don''t|do not|don''t want to|do not want to|won''t|cannot|can''t) (send|text|email|pay|sign|buy)|(don''t want|do not want|cancel|withdraw)( the| an?| my)? (agreement|assignment|contract|deposit|reservation))\M' then intent:=null;
  elsif b !~* '\m(if|unless|provided)\M' and (b ~* '\m(ready to|want to|would like to|can i|how (can|do) i) (pay|send|wire|reserve|buy|sign)\M'
   or b ~* '^(i want it|we want it|i''ll take it|we''ll take it|i will take it|we will take it|let''s move forward|let us move forward)[.! ]*$'
   or b ~* '\m(send|text|email|want|need|request|ready for|like)\M.*\m(assignment|agreement|contract|payment instructions)\M')
   then intent:=jsonb_build_object('kind','reservation','quote',b);
  end if;
 end loop;
 -- A subsequent agreement request must not hide a claimed payment.
 return coalesce(payment,intent);
end $$;

-- All entrypoints stay behind the server's authenticated account or opaque
-- capability routes. No new direct anon/authenticated database grants.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
 'icash_track_closing_handoff','icash_track_text_handoff','icash_buyer_purchase_intent','icash_journey_allowed','icash_journey_current','icash_journey_message_current','icash_seed_deal_journey','icash_journey_message','icash_save_closing_setup','icash_save_closing_setup_before_profile','icash_inherit_closing_profile','icash_manage_handoff','icash_set_work_control','icash_set_work_control_before_journey','icash_attention_sources','icash_attention_sources_before_journey','icash_read_journey','icash_submit_journey','icash_claim_journey_assignment','icash_advance_journey','icash_claim_journey_message','icash_claim_text','icash_claim_text_before_journey','icash_due_journeys','icash_journey_progress','icash_save_journey_deadline']) loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
