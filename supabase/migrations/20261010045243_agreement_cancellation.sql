-- Cancellation is a durable hold, then an owner-recorded release. Originals are never deleted.
alter table public.icash_deal_files drop constraint icash_deal_files_stage_check;
alter table public.icash_deal_files add constraint icash_deal_files_stage_check check(stage in ('draft','under_contract','buyer_selected','title_open','closing','closed','cancellation_pending','cancelled'));
alter table public.icash_signing_envelopes drop constraint icash_signing_envelopes_state_check;
alter table public.icash_signing_envelopes add constraint icash_signing_envelopes_state_check check(state in ('creating','awaiting_counterparty','customer_signature_needed','completed','test_completed','needs_review','cancellation_pending','cancelled'));
alter table public.icash_signing_envelopes drop constraint icash_signing_envelopes_deal_id_kind_test_mode_key;
create unique index icash_signing_one_current_agreement on public.icash_signing_envelopes(deal_id,kind,test_mode) where state<>'cancelled';
alter table public.icash_buyer_deposit_receipts drop constraint icash_buyer_deposit_receipts_deal_id_key;
create unique index icash_buyer_deposit_per_agreement on public.icash_buyer_deposit_receipts(envelope_id);

create table public.icash_agreement_cancellations (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null references public.icash_deal_files(id),
 actor_user_id uuid not null references auth.users(id),
 request_key uuid not null,kind text not null check(kind in ('purchase','assignment')),
 state text not null default 'pending' check(state in ('pending','completed')),
 reason text not null check(length(reason) between 3 and 1000),
 previous_stage text not null,snapshot jsonb not null check(jsonb_typeof(snapshot)='array'),
 provider_checks jsonb not null default '{}' check(jsonb_typeof(provider_checks)='object'),
 requires_release boolean not null default false,has_deposit boolean not null default false,has_title boolean not null default false,
 release_reference text not null default '' check(length(release_reference)<=1000),
 resolution_reference text not null default '' check(length(resolution_reference)<=1000),
 late_activity boolean not null default false,
 created_at timestamptz not null default now(),completed_at timestamptz,
 unique(account_id,request_key),check((state='completed')=(completed_at is not null))
);
create unique index icash_cancellation_one_pending on public.icash_agreement_cancellations(deal_id) where state='pending';
create index icash_cancellation_account_deal on public.icash_agreement_cancellations(account_id,deal_id,created_at desc);
alter table public.icash_agreement_cancellations enable row level security;
revoke all on public.icash_agreement_cancellations from public,anon,authenticated;
grant select,insert,update on public.icash_agreement_cancellations to service_role;

create function public.icash_cancellation_provider_ready(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select not exists (
  select 1 from public.icash_agreement_cancellations c
  cross join lateral jsonb_array_elements(c.snapshot) s
  left join public.icash_signing_envelopes e on e.id=(s->>'id')::uuid and e.account_id=c.account_id and e.deal_id=c.deal_id
  where c.id=p_id and (e.id is null or e.provider_id is null
   or coalesce(c.provider_checks->e.id::text->>'outcome','') not in ('expired','completed')
   or (c.provider_checks->e.id::text->>'provider_id') is distinct from e.provider_id)
 ) and exists(select 1 from public.icash_agreement_cancellations where id=p_id);
$$;

create function public.icash_cancellation_preview(p_account uuid,p_actor uuid,p_deal uuid) returns jsonb language plpgsql set search_path='' as $$
declare d public.icash_deal_files;items jsonb;history jsonb;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'kind',e.kind,'state',e.state,'provider_id',e.provider_id,'test_mode',e.test_mode,'updated_at',e.updated_at) order by e.id),'[]') into items
  from public.icash_signing_envelopes e where e.deal_id=d.id and e.account_id=p_account and e.state<>'cancelled';
 select coalesce(jsonb_agg(x.item order by x.created_at desc),'[]') into history from (
  select c.created_at,jsonb_build_object('id',c.id,'kind',c.kind,'state',c.state,'reason',c.reason,'requires_release',c.requires_release,'has_deposit',c.has_deposit,'has_title',c.has_title,'release_reference',c.release_reference,'resolution_reference',c.resolution_reference,'created_at',c.created_at,'completed_at',c.completed_at,'late_activity',c.late_activity,'provider_ready',public.icash_cancellation_provider_ready(c.id)) item
  from public.icash_agreement_cancellations c where c.deal_id=d.id and c.account_id=p_account order by c.created_at desc limit 20
 ) x;
 return jsonb_build_object('revision',md5(d.updated_at::text||items::text),'stage',d.stage,'hasAssignment',exists(select 1 from jsonb_array_elements(items) e where e->>'kind'='assignment'),
  'blocked',d.stage in ('closed','cancelled') or d.funded_at is not null,'requests',history);
