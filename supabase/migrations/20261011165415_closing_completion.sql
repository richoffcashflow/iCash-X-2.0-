begin;
set local lock_timeout='3s';

-- Buyer-reported obstacles are evidence, never authority to change prices or sign.
create table public.icash_journey_blockers (
 journey_id uuid primary key references public.icash_deal_journeys(id),
 kind text not null check(kind in ('access','timing','price','repairs','funding','human')),
 note text not null default '' check(length(note)<=1000), revision integer not null default 1,
 state text not null default 'open' check(state in ('open','resolved')),
 resolution text, resolved_by uuid references auth.users(id), resolved_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.icash_proceeds_receipts (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null unique references public.icash_deal_files(id),
 closing_update_id uuid not null unique references public.icash_closing_updates(id),
 amount_cents bigint not null check(amount_cents>0 and amount_cents<=9007199254740991),
 received_date date not null,confirmed_by uuid not null references auth.users(id),created_at timestamptz not null default now()
);
create index icash_proceeds_account_date on public.icash_proceeds_receipts(account_id,received_date);
create index icash_proceeds_actor on public.icash_proceeds_receipts(confirmed_by);
create index icash_blocker_actor on public.icash_journey_blockers(resolved_by) where resolved_by is not null;
alter table public.icash_journey_blockers enable row level security;
alter table public.icash_proceeds_receipts enable row level security;
revoke all on public.icash_journey_blockers,public.icash_proceeds_receipts from public,anon,authenticated;
grant select,insert,update on public.icash_journey_blockers to service_role;
grant select,insert on public.icash_proceeds_receipts to service_role;
alter table public.icash_handoffs add column portal_journey_id uuid unique references public.icash_deal_journeys(id);
alter table public.icash_handoffs drop constraint icash_handoff_one_source;
alter table public.icash_handoffs add constraint icash_handoff_one_source check(num_nonnulls(conversation_id,closing_setup_id,text_attention_id,portal_journey_id)=1);

alter function public.icash_read_journey(text) rename to icash_read_journey_before_completion;
create function public.icash_read_journey(p_token text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;j public.icash_deal_journeys;b public.icash_journey_blockers;package_token text;
begin
 result:=public.icash_read_journey_before_completion(p_token);
 if result is null then
  -- A buyer who requested a person can still read a minimal receipt of that request.
  -- No signing, payment details or other paused workflow action becomes available.
  select j0.* into j from public.icash_deal_journeys j0 join public.icash_deal_files d on d.id=j0.deal_id and d.account_id=j0.account_id
   where j0.buyer_token=p_token and j0.expires_at>now() and d.stage in ('under_contract','buyer_selected','title_open','closing')
   and exists(select 1 from public.icash_handoffs h where h.portal_journey_id=j0.id and h.account_id=j0.account_id and h.state<>'resolved');
  if not found then return null;end if;
  select * into b from public.icash_journey_blockers where journey_id=j.id and kind='human' and state='open';
  if not found then return null;end if;
  return jsonb_build_object('role','buyer','address',(select terms->>'address' from public.icash_deal_files where id=j.deal_id and account_id=j.account_id),'state','human_review','wantsAssignment',false,'wantsViewing',false,'showing',null,'blocker',jsonb_build_object('kind',b.kind,'note',b.note,'revision',b.revision,'updatedAt',b.updated_at));
 end if;
 if result->>'role'<>'buyer' then return result;end if;
 select * into j from public.icash_deal_journeys where buyer_token=p_token;
 select * into b from public.icash_journey_blockers where journey_id=j.id and state='open';
 select token into package_token from public.icash_buyer_package_links where account_id=j.account_id and deal_id=j.deal_id and revoked_at is null limit 1;
 return result||jsonb_build_object('blocker',case when b.journey_id is null then null else jsonb_build_object('kind',b.kind,'note',b.note,'revision',b.revision,'updatedAt',b.updated_at) end,
 'packageUrl',case when package_token is null then null else 'https://homeoffernetwork.com/d/'||package_token end);
end $$;

alter function public.icash_submit_journey(text,text,jsonb) rename to icash_submit_journey_before_completion;
create function public.icash_submit_journey(p_token text,p_action text,p_data jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_deal_journeys;b public.icash_journey_blockers;result jsonb;k text;n text;
begin
 if p_action not in ('request_assignment','request_viewing','blocker') then
  result:=public.icash_submit_journey_before_completion(p_token,p_action,p_data);
  if p_action='choose_time' then
   with resolved as (
    update public.icash_journey_blockers set state='resolved',resolution='Buyer chose a seller-provided time',resolved_at=now()
    where journey_id=(select id from public.icash_deal_journeys where buyer_token=p_token) and kind='access' and state='open' returning journey_id
   ) update public.icash_title_tasks t set state='done',updated_at=now() from resolved r,public.icash_deal_journeys j0
    where j0.id=r.journey_id and t.account_id=j0.account_id and t.source_key='journey:'||j0.id||':blocker';
  end if;return result;
 end if;
 if p_token !~ '^[a-f0-9]{32}$' or jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Invalid request';end if;
 select * into strict j from public.icash_deal_journeys where buyer_token=p_token for update;
 perform 1 from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for update;
 if not public.icash_journey_current(j.id) then raise exception 'Request unavailable';end if;
 if p_action='blocker' then
  k:=p_data->>'kind';n:=btrim(coalesce(p_data->>'note',''));
  if k is null or k not in ('access','timing','price','repairs','funding','human') or length(n)>1000 or p_data-array['kind','note']<>'{}'::jsonb
   or n ~* E'(\\m(routing|account|ssn|social security)\\s*(number|#|:)|\\m[0-9]{9,}\\M)' then raise exception 'Invalid help request';end if;
  select * into b from public.icash_journey_blockers where journey_id=j.id;
  if b.state='open' and b.kind=k and b.note=n then return jsonb_build_object('saved',true);end if;
  insert into public.icash_journey_blockers(journey_id,kind,note) values(j.id,k,n)
   on conflict(journey_id) do update set kind=excluded.kind,note=excluded.note,state='open',revision=icash_journey_blockers.revision+1,
    resolution=null,resolved_by=null,resolved_at=null,updated_at=now();
  update public.icash_deal_journeys set wants_viewing=wants_viewing or k='access',next_run_at=now(),last_progress_at=now() where id=j.id;
  if k='human' then
   insert into public.icash_handoffs(account_id,screening_id,party,reason,summary,next_action,portal_journey_id)
    values(j.account_id,j.screening_id,'buyer','Buyer requested a person','Requested through the private buyer page: '||n,'Open Buyer next step, speak with the buyer and record the outcome.',j.id)
    on conflict(portal_journey_id) do update set state='open',summary=excluded.summary,resolution=null,resolved_at=null,updated_at=now();
  end if;
  insert into public.icash_title_tasks(account_id,deal_id,source_key,kind,label,state,evidence,payload)
   values(j.account_id,j.deal_id,'journey:'||j.id||':blocker','reply_review',case k when 'access' then 'Buyer needs another viewing time' when 'timing' then 'Review buyer closing date' when 'price' then 'Review buyer price question' when 'repairs' then 'Answer buyer property question' when 'funding' then 'Review buyer funds or deposit' else 'Buyer requested a person' end,'needs_review',n,jsonb_build_object('journeyId',j.id))
   on conflict(source_key) do update set label=excluded.label,state='needs_review',evidence=excluded.evidence,updated_at=now();
 else
  if p_data<>'{}'::jsonb or j.state not in ('collecting','ready','signing','deposit_due','reserved') then raise exception 'Step unavailable';end if;
  if p_action='request_assignment' and j.state<>'collecting' then return jsonb_build_object('saved',true);end if;
  update public.icash_deal_journeys set wants_assignment=wants_assignment or p_action='request_assignment',wants_viewing=wants_viewing or p_action='request_viewing',
   next_run_at=now(),last_progress_at=case when (p_action='request_assignment' and not wants_assignment) or (p_action='request_viewing' and not wants_viewing) then now() else last_progress_at end where id=j.id;
 end if;
 return jsonb_build_object('saved',true);
end $$;

create function public.icash_resolve_journey_blocker(p_account uuid,p_actor uuid,p_journey uuid,p_revision integer,p_resolution text) returns void language plpgsql security invoker set search_path='' as $$
declare j public.icash_deal_journeys;b public.icash_journey_blockers;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 select * into strict j from public.icash_deal_journeys where id=p_journey and account_id=p_account for update;
 select * into strict b from public.icash_journey_blockers where journey_id=j.id and revision=p_revision for update;
 if length(btrim(coalesce(p_resolution,''))) not between 5 and 1000 then raise exception 'Record the verified outcome';end if;
 if b.state='resolved' then
  if b.resolution<>btrim(p_resolution) then raise exception 'Outcome already recorded';end if;return;
 end if;
 update public.icash_journey_blockers set state='resolved',resolution=btrim(p_resolution),resolved_by=p_actor,resolved_at=now() where journey_id=j.id;
 update public.icash_handoffs set state='resolved',resolution=btrim(p_resolution),resolved_at=now(),updated_at=now()
  where portal_journey_id=j.id and account_id=p_account and state<>'resolved';
 update public.icash_title_tasks set state='done',updated_at=now() where account_id=p_account and source_key in ('journey:'||j.id||':blocker','journey:'||j.id||':stalled');
 -- Resume only the existing state. Keep unrelated holds and uncertain sends intact.
 update public.icash_deal_journeys set next_run_at=now(),last_progress_at=now() where id=j.id;
end $$;

alter function public.icash_manage_handoff(uuid,uuid,uuid,text,text,timestamptz,text,boolean) rename to icash_manage_handoff_before_completion;
create function public.icash_manage_handoff(p_account uuid,p_actor uuid,p_id uuid,p_action text,p_assignee text default null,p_due timestamptz default null,p_resolution text default null,p_resume boolean default false) returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_action='resolve' and exists(select 1 from public.icash_handoffs where id=p_id and account_id=p_account and portal_journey_id is not null and state<>'resolved') then raise exception 'Resolve the current buyer request in Buyer next step';end if;
 perform public.icash_manage_handoff_before_completion(p_account,p_actor,p_id,p_action,p_assignee,p_due,p_resolution,p_resume);
end $$;

alter function public.icash_claim_journey_assignment(uuid) rename to icash_claim_journey_assignment_before_completion;
create function public.icash_claim_journey_assignment(p_id uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_deal_journeys where id=p_id for update;
 if exists(select 1 from public.icash_journey_blockers where journey_id=p_id and state='open' and kind<>'access') then return null;end if;
 return public.icash_claim_journey_assignment_before_completion(p_id);
end $$;

alter function public.icash_journey_message_current(uuid) rename to icash_journey_message_current_before_completion;
create function public.icash_journey_message_current(p_id uuid) returns boolean language plpgsql stable security invoker set search_path='' as $$
declare m public.icash_journey_messages;b public.icash_journey_blockers;
begin
 select * into m from public.icash_journey_messages where id=p_id;
 select * into b from public.icash_journey_blockers where journey_id=m.journey_id and state='open';
 if b.journey_id is not null and b.kind<>'access' then return false;end if;
 if b.kind='access' and m.event_key like 'viewing_options:%' then return false;end if;
 if m.event_key like 'access_help:%' then return coalesce(b.kind='access' and m.event_key='access_help:'||b.revision and public.icash_journey_current(m.journey_id),false);end if;
 if m.event_key='stalled_help' then return public.icash_journey_current(m.journey_id) and exists(select 1 from public.icash_deal_journeys where id=m.journey_id and state='collecting' and last_progress_at<now()-interval '3 days') and b.journey_id is null;end if;
 return public.icash_journey_message_current_before_completion(p_id);
end $$;

alter function public.icash_advance_journey(uuid) rename to icash_advance_journey_before_completion;
create function public.icash_advance_journey(p_id uuid) returns void language plpgsql security invoker set search_path='' as $$
declare j public.icash_deal_journeys;b public.icash_journey_blockers;
begin
 perform public.icash_advance_journey_before_completion(p_id);
 select * into j from public.icash_deal_journeys where id=p_id;
 if j.id is null or not public.icash_journey_current(j.id) then return;end if;
 select * into b from public.icash_journey_blockers where journey_id=j.id and state='open';
 if b.kind='access' then
  if exists(select 1 from public.icash_seller_viewing_availability where account_id=j.account_id and deal_id=j.deal_id and stated_at>b.updated_at and state='available')
   and jsonb_array_length(public.icash_current_viewing_slots(j.account_id,j.deal_id))>0 then
   update public.icash_journey_blockers set state='resolved',resolution='Seller supplied new availability',resolved_at=now() where journey_id=j.id;
   update public.icash_title_tasks set state='done',updated_at=now() where account_id=j.account_id and source_key='journey:'||j.id||':blocker';
  else
   perform public.icash_journey_message(j.id,j.seller_thread_id,'access_help:'||b.revision,'Buyer needs another viewing time. Share options: https://homeoffernetwork.com/next/'||j.seller_token);
  end if;
 elsif b.journey_id is null and j.state='collecting' and j.last_progress_at<now()-interval '3 days' then
  -- Replace the second generic reminder, without adding another reminder for old requests.
  if not exists(select 1 from public.icash_journey_messages where journey_id=j.id and event_key='buyer_reminder_2' and (message_id is not null or state<>'ready')) then
   update public.icash_journey_messages set state='cancelled' where journey_id=j.id and event_key in ('buyer_intake','buyer_reminder_1','buyer_reminder_2') and state='ready' and message_id is null;
   perform public.icash_journey_message(j.id,j.thread_id,'stalled_help','What is holding things up? Share a price, timing or viewing question: https://homeoffernetwork.com/next/'||j.buyer_token);
  end if;
 end if;
 -- Close only the plain request whose outcome has verified workflow evidence.
 update public.icash_buyer_viewing_requests r set state='reviewed',reviewed_at=now(),resolution_note=case when r.kind='viewing' then 'Both buyer and seller confirmed the specific visit.' else 'Signed assignment and cleared deposit receipt confirmed.' end
 where r.id=j.request_id and r.account_id=j.account_id and r.state='needs_confirmation'
 and r.title_quote is null and r.coordination_quote is null
 and not exists(select 1 from public.icash_journey_blockers where journey_id=j.id and state='open')
 and ((r.kind='viewing' and exists(select 1 from public.icash_showing_requests where buyer_request_id=r.id and state='confirmed'))
  or (r.kind in ('reservation','payment_reported') and j.state='reserved' and (not j.wants_viewing
   or exists(select 1 from public.icash_showing_requests where buyer_request_id=r.id and state='confirmed'))));
end $$;

alter function public.icash_journey_progress(uuid,uuid[]) rename to icash_journey_progress_before_completion;
create function public.icash_journey_progress(p_account uuid,p_screenings uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(item||jsonb_build_object('blocker',(select jsonb_build_object('kind',b.kind,'note',b.note,'revision',b.revision,'updatedAt',b.updated_at) from public.icash_journey_blockers b where b.journey_id=(item->>'id')::uuid and b.state='open'),'requestId',(select request_id from public.icash_deal_journeys where id=(item->>'id')::uuid and account_id=p_account)) order by ord),'[]')
 from jsonb_array_elements(public.icash_journey_progress_before_completion(p_account,p_screenings)) with ordinality a(item,ord)
$$;

create function public.icash_saved_closers(p_account uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('dealId',deal_id,'company',proposal->>'company','closer',proposal->>'closer','email',proposal->>'email','phone',proposal->>'phone','lastProperty',address,'verifiedUntil',verified_until) order by updated_at desc),'[]') from (
 select distinct on(lower(c.email)) c.deal_id,s.title_proposal proposal,d.terms->>'address' address,c.verified_until,s.updated_at
 from public.icash_closing_setup s join public.icash_title_contacts c on c.account_id=s.account_id and c.deal_id=s.deal_id
 join public.icash_deal_files d on d.id=s.deal_id and d.account_id=s.account_id
 where s.account_id=p_account and c.enabled and c.verified_until>now() and lower(c.email)=lower(s.title_proposal->>'email')
 and public.icash_title_contact_matches(p_account,c.deal_id,c.email) and c.evidence_ref like 'owner-closing-verification:%' and nullif(s.title_proposal->>'closer','') is not null
 order by lower(c.email),s.updated_at desc limit 12) saved
$$;
create function public.icash_select_saved_closer(p_account uuid,p_actor uuid,p_deal uuid,p_source uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare p jsonb;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 if not exists(select 1 from jsonb_array_elements(public.icash_saved_closers(p_account)) c where c->>'dealId'=p_source::text) then raise exception 'Recheck the saved title contact';end if;
 select title_proposal into p from public.icash_closing_setup where account_id=p_account and deal_id=p_source;
 return public.icash_save_closing_setup(p_account,p_actor,p_deal,'title_preference',p);
end $$;

create function public.icash_confirm_proceeds(p_account uuid,p_actor uuid,p_deal uuid,p_update uuid,p_received date) returns uuid language plpgsql security invoker set search_path='' as $$
declare u public.icash_closing_updates;r public.icash_proceeds_receipts;result uuid;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account and stage='closed' for update;
 if not found then raise exception 'Confirmed closing required';end if;
 select * into u from public.icash_closing_updates where account_id=p_account and deal_id=p_deal and kind='funds_disbursed' order by created_at desc,id desc limit 1;
 if u.id is distinct from p_update or u.amount_cents is null or u.effective_date is null or (u.confirmed_by is null and u.confirmation_source is distinct from 'verified_title_format') or not exists(select 1 from public.icash_title_replies where id=u.reply_id and account_id=p_account and deal_id=p_deal and sender_verified)
  or p_received is null or p_received<u.effective_date or p_received>(now() at time zone 'America/Chicago')::date then raise exception 'Current title payment confirmation and receipt date required';end if;
 select * into r from public.icash_proceeds_receipts where deal_id=p_deal;
 if found then
  if r.account_id<>p_account or r.closing_update_id<>p_update or r.received_date<>p_received then raise exception 'Receipt already recorded; review any discrepancy with title';end if;return r.id;
 end if;
 insert into public.icash_proceeds_receipts(account_id,deal_id,closing_update_id,amount_cents,received_date,confirmed_by)
 values(p_account,p_deal,p_update,u.amount_cents,p_received,p_actor) returning id into result;return result;
end $$;

create function public.icash_task_recoveries(p_account uuid,p_tasks uuid[]) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('taskId',t.id,'journeyId',j.id,'blocker',jsonb_build_object('kind',b.kind,'note',b.note,'revision',b.revision,'updatedAt',b.updated_at))),'[]')
 from public.icash_title_tasks t join public.icash_deal_journeys j on j.account_id=t.account_id and j.deal_id=t.deal_id and t.source_key='journey:'||j.id||':blocker'
 join public.icash_journey_blockers b on b.journey_id=j.id and b.state='open'
 where t.account_id=p_account and t.id=any(p_tasks) and cardinality(p_tasks)<=50
$$;
alter function public.icash_update_title_task(uuid,uuid,text,date) rename to icash_update_title_task_before_completion;
create function public.icash_update_title_task(p_account uuid,p_task uuid,p_action text,p_due date default null) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 if jsonb_array_length(public.icash_task_recoveries(p_account,array[p_task]))>0 then return false;end if;
 return public.icash_update_title_task_before_completion(p_account,p_task,p_action,p_due);
end $$;

create function public.icash_network_demand(p_account uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare markets jsonb;
begin
 if not public.icash_vip_active(p_account) then raise exception 'VIP required';end if;
 with current_buyers as materialized (
  select b.* from public.icash_network_buyers b join auth.users u on u.id=b.user_id and u.email_confirmed_at is not null and lower(btrim(u.email))=b.email
  where not b.paused and b.expires_at>now() and not exists(select 1 from public.icash_email_suppressions s where lower(s.email)=b.email)
 ), counts as (
  select zip,count(distinct b.id) buyers,count(distinct b.id) filter(where 'house'=any(b.property_types)) houses,count(distinct b.id) filter(where 'land'=any(b.property_types)) land
  from current_buyers b cross join lateral unnest(b.zips) zip group by zip having count(distinct b.id)>=3
  order by count(distinct b.id) desc,zip limit 12
 ) select coalesce(jsonb_agg(jsonb_build_object('zip',zip,'buyers',buyers,'houseBuyers',houses,'landBuyers',land) order by buyers desc,zip),'[]') into markets from counts;
 return jsonb_build_object('markets',markets,'checkedAt',now());
end $$;

do $$declare f record;begin
 for f in select oid::regprocedure identity from pg_proc where pronamespace='public'::regnamespace and proname in (
 'icash_read_journey','icash_submit_journey','icash_resolve_journey_blocker','icash_manage_handoff','icash_claim_journey_assignment','icash_journey_message_current','icash_advance_journey','icash_journey_progress','icash_saved_closers','icash_select_saved_closer','icash_confirm_proceeds','icash_network_demand','icash_task_recoveries','icash_update_title_task') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.identity);
 execute format('grant execute on function %s to service_role',f.identity);
 end loop;
end $$;
-- One owner-only snapshot. No sends, retries, billing changes or inferred payments.
create function public.icash_closing_operations(p_actor uuid,p_days integer default 30,p_include_owner boolean default false) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare report jsonb;start_at timestamptz;end_at timestamptz:=now();result jsonb;
begin
 -- Reuse the installed owner authorization and reporting-period validation.
 report:=public.icash_owner_overview(p_actor,p_days,p_include_owner,'',1);
 start_at:=(report->>'startAt')::timestamptz;
 with accounts as materialized (
  select a.id from public.icash_accounts a where (p_include_owner or a.owner_user_id<>p_actor)
   and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
    or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))
 ), deals as materialized (
  select d.*,r.amount_cents received_cents,r.received_date,
   (select min(created_at) from public.icash_buyer_deposit_receipts where deal_id=d.id and account_id=d.account_id) deposit_at,
   (select min(u.created_at) from public.icash_closing_updates u join public.icash_title_replies t on t.id=u.reply_id and t.account_id=u.account_id and t.deal_id=u.deal_id and t.sender_verified where u.deal_id=d.id and u.account_id=d.account_id and u.kind='title_opened') title_at,
   (select min(u.created_at) from public.icash_closing_updates u join public.icash_title_replies t on t.id=u.reply_id and t.account_id=u.account_id and t.deal_id=u.deal_id and t.sender_verified where u.deal_id=d.id and u.account_id=d.account_id and u.kind='closed') closed_at,
   exists(select 1 from public.icash_signing_envelopes e where e.deal_id=d.id and e.account_id=d.account_id and e.kind='assignment' and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null) assignment_complete
  from public.icash_deal_files d join accounts a on a.id=d.account_id
  left join public.icash_proceeds_receipts r on r.deal_id=d.id and r.account_id=d.account_id
  where coalesce(d.terms->>'practice','false')='false' and exists(select 1 from public.icash_signing_envelopes e where e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null)
 ), current_stages as (
  select d.id,case when closed_at is not null then 'payment' when deposit_at is not null then 'title' when assignment_complete then 'deposit' else 'buyer' end key,
   coalesce(closed_at,deposit_at,case when assignment_complete then assignment_signed_at end,seller_signed_at,created_at) started_at
  from deals d where d.received_date is null and d.stage not in ('canceled','cancelled','cancellation_pending')
 ), stage_totals as (
  select key,count(*) count,round(avg(greatest(0,extract(epoch from(end_at-started_at))/86400))::numeric,1) average_days
  from current_stages group by key
 ), open_deals as materialized (
  select * from deals where stage not in ('closed','canceled','cancelled','cancellation_pending')
 ), issues as materialized (
  select d.id deal_id,d.account_id,d.terms->>'address' address,'Buyer needs help: '||b.kind reason,b.updated_at since
   from open_deals d join public.icash_deal_journeys j on j.deal_id=d.id and j.account_id=d.account_id join public.icash_journey_blockers b on b.journey_id=j.id and b.state='open'
  union all
  select d.id,d.account_id,d.terms->>'address','Buyer has not progressed',j.last_progress_at
   from open_deals d join public.icash_deal_journeys j on j.deal_id=d.id and j.account_id=d.account_id
   where j.state in ('collecting','ready','signing','deposit_due') and j.last_progress_at<end_at-interval '3 days'
   and not exists(select 1 from public.icash_journey_blockers b where b.journey_id=j.id and b.state='open')
  union all
  select d.id,d.account_id,d.terms->>'address','Deal message needs delivery review',m.created_at
   from open_deals d join public.icash_deal_journeys j on j.deal_id=d.id and j.account_id=d.account_id
   join public.icash_journey_messages m on m.journey_id=j.id and m.state='needs_review'
  union all
  select d.id,d.account_id,d.terms->>'address','Title request needs delivery review',t.updated_at
   from deals d join public.icash_title_requests t on t.deal_id=d.id and t.account_id=d.account_id
   where d.stage not in ('canceled','cancelled','cancellation_pending') and (t.state='needs_review' or t.state='dispatching' and t.updated_at<end_at-interval '15 minutes')
  union all
  select d.id,d.account_id,d.terms->>'address','Reply needs a response',a.created_at
   from deals d join public.icash_text_attention a on a.deal_id=d.id and a.account_id=d.account_id and a.state='open'
   where d.stage not in ('canceled','cancelled','cancellation_pending')
  union all
  select d.id,d.account_id,d.terms->>'address','Confirm payment receipt',d.closed_at
   from deals d where d.stage='closed' and d.closed_at is not null and d.received_date is null
 ), unique_issues as materialized (
  select deal_id,account_id,address,reason,min(since) since from issues group by deal_id,account_id,address,reason
 ) select jsonb_build_object(
  'signedContracts',(select count(*) from deals where seller_signed_at>=start_at and seller_signed_at<end_at),
  'closedDeals',(select count(*) from deals where closed_at>=start_at and closed_at<end_at),
  'deposits',(select count(*) from deals where deposit_at>=start_at and deposit_at<end_at),
  'receivedCents',coalesce((select sum(received_cents) from deals where received_date>=(start_at at time zone 'America/Chicago')::date and received_date<=(end_at at time zone 'America/Chicago')::date),0),
  'receivedDeals',(select count(*) from deals where received_date>=(start_at at time zone 'America/Chicago')::date and received_date<=(end_at at time zone 'America/Chicago')::date),
  'stages',coalesce((select jsonb_agg(jsonb_build_object('key',key,'count',count,'averageDays',average_days) order by key) from stage_totals),'[]'),
  'issueCount',(select count(*) from unique_issues),
  'issues',coalesce((select jsonb_agg(jsonb_build_object('dealId',deal_id,'accountId',account_id,'address',address,'reason',reason,'since',since) order by since,deal_id,reason) from(select * from unique_issues order by since,deal_id,reason limit 20) q),'[]')
 ) into result;
 return result;
end $$;
revoke all on function public.icash_closing_operations(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.icash_closing_operations(uuid,integer,boolean) to service_role;
commit;