end $$;

create function public.icash_request_cancellation(p_account uuid,p_actor uuid,p_deal uuid,p_kind text,p_reason text,p_key uuid,p_revision text) returns uuid language plpgsql set search_path='' as $$
declare d public.icash_deal_files;c public.icash_agreement_cancellations;items jsonb;v_property_id text;n uuid;
begin
 -- Use the same first lock as signing, title and outbound-dispatch admission.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 select * into c from public.icash_agreement_cancellations where account_id=p_account and request_key=p_key;
 if found then
  if row(c.deal_id,c.kind,c.reason) is distinct from row(p_deal,p_kind,trim(p_reason)) then raise exception 'Cancellation key already used';end if;
  return c.id;
 end if;
 if p_key is null or p_kind is null or p_kind not in ('purchase','assignment') or coalesce(length(trim(p_reason)),0) not between 3 and 1000 then raise exception 'Cancellation details required';end if;
 if d.stage in ('closed','cancelled','cancellation_pending') or d.funded_at is not null then raise exception 'Deal cannot be cancelled in its current state';end if;
 perform 1 from public.icash_signing_envelopes where deal_id=d.id order by id for update;
 if (public.icash_cancellation_preview(p_account,p_actor,p_deal)->>'revision') is distinct from p_revision then raise exception 'Agreement changed; refresh before cancelling';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'state',e.state,'provider_id',e.provider_id,'kind',e.kind,'test_mode',e.test_mode) order by e.id),'[]') into items
  from public.icash_signing_envelopes e where e.account_id=p_account and e.deal_id=d.id and e.state<>'cancelled' and (p_kind='purchase' or e.kind='assignment');
 if p_kind='assignment' and (d.seller_signed_at is null or jsonb_array_length(items)=0) then raise exception 'Current assignment required';end if;
 insert into public.icash_agreement_cancellations(account_id,deal_id,actor_user_id,request_key,kind,reason,previous_stage,snapshot,requires_release,has_deposit,has_title)
 values(p_account,p_deal,p_actor,p_key,p_kind,trim(p_reason),d.stage,items,
  exists(select 1 from jsonb_array_elements(items) e where not (e->>'test_mode')::boolean and e->>'state' in ('completed','customer_signature_needed')),
  exists(select 1 from public.icash_buyer_deposit_receipts r join jsonb_array_elements(items) e on r.envelope_id=(e->>'id')::uuid where r.account_id=p_account and r.deal_id=d.id),
  exists(select 1 from public.icash_title_requests where account_id=p_account and deal_id=d.id and state in ('dispatching','sent','needs_review'))
   or exists(select 1 from public.icash_closing_updates where account_id=p_account and deal_id=d.id)) returning id into n;
 select snapshot->>'propertyId' into v_property_id from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 if v_property_id is null then raise exception 'Property control unavailable';end if;
 insert into public.icash_property_controls(account_id,property_id,manual) values(p_account,v_property_id,true)
  on conflict(account_id,property_id) do update set manual=true,updated_at=now();
 update public.icash_deal_files set stage='cancellation_pending',updated_at=now() where id=d.id;
 update public.icash_signature_authorizations set state='revoked' where account_id=p_account and state='authorized' and envelope_id in (select (e->>'id')::uuid from jsonb_array_elements(items) e);
 update public.icash_signing_envelopes set state='cancellation_pending',updated_at=now() where id in (select (e->>'id')::uuid from jsonb_array_elements(items) e);
 update public.icash_text_threads set paused=true where account_id=p_account and deal_id=d.id and (p_kind='purchase' or party='buyer');
 update public.icash_text_messages m set state='cancelled' from public.icash_text_threads t where m.thread_id=t.id and m.account_id=p_account and t.account_id=p_account and t.deal_id=d.id and m.direction='outgoing' and m.state='ready';
 update public.icash_fulfillment_jobs set state='held',updated_at=now() where id in (select id from public.icash_fulfillment_jobs where account_id=p_account and deal_id=d.id and state in ('ready','issued') for update skip locked);
 update public.icash_live_callbacks set state='held_for_human' where account_id=p_account and screening_id=d.screening_id and state='pending_dispatch_review';
 return n;
end $$;

create function public.icash_record_cancellation_check(p_account uuid,p_actor uuid,p_id uuid,p_envelope uuid,p_provider text,p_outcome text,p_signed boolean) returns void language plpgsql set search_path='' as $$
declare c public.icash_agreement_cancellations;e public.icash_signing_envelopes;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 select * into strict c from public.icash_agreement_cancellations where id=p_id and account_id=p_account for update;
 if c.state='completed' then return;end if;
 select * into strict e from public.icash_signing_envelopes where id=p_envelope and account_id=p_account and deal_id=c.deal_id;
 if not exists(select 1 from jsonb_array_elements(c.snapshot) s where s->>'id'=e.id::text) or e.provider_id is distinct from p_provider or p_outcome is null or p_outcome not in ('expired','completed','error') or p_signed is null or (p_outcome='completed' and not p_signed) then raise exception 'Cancellation evidence mismatch';end if;
 update public.icash_agreement_cancellations set provider_checks=provider_checks||jsonb_build_object(e.id::text,jsonb_build_object('provider_id',p_provider,'outcome',p_outcome,'signed',p_signed,'checked_at',now())),
  requires_release=requires_release or (p_signed and not e.test_mode) where id=c.id;
 if p_outcome='completed' then update public.icash_signing_envelopes set provider_status='Completed' where id=e.id;end if;
end $$;

create function public.icash_finish_cancellation(p_account uuid,p_actor uuid,p_id uuid,p_confirmed boolean default false,p_release text default '',p_resolution text default '') returns boolean language plpgsql set search_path='' as $$
declare c public.icash_agreement_cancellations;d public.icash_deal_files;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Owner required';end if;
 -- Match request's budget -> deal -> cancellation lock ordering.
 select * into strict c from public.icash_agreement_cancellations where id=p_id and account_id=p_account;
 select * into strict d from public.icash_deal_files where id=c.deal_id and account_id=p_account for update;
 select * into strict c from public.icash_agreement_cancellations where id=p_id and account_id=p_account for update;
 if c.state='completed' then return true;end if;
 if d.stage<>'cancellation_pending' or d.funded_at is not null or c.late_activity then raise exception 'Cancellation needs review';end if;
 if not public.icash_cancellation_provider_ready(c.id) then return false;end if;
 if (c.requires_release or c.has_deposit or c.has_title) and (p_confirmed is distinct from true or coalesce(length(trim(p_release)),0) not between 8 and 1000) then return false;end if;
 if (c.has_deposit or c.has_title) and coalesce(length(trim(p_resolution)),0) not between 8 and 1000 then return false;end if;
 update public.icash_agreement_cancellations set state='completed',completed_at=now(),release_reference=trim(coalesce(p_release,'')),resolution_reference=trim(coalesce(p_resolution,'')) where id=c.id;
 update public.icash_signing_envelopes set state='cancelled',updated_at=now() where account_id=p_account and deal_id=d.id and id in (select (e->>'id')::uuid from jsonb_array_elements(c.snapshot) e);
 if c.kind='purchase' then
  update public.icash_deal_files set stage='cancelled',updated_at=now() where id=d.id;
  update public.icash_buyer_package_links set revoked_at=coalesce(revoked_at,now()) where account_id=p_account and deal_id=d.id;
 else
  -- The original seller document and all old buyer/deposit evidence remain intact.
  update public.icash_deal_files set stage='under_contract',assignment_signed_at=null,terms=jsonb_set(terms,'{assignee}','""'),updated_at=now() where id=d.id;
  update public.icash_closing_setup set state='needs_review',review_reason='title_issue',updated_at=now() where account_id=p_account and deal_id=d.id;
 end if;
 -- Neither completion nor retry restores automatic control.
 return true;
end $$;

create function public.icash_signing_action_allowed(p_account uuid,p_envelope uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
  where e.id=p_envelope and e.account_id=p_account and e.state not in ('cancellation_pending','cancelled') and d.stage not in ('cancellation_pending','cancelled','closed')
  and not exists(select 1 from public.icash_agreement_cancellations c where c.deal_id=d.id and c.late_activity));
$$;

-- A provider create that was already in flight may still attach its ID, but cannot revive its document.
create function public.icash_guard_cancelled_signing() returns trigger language plpgsql set search_path='' as $$
begin
 if old.state in ('cancellation_pending','cancelled') and new.state<>old.state then
  if not (old.state='cancellation_pending' and new.state='cancelled' and exists(select 1 from public.icash_agreement_cancellations c where c.deal_id=old.deal_id and c.state='completed' and c.snapshot @> jsonb_build_array(jsonb_build_object('id',old.id)))) then new.state:=old.state;end if;
 end if;
 return new;
end $$;
create trigger icash_cancelled_signing_guard before update on public.icash_signing_envelopes for each row execute function public.icash_guard_cancelled_signing();

create function public.icash_guard_cancelled_deal() returns trigger language plpgsql set search_path='' as $$
begin
 if old.stage='cancelled' and (new.stage<>old.stage or new.terms is distinct from old.terms or new.funded_at is distinct from old.funded_at) then raise exception 'Cancelled deal is retained for history';end if;
 if old.stage='cancellation_pending' and (new.stage<>old.stage or new.terms is distinct from old.terms or new.funded_at is distinct from old.funded_at)
  and exists(select 1 from public.icash_agreement_cancellations where deal_id=old.id and state='pending') then raise exception 'Resolve cancellation first';end if;
 return new;
end $$;
create trigger icash_cancelled_deal_guard before update on public.icash_deal_files for each row execute function public.icash_guard_cancelled_deal();

alter function public.icash_save_signing_status(uuid,text,jsonb) rename to icash_save_signing_before_cancellation;
create function public.icash_save_signing_status(p_id uuid,p_state text,p_evidence jsonb) returns void language plpgsql set search_path='' as $$
declare e public.icash_signing_envelopes;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict e from public.icash_signing_envelopes where id=p_id;
 if e.state in ('cancellation_pending','cancelled') then
  if p_evidence->>'id' is distinct from e.provider_id or (p_evidence->>'test_mode')::boolean is distinct from e.test_mode then raise exception 'Signature evidence mismatch';end if;
  update public.icash_signing_envelopes set provider_evidence=p_evidence,provider_status=p_evidence->>'status' where id=e.id;
  update public.icash_agreement_cancellations c set requires_release=requires_release or (not e.test_mode and p_state in ('completed','customer_signature_needed')),
   late_activity=late_activity or (c.state='completed' and p_state='completed' and c.provider_checks->e.id::text->>'outcome'='expired')
   where c.deal_id=e.deal_id and c.snapshot @> jsonb_build_array(jsonb_build_object('id',e.id));
  return;
 end if;
 perform public.icash_save_signing_before_cancellation(p_id,p_state,p_evidence);
end $$;

create or replace function public.icash_buyer_is_reserved(p_account uuid,p_deal uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_buyer_deposit_receipts r join public.icash_signing_envelopes e on e.id=r.envelope_id and e.account_id=r.account_id and e.deal_id=r.deal_id
  where r.account_id=p_account and r.deal_id=p_deal and e.state='completed' and e.kind='assignment' and not e.test_mode);
$$;
alter function public.icash_buyer_outreach_held(uuid,uuid) rename to icash_buyer_outreach_held_before_cancellation;
create function public.icash_buyer_outreach_held(p_account uuid,p_deal uuid) returns boolean language sql stable set search_path='' as $$
 select public.icash_buyer_outreach_held_before_cancellation(p_account,p_deal)
  or exists(select 1 from public.icash_deal_files where id=p_deal and account_id=p_account and stage in ('cancellation_pending','cancelled'))
  or exists(select 1 from public.icash_agreement_cancellations where deal_id=p_deal and account_id=p_account and late_activity);
$$;
alter function public.icash_set_work_control(uuid,uuid,text,uuid) rename to icash_set_work_control_before_cancellation;
create function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void language plpgsql set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if p_action='return_to_bot' and exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=p_screening and
  (d.stage in ('cancellation_pending','cancelled') or exists(select 1 from public.icash_agreement_cancellations c where c.deal_id=d.id and c.late_activity))) then raise exception 'Resolve cancellation before returning control';end if;
 perform public.icash_set_work_control_before_cancellation(p_user,p_account,p_action,p_screening);
 if p_action='return_to_bot' then
  update public.icash_fulfillment_jobs j set state='ready',updated_at=now() from public.icash_deal_files d
   where j.deal_id=d.id and j.account_id=p_account and d.account_id=p_account and d.screening_id=p_screening and j.state='held'
   and d.stage in ('under_contract','buyer_selected','title_open','closing')
   and exists(select 1 from public.icash_agreement_cancellations c where c.deal_id=d.id and c.kind='assignment' and c.state='completed' and not c.late_activity);
 end if;
end $$;

-- A reply on the old title email thread cannot reserve a replacement buyer.
-- After replacement, deposit confirmation must name the current agreement explicitly.
create or replace function public.icash_reserve_from_closing_deposit() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.icash_signing_envelopes;
begin
 if new.kind<>'deposit_received' or new.amount_cents not between 1 and 500000 then return new;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_deal_files where id=new.deal_id and account_id=new.account_id for update;
 if exists(select 1 from public.icash_agreement_cancellations where account_id=new.account_id and deal_id=new.deal_id and kind='assignment' and state='completed') then return new;end if;
 select a.* into e from public.icash_signing_envelopes a join public.icash_deal_files d on d.id=a.deal_id and d.account_id=a.account_id and d.terms=a.terms
  where a.deal_id=new.deal_id and a.account_id=new.account_id and a.kind='assignment' and a.state='completed' and not a.test_mode and a.provider_id is not null
  and (a.terms->>'assignmentDepositCents')::bigint=new.amount_cents;
 if not found or (select count(*) from public.icash_signing_envelopes where account_id=new.account_id and deal_id=new.deal_id and kind='assignment' and state='completed' and not test_mode)<>1 then return new;end if;
 insert into public.icash_buyer_deposit_receipts(account_id,deal_id,envelope_id,terms_hash,amount_cents,method,reference,confirmed_by,request_key)
 values(new.account_id,new.deal_id,e.id,e.terms_hash,new.amount_cents,'verified_closer','Closing confirmation '||new.id,new.confirmed_by,new.id) on conflict do nothing;
 return new;
end $$;
revoke all on function public.icash_reserve_from_closing_deposit() from public,anon,authenticated;

alter function public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text) rename to icash_confirm_closing_before_cancellation;
create function public.icash_confirm_closing_update(p_account uuid,p_actor uuid,p_deal uuid,p_reply uuid,p_kind text,p_date date default null,p_amount bigint default null,p_file text default '') returns uuid language plpgsql set search_path='' as $$
declare d public.icash_deal_files;cutoff timestamptz;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if d.stage in ('cancellation_pending','cancelled') then raise exception 'Resolve cancellation before closing updates';end if;
 select max(completed_at) into cutoff from public.icash_agreement_cancellations where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed';
 if cutoff is not null then
  if not exists(select 1 from public.icash_title_replies where id=p_reply and account_id=p_account and deal_id=p_deal and received_at>cutoff) then raise exception 'A new closing confirmation is required for the replacement buyer';end if;
  if p_kind='closed' and not public.icash_buyer_is_reserved(p_account,p_deal) then raise exception 'Confirm the current buyer deposit first';end if;
 end if;
 return public.icash_confirm_closing_before_cancellation(p_account,p_actor,p_deal,p_reply,p_kind,p_date,p_amount,p_file);
end $$;

revoke all on function public.icash_cancellation_provider_ready(uuid),public.icash_cancellation_preview(uuid,uuid,uuid),public.icash_request_cancellation(uuid,uuid,uuid,text,text,uuid,text),public.icash_record_cancellation_check(uuid,uuid,uuid,uuid,text,text,boolean),public.icash_finish_cancellation(uuid,uuid,uuid,boolean,text,text),public.icash_signing_action_allowed(uuid,uuid),public.icash_guard_cancelled_signing(),public.icash_guard_cancelled_deal(),public.icash_save_signing_status(uuid,text,jsonb),public.icash_buyer_outreach_held(uuid,uuid),public.icash_set_work_control(uuid,uuid,text,uuid),public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text) from public,anon,authenticated;
grant execute on function public.icash_cancellation_provider_ready(uuid),public.icash_cancellation_preview(uuid,uuid,uuid),public.icash_request_cancellation(uuid,uuid,uuid,text,text,uuid,text),public.icash_record_cancellation_check(uuid,uuid,uuid,uuid,text,text,boolean),public.icash_finish_cancellation(uuid,uuid,uuid,boolean,text,text),public.icash_signing_action_allowed(uuid,uuid),public.icash_guard_cancelled_signing(),public.icash_guard_cancelled_deal(),public.icash_save_signing_status(uuid,text,jsonb),public.icash_buyer_outreach_held(uuid,uuid),public.icash_set_work_control(uuid,uuid,text,uuid),public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text) to service_role;
