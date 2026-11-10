-- Atomic owner demo restart: request identity, source-bound lifecycle retry accounting and sender readiness.
-- Apply only this bundle after PR654, inside the caller-owned transaction.
-- Supabase apply_migration owns BEGIN/body/receipt/COMMIT. For psql use --single-transaction.
-- Never install the component configs separately.

-- BEGIN COMPONENT: distinct-demo-submissions
-- Each intentional demo form submission is a new run. Only an exact retry of
-- the same request remains idempotent. Do not reset historical work or consent.
set local lock_timeout='3s';
set local statement_timeout='30s';

do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)'::regprocedure);
 needle:=$old$ perform pg_advisory_xact_lock(hashtextextended(p_duplicate,0));$old$;
 replacement:=$new$ -- Request identity, not address/phone identity, owns a demo run. Serialize
 -- retries even when a conflicting payload supplied a different duplicate key.
 perform pg_advisory_xact_lock(hashtextextended('demo-request:'||p_request::text,0));$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  definition:=replace(definition,needle,replacement);
 else raise exception 'Demo request lock prerequisite changed';end if;
 needle:=$old$ select id into canonical from public.icash_seller_intakes where duplicate_key=p_duplicate and state<>'duplicate'
  and public.icash_demo_intake_current(icash_seller_intakes.id,p_account)
  and created_at>now()-interval '90 days' order by created_at limit 1;$old$;
 replacement:=$new$ -- A new request ID explicitly starts a new demo, including the same
 -- address/phone while an earlier run is still visible. Prior receipts stay as-is.
 canonical:=null;$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  definition:=replace(definition,needle,replacement);
 else raise exception 'Demo submission deduplication prerequisite changed';end if;
 execute definition;
end $patch$;

do $patch$
declare definition text;target regprocedure;needle text;replacement text;
begin
 -- The current public RPC wraps the original finalizer for Meta promotion.
 -- Modify only the underlying duplicate predicate, preserving the wrapper.
 target:=to_regprocedure('public.icash_finish_seller_lookup_before_meta(uuid,uuid,jsonb)');
 if target is null then target:='public.icash_finish_seller_lookup(uuid,uuid,jsonb)'::regprocedure;
 elsif position('public.icash_finish_seller_lookup_before_meta(p_id,p_token,p_output)' in
  pg_get_functiondef('public.icash_finish_seller_lookup(uuid,uuid,jsonb)'::regprocedure))=0 then
  raise exception 'Seller lookup Meta wrapper prerequisite changed';
 end if;
 definition:=pg_get_functiondef(target);
 needle:=$old$and case when l.contact_consent_scope='icash_x_demo'
    then public.icash_demo_intake_current(candidate.id,(l.attribution->>'demoAccountId')::uuid)
    else candidate.contact_consent_scope is distinct from 'icash_x_demo' end$old$;
 replacement:=$new$and l.contact_consent_scope is distinct from 'icash_x_demo'
   and candidate.contact_consent_scope is distinct from 'icash_x_demo'$new$;
 if position(replacement in definition)>0 then null;
 elsif (length(definition)-length(replace(definition,needle,'')))/length(needle)=1 then
  execute replace(definition,needle,replacement);
 else raise exception 'Demo property deduplication prerequisite changed';end if;
end $patch$;
-- END COMPONENT: distinct-demo-submissions

-- BEGIN COMPONENT: owner-demo-run-lifecycle
-- Each new owner/self submission is a distinct run. Never rewrite a contact,
-- provider receipt, consent, request deadline, signed deal or financial ledger.
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Verified production definitions, 2026-11-10. Identity is installed earlier
-- in the same atomic bundle and owns the submission prerequisite separately.
do $preflight$
declare item record;begin
 for item in select * from (values
 ('public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)','50669f51a8ae2ba36c88e5158eec19d8'),
 ('public.icash_owner_demo_call_current(uuid,uuid)','71df0f873d79d97b1f2497eb8424e85c'),
 ('public.icash_sms_resolve_property(text,text,text)','878009a0e4516a901e3d0eb1f07d53e1'),
 ('public.icash_sms_message_route()','f9d2f04ed7e0dfe2e14cf095c5eee0c0')
 ) expected(signature,hash) loop
  if md5(pg_get_functiondef(item.signature::regprocedure))<>item.hash then
   raise exception 'Owner demo lifecycle predecessor changed: %',item.signature;end if;
 end loop;
end $preflight$;
create schema icash_demo_run_private;
revoke all on schema icash_demo_run_private from public,anon,authenticated;
grant usage on schema icash_demo_run_private to service_role;
create table icash_demo_run_private.runs(
 generation bigint generated always as identity primary key,
 lead_id uuid not null unique references public.icash_seller_intakes(id),
 request_id uuid not null unique,
 registered_at timestamptz not null default clock_timestamp(),
 activated_at timestamptz,
 retired_sources jsonb
);
alter table icash_demo_run_private.runs enable row level security;
revoke all on icash_demo_run_private.runs from public,anon,authenticated,service_role;
grant select on icash_demo_run_private.runs to service_role;
create function icash_demo_run_private.keep_run() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' or row(new.generation,new.lead_id,new.request_id,new.registered_at)
  is distinct from row(old.generation,old.lead_id,old.request_id,old.registered_at)
  or old.activated_at is not null or new.activated_at is null or new.retired_sources is null then
  raise exception 'Demo run boundary is immutable';end if;
 return new;
end $$;
create trigger keep_run before update or delete on icash_demo_run_private.runs for each row execute function icash_demo_run_private.keep_run();

create function icash_demo_run_private.source(p_account uuid,p_lead uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid and exists(
  select 1 from public.icash_seller_intakes l join public.icash_accounts a on a.id=p_account
  where l.id=p_lead and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
   and l.phone='+12142185280' and l.ai_consented and not l.owner_claimed
   and l.contact_consent_scope='icash_x_demo' and l.attribution->>'source'='icash_x_demo'
   and l.attribution->>'demoAccountId'=p_account::text
   and l.consent_version='icash-x-demo-contact-2026-10-10.1'
   and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id<>p_account)
 );
$$;
create function icash_demo_run_private.register(p_actor uuid,p_account uuid,p_lead uuid,p_request uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or not icash_demo_run_private.source(p_account,p_lead) then return;end if;
 -- Only the just-inserted request can enroll. Calling this on old evidence
 -- cannot turn it into a fresh run or change its original form-call deadline.
 if not exists(select 1 from public.icash_seller_intakes where id=p_lead and request_id=p_request and created_at=now() and state='received') then return;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 insert into icash_demo_run_private.runs(lead_id,request_id) values(p_lead,p_request) on conflict(lead_id) do nothing;
end $$;

-- Preserve historical money holds. Only a predecessor completing AFTER this
-- new request needs serial-queue settlement proof; calls already terminal when
-- the request was made retain the original owner's admission semantics.
create function icash_demo_run_private.calls_settled(p_lead uuid,p_job uuid default null) returns boolean
language sql volatile security definer set search_path='' as $$
 select exists(select 1 from public.icash_optin_call_requests request where request.lead_id=p_lead
  and request.phone='+12142185280' and request.source='demo_form'
  and request.account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  and not exists(select 1 from public.icash_call_recordings r
   where r.to_phone=request.phone and (p_job is null or r.voice_job_id is distinct from p_job)
    and not (r.call_ended_at is not null and r.call_ended_at<=request.requested_at
     or exists(select 1 from icash_recording_private.terminal_cost_receipts terminal
      where terminal.recording_id=r.id and terminal.created_at<=request.requested_at
       and terminal.receipt->>'callSid'=r.call_sid and terminal.receipt->>'providerAccountSid'=r.provider_account_sid
       and terminal.receipt->>'toPhone'=r.to_phone
       and terminal.receipt->>'status' in ('completed','failed','busy','no-answer','canceled')))
    and (not exists(select 1 from public.icash_operation_spend o where o.operation_key=r.operation_key
        and o.account_id=r.account_id and o.state='settled' and o.settled_at<=clock_timestamp())
     or not (r.call_ended_at is not null and r.call_ended_at<=clock_timestamp()
      or exists(select 1 from icash_recording_private.terminal_cost_receipts terminal
       where terminal.recording_id=r.id and terminal.created_at<=clock_timestamp()
        and terminal.receipt->>'callSid'=r.call_sid and terminal.receipt->>'providerAccountSid'=r.provider_account_sid
        and terminal.receipt->>'toPhone'=r.to_phone
        and terminal.receipt->>'status' in ('completed','failed','busy','no-answer','canceled')))))
   and not exists(select 1 from public.icash_customer_phone_calls c where c.recipient_phone=request.phone
    and (c.ended_at is null or c.ended_at>clock_timestamp()
     or c.ended_at>request.requested_at and (c.settled_at is null or c.settled_at>clock_timestamp())))
   and not exists(select 1 from icash_recorded_reception_private.sessions s where s.from_phone=request.phone
    and (s.call_ended_at is null or s.call_ended_at>clock_timestamp()
     or s.call_ended_at>request.requested_at and (s.settled_at is null or s.settled_at>clock_timestamp())))
   and not exists(select 1 from public.icash_live_conversations c
    where c.contact_key=encode(sha256(convert_to(request.phone,'UTF8')),'hex')
     and (p_job is null or c.operation_key<>'voice:'||p_job) and c.state<>'complete'));
$$;

create function icash_demo_run_private.activate(p_account uuid,p_lead uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare run icash_demo_run_private.runs;old_leads uuid[];screens uuid[];threads uuid[];permissions uuid[];snapshot jsonb;
begin
 if not icash_demo_run_private.source(p_account,p_lead) then return true;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(818,1);
 perform pg_advisory_xact_lock(hashtextextended('+12142185280',74));
 select * into run from icash_demo_run_private.runs where lead_id=p_lead for update;
 -- Old pre-release workflows keep their gates until a genuinely new submission.
 if not found then return not exists(select 1 from icash_demo_run_private.runs);end if;
 if exists(select 1 from icash_demo_run_private.runs where generation>run.generation) then return false;end if;
 if run.activated_at is not null then return true;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found or exists(select 1 from public.icash_text_suppressions where phone='+12142185280')
  or exists(select 1 from public.icash_webinar_phone_suppressions where phone='+12142185280')
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to('+12142185280','UTF8')),'hex')) then return false;end if;
 if not exists(select 1 from public.icash_seller_intakes l join public.icash_optin_call_requests r
   on r.lead_id=l.id and r.request_id=l.request_id and r.phone=l.phone
   where l.id=p_lead and l.state='assigned' and r.source='demo_form' and r.account_id=p_account
    and r.requested_by='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
    and r.request_version='icash-optin-call-now-2026-10-16.1' and r.request_reference=r.request_version
    and l.created_at<=r.requested_at and r.requested_at<=clock_timestamp()
    and r.expires_at=r.requested_at+interval '5 minutes' and r.expires_at>clock_timestamp()) then return false;end if;
 select coalesce(array_agg(l.id),'{}') into old_leads from public.icash_seller_intakes l
 left join icash_demo_run_private.runs old on old.lead_id=l.id
 where l.id<>p_lead and icash_demo_run_private.source(p_account,l.id)
  and (old.generation<run.generation or old.generation is null and l.created_at<=run.registered_at)
  and (not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id) and l.state in ('received','checking','qualified')
   or exists(select 1 from public.icash_seller_matches m join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
    where m.lead_id=l.id and m.account_id=p_account and s.state<>'archived'));
 select coalesce(array_agg(m.screening_id),'{}') into screens from public.icash_seller_matches m
  where m.lead_id=any(old_leads) and m.account_id=p_account;
 select coalesce(array_agg(t.id),'{}') into threads from public.icash_text_threads t
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  where t.account_id=p_account and t.seller_intake_id=any(old_leads) and d.screening_id=any(screens)
   and t.recipient='+12142185280' and t.party='seller' and t.owner_buyer_test_id is null;
 select coalesce(array_agg(p.id),'{}') into permissions from public.icash_contact_permissions p
  where p.account_id=p_account and p.seller_intake_id=any(old_leads) and p.screening_id=any(screens)
   and p.phone='+12142185280' and p.party='seller';
 -- All-or-nothing: an ongoing/unknown predecessor is never partly retired.
 if not icash_demo_run_private.calls_settled(p_lead) then return false;end if;
 if exists(select 1 from public.icash_seller_intakes l where l.id=any(old_leads) and l.state='checking')
  or exists(select 1 from public.icash_screening_jobs s where s.id=any(screens) and s.account_id=p_account and s.state not in ('complete','archived'))
  or exists(select 1 from public.icash_deal_files d join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id
   where d.account_id=p_account and d.screening_id=any(screens) and (e.state in ('creating','needs_review') or e.provider_id is null))
  or exists(select 1 from public.icash_seller_intakes l join public.icash_operation_spend o on o.operation_key=l.operation_key
   where l.id=any(old_leads) and o.state not in ('settled','cancelled'))
  or exists(select 1 from public.icash_seller_matches m join public.icash_operation_spend o on o.operation_key=m.operation_key
   where m.lead_id=any(old_leads) and o.state not in ('settled','cancelled'))
  or exists(select 1 from public.icash_voice_jobs j where j.account_id=p_account and j.permission_id=any(permissions)
   and (j.state='dispatching' or j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')
    or ((j.operation_key is not null or j.provider_call_sid is not null or j.conversation_id is not null or j.state='dispatched')
     and not exists(select 1 from public.icash_call_recordings r where r.voice_job_id=j.id and r.account_id=p_account))
    or (exists(select 1 from public.icash_operation_spend o where o.operation_key='voice:'||j.id and o.state not in ('settled','cancelled'))
     and not exists(select 1 from public.icash_call_recordings r where r.voice_job_id=j.id and r.account_id=j.account_id and r.call_ended_at<=clock_timestamp()))))
  or exists(select 1 from public.icash_text_messages m where m.account_id=p_account and m.thread_id=any(threads) and m.direction='outgoing'
   and (m.state not in ('ready','delivered','cancelled')
    or (m.state='cancelled' and m.provider_id is not null and m.last_delivery_at is null)
    or (m.state not in ('delivered','cancelled') and exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||m.id))
    or (m.state in ('accepted','delivered') and m.provider_id is null)))
  or exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=any(threads) and j.state in ('issued','analyzing'))
  or exists(select 1 from public.icash_automation_tickets t where t.account_id=p_account
    and (t.screening_id=any(screens) or t.voice_job_id in (select id from public.icash_voice_jobs where permission_id=any(permissions))
     or t.opener_message_id in (select id from public.icash_text_messages where thread_id=any(threads))
     or t.text_ai_job_id in (select id from public.icash_text_ai_jobs where thread_id=any(threads)))
    and t.state in ('issued','consumed') and (t.expires_at>clock_timestamp() or t.state='consumed' and t.completed_at is null))
 then return false;end if;
 snapshot:=jsonb_build_object('leadIds',old_leads,'screeningIds',screens,'threadIds',threads,'permissionIds',permissions);
 update public.icash_text_threads set paused=true,ai_mode='off',retired_at=coalesce(retired_at,clock_timestamp())
  where account_id=p_account and id=any(threads) and retired_at is null;
 update public.icash_contact_permissions set revoked_at=coalesce(revoked_at,clock_timestamp()) where account_id=p_account and id=any(permissions);
 update public.icash_text_messages m set state='cancelled',updated_at=now()
  where m.account_id=p_account and m.thread_id=any(threads) and m.direction='outgoing' and m.state='ready'
   and m.provider_id is null and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id);
 update public.icash_voice_jobs j set state='canceled',outcome='Superseded by a new owner self demo',updated_at=now()
  where j.account_id=p_account and j.permission_id=any(permissions) and j.state in ('ready','issued','held')
   and j.operation_key is null and j.provider_call_sid is null and j.conversation_id is null
   and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id)
   and not exists(select 1 from public.icash_call_recordings where voice_job_id=j.id);
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where account_id=p_account and thread_id=any(threads) and state in ('pending','drafted');
 update public.icash_live_callbacks set state='canceled' where account_id=p_account and screening_id=any(screens) and state in ('pending_dispatch_review','held_for_human');
 update public.icash_seller_responses set state='stopped',detail='Superseded by a new owner self demo',updated_at=now() where account_id=p_account and lead_id=any(old_leads) and screening_id=any(screens) and state<>'stopped';
 update public.icash_seller_gaps set state='suppressed',updated_at=now() where account_id=p_account and screening_id=any(screens) and state in ('open','queued','waiting','needs_review');
 update public.icash_screening_jobs set state='archived' where account_id=p_account and id=any(screens) and state='complete';
 update public.icash_seller_intakes set state='review',next_assignment_at='infinity',hold_reason='Superseded by a new owner self demo'
  where id=any(old_leads) and state<>'duplicate';
 update icash_demo_run_private.runs set activated_at=clock_timestamp(),retired_sources=snapshot where lead_id=p_lead;
 return true;
end $$;

create function icash_demo_run_private.current(p_lead uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from icash_demo_run_private.runs) or exists(
  select 1 from icash_demo_run_private.runs r where r.lead_id=p_lead and r.activated_at is not null
   and not exists(select 1 from icash_demo_run_private.runs newer where newer.generation>r.generation));
$$;

-- Enroll only a new insertion, after the unchanged exact-request retry return.
-- Lock order matches dispatch before the submit function takes account locks.
do $submit$
declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)'::regprocedure);
 needle:=' perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for share;';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo submit account boundary changed';end if;
 d:=replace(d,needle,E' perform 1 from public.icash_operating_budget where id=1 for update;\n'||needle);
 needle:=' return new_id;';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo submit new-request boundary changed';end if;
 execute replace(d,needle,E' perform icash_demo_run_private.register(p_actor,p_account,new_id,p_request);\n'||needle);
 d:=pg_get_functiondef('public.icash_prepare_seller_contacts(uuid,uuid,uuid,uuid)'::regprocedure);
 needle:=' if e is null then return;end if;';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo contact preparation boundary changed';end if;
 execute replace(d,needle,needle||E'\n if not icash_demo_run_private.activate(p_account,p_lead) then return;end if;');
end $submit$;

-- A new run may wait for its predecessor inside the ORIGINAL five-minute
-- request. A fresh final-dial check still requires terminal settled evidence.
do $voice$
declare d text;needle text;replacement text;begin
 d:=pg_get_functiondef('public.icash_owner_demo_call_current(uuid,uuid)'::regprocedure);
 needle:='   and not a.bot_paused and s.state=''complete'' and l.state=''assigned'' and l.ai_consented';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo final source boundary changed';end if;
 d:=replace(d,needle,needle||E'\n   and icash_demo_run_private.current(l.id)');
 foreach needle in array array['previous.call_ended_at>r.requested_at','terminal.created_at<=r.requested_at','manual.ended_at>r.requested_at'] loop
  if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo predecessor time boundary changed: %',needle;end if;
  replacement:=replace(needle,'r.requested_at','case when exists(select 1 from icash_demo_run_private.runs run where run.lead_id=l.id and run.activated_at is not null) then clock_timestamp() else r.requested_at end');
  d:=replace(d,needle,replacement);
 end loop;
 needle:='   and public.icash_seller_voice_permission_current(j.account_id,p.id)';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo permission boundary changed';end if;
 execute replace(d,needle,E'   and (not exists(select 1 from icash_demo_run_private.runs run where run.lead_id=l.id) or icash_demo_run_private.calls_settled(l.id,j.id))\n'||needle);
end $voice$;

-- Only an enrolled, safely activated self-demo pair can quarantine an
-- unidentified historical reply without holding an unrelated new run. No
-- foreign account, ordinary seller, buyer, existing review or active old thread
-- is eligible for this narrow message-level treatment.
create function icash_demo_run_private.isolated_pair(p_sender text,p_recipient text) returns boolean
language sql stable security definer set search_path='' as $$
 select p_recipient='+12142185280' and exists(
  select 1 from public.icash_sms_routes route
  join public.icash_text_threads current_thread on current_thread.sender=route.sender and current_thread.recipient=route.recipient
   and current_thread.account_id=route.account_id and current_thread.retired_at is null
  join icash_demo_run_private.runs run on run.lead_id=current_thread.seller_intake_id and run.activated_at is not null
  where route.sender=p_sender and route.recipient=p_recipient and not route.needs_review
   and route.account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
   and current_thread.party='seller' and current_thread.owner_buyer_test_id is null
   and icash_demo_run_private.source(current_thread.account_id,current_thread.seller_intake_id)
   and not exists(select 1 from icash_demo_run_private.runs newer where newer.generation>run.generation)
   and not exists(select 1 from public.icash_text_threads other
    left join public.icash_deal_files d on d.id=other.deal_id and d.account_id=other.account_id
    left join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
    where other.sender=p_sender and other.recipient=p_recipient and other.id<>current_thread.id
     and (other.account_id<>route.account_id or other.party<>'seller' or other.owner_buyer_test_id is not null
      or other.retired_at is null or sc.state is distinct from 'archived'
      or not icash_demo_run_private.source(other.account_id,other.seller_intake_id)))
 );
$$;

-- A generic reply cannot identify its run after same-number reuse. A unique
-- explicit address may identify a DIFFERENT property, but a repeated address
-- remains ambiguous even after the older thread is archived. Buyer tests and
-- unrelated workflows do not enter this owner seller-run exception.
do $incoming$
declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_sms_resolve_property(text,text,text)'::regprocedure);
 needle:='begin';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo incoming routing boundary changed';end if;
 execute replace(d,needle,needle||$guard$
 declare demo_matches integer;demo_chosen uuid;demo_normalized text:=public.icash_sms_normalize_address(p_body);
 begin
 if p_recipient='+12142185280'
  and not exists(select 1 from public.icash_owner_buyer_tests test where test.sender=p_sender and test.phone=p_recipient
   and public.icash_sms_thread_review_current(test.account_id,test.thread_id,false)
   and exists(select 1 from public.icash_text_messages sent where sent.thread_id=test.thread_id and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null))
  and exists(select 1 from public.icash_text_threads current_thread join icash_demo_run_private.runs run
   on run.lead_id=current_thread.seller_intake_id and run.activated_at is not null
   where current_thread.sender=p_sender and current_thread.recipient=p_recipient and current_thread.retired_at is null
    and current_thread.party='seller' and current_thread.owner_buyer_test_id is null
    and icash_demo_run_private.source(current_thread.account_id,current_thread.seller_intake_id)
    and not exists(select 1 from icash_demo_run_private.runs newer where newer.generation>run.generation))
  and exists(select 1 from public.icash_text_threads old join public.icash_text_messages sent on sent.thread_id=old.id and sent.account_id=old.account_id
   where old.sender=p_sender and old.recipient=p_recipient and old.retired_at is not null and old.party='seller'
    and icash_demo_run_private.source(old.account_id,old.seller_intake_id)
    and sent.direction='outgoing' and sent.provider_id is not null)
 then
  if not icash_demo_run_private.isolated_pair(p_sender,p_recipient) then return null;end if;
  select count(*),(array_agg(candidate.id))[1] into demo_matches,demo_chosen from (
   select t.id from public.icash_text_threads t join public.icash_deal_files deal on deal.id=t.deal_id and deal.account_id=t.account_id
   cross join lateral (select public.icash_sms_normalize_address(split_part(deal.terms->>'address',',',1)) address) address
   where t.sender=p_sender and t.recipient=p_recipient
    and (t.retired_at is null or exists(select 1 from public.icash_text_messages sent where sent.thread_id=t.id
     and sent.account_id=t.account_id and sent.direction='outgoing' and sent.provider_id is not null))
    and address.address ~ '^[0-9]+ [a-z0-9]+ [a-z0-9]+'
    and position(' '||address.address||' ' in ' '||demo_normalized||' ')>0
  ) candidate;
  return case when demo_matches=1 and exists(select 1 from public.icash_text_threads where id=demo_chosen and retired_at is null) then demo_chosen else null end;
 end if;
 end;
$guard$);
end $incoming$;
-- STOP is processed by ingestion before insertion. This guard only stores
-- the unbound reply for review; it creates no AI job, consent or property event,
-- and does not change the current run's route revision or existing decisions.
do $quarantine$
declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_sms_message_route()'::regprocedure);
 needle:=' elsif r.account_id is not null then';
 if array_length(string_to_array(d,needle),1)<>2 then raise exception 'Demo message review boundary changed';end if;
 execute replace(d,needle,$guard$
 elsif new.direction='incoming' and new.thread_id is null
  and icash_demo_run_private.isolated_pair(pair_sender,pair_recipient) then
  new.account_id:=r.account_id;new.state:='needs_review';new.route_revision:=null;return new;
 elsif r.account_id is not null then$guard$);
end $quarantine$;
revoke all on all functions in schema icash_demo_run_private from public,anon,authenticated,service_role;
grant execute on function icash_demo_run_private.register(uuid,uuid,uuid,uuid),icash_demo_run_private.activate(uuid,uuid),
 icash_demo_run_private.isolated_pair(text,text),icash_demo_run_private.current(uuid),icash_demo_run_private.calls_settled(uuid,uuid),icash_demo_run_private.source(uuid,uuid) to service_role;
-- END COMPONENT: owner-demo-run-lifecycle

-- BEGIN COMPONENT: bot-demo-retry-accounting
-- Count new demo intents, never exact transport retries. The existing five per
-- hour IP/user buckets remain intact, including pre-release usage. This wrapper
-- is installed in the same transaction as the owner demo restart components.
set local lock_timeout='3s';
set local statement_timeout='30s';

create or replace function public.icash_submit_limited_bot_demo_intake(
 p_actor uuid,p_account uuid,p_request uuid,p_guest text,p_name text,p_address text,
 p_phone text,p_consented boolean,p_duplicate text,p_timezone text,p_agent_hash text,p_ip_hash text)
returns uuid language plpgsql security invoker set search_path='' as $demo$
declare existing_request boolean;
begin
 -- Only the existing authenticated presenter route uses this admission path.
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or p_account is distinct from '48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  or p_request is null or p_ip_hash is null or p_ip_hash!~'^[a-f0-9]{64}$'
 then raise exception 'Presenting account required';end if;
 -- Match lifecycle/direct-submit lock order. Never hold a request lock while
 -- waiting for a dispatcher that owns the operating budget first.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then raise exception 'Demo admission unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('demo-request:'||p_request::text,0));
 select exists(select 1 from public.icash_seller_intakes where request_id=p_request) into existing_request;
 if not existing_request then
  if not public.icash_take_request('bot-demo:ip:'||p_ip_hash,5,3600)
   or not public.icash_take_request('bot-demo:id:'||encode(sha256(convert_to(p_actor::text,'UTF8')),'hex'),5,3600)
  then
   -- Uncaught exception rolls back BOTH counters. No intake or lifecycle run
   -- has been created, and no after-response/provider work can be scheduled.
   raise sqlstate 'PT429' using message='Demo submission limit reached';
  end if;
 end if;
 -- Existence is accounting input, never retry authority. The original RPC
 -- still validates account ownership, guest, complete consent and payload.
 -- A conflicting retry or failed insertion rolls back this whole transaction.
 return public.icash_submit_bot_demo_intake(p_actor,p_account,p_request,p_guest,p_name,p_address,
  p_phone,p_consented,p_duplicate,p_timezone,p_agent_hash);
end $demo$;
revoke all on function public.icash_submit_limited_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_submit_limited_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text,text) to service_role;
-- END COMPONENT: bot-demo-retry-accounting

-- BEGIN COMPONENT: owner-demo-confirmed-sender
-- Prefer recently proven transport for the owner's fresh, self-addressed demo.
-- Selection never sends, rebinds a conversation, enables a line or renews consent.
set local lock_timeout='5s';
set local statement_timeout='30s';

create index if not exists icash_demo_sender_completed_calls on public.icash_call_recordings(from_phone,call_ended_at desc)
 where call_sid is not null and provider_started_at is not null and call_ended_at is not null;

-- Ranking is more conservative than ordinary five-minute probe admission.
-- Keep a signed, exactly bound recent delay behind healthy alternatives until a
-- later-dispatched message is confirmed delivered or the one-hour notice ages out.
-- This helper does not change the existing sender-opener admission policy.
create or replace function public.icash_owner_demo_sender_recovered(p_sender text) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
declare delayed_epoch numeric;delayed_at timestamptz;
begin
 select (e.payload->>'timestamp')::numeric into delayed_epoch
 from public.icash_text_events e
 join public.icash_text_messages m on m.provider_id=e.payload#>>'{data,affected_id}' and m.direction='outgoing'
 join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.sender=p_sender
 join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
 where e.type='numbers.delayed' and e.payload->>'type'=e.type and e.payload->>'id'=e.id
  and e.payload#>>'{data,reason}'='number_temporary_unavailable'
  and e.payload#>>'{data,original_number}'=p_sender and jsonb_typeof(e.payload->'timestamp')='number'
  and (e.payload->>'timestamp')::numeric between extract(epoch from now()-interval '1 hour') and extract(epoch from now()+interval '5 seconds')
  and o.dispatched_at between now()-interval '1 hour' and now()
  and extract(epoch from o.dispatched_at)<=(e.payload->>'timestamp')::numeric+5
 order by (e.payload->>'timestamp')::numeric desc limit 1;
 if not found then return true;end if;
 delayed_at:=to_timestamp(delayed_epoch::double precision);
 return exists(select 1 from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.sender=p_sender
  join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where m.direction='outgoing' and m.state='delivered' and m.provider_id is not null
   and m.last_delivery_at between delayed_at and now()+interval '5 seconds'
   and o.dispatched_at between delayed_at and now() and o.dispatched_at<=m.last_delivery_at+interval '5 seconds');
end $fn$;
revoke all on function public.icash_owner_demo_sender_recovered(text) from public,anon,authenticated;
grant execute on function public.icash_owner_demo_sender_recovered(text) to service_role;

-- Lexicographic evidence, not a predicted success rate: current delay readiness,
-- confirmations on the less-observed channel, then total confirmations. Counts
-- are bounded at 500 per channel and expire after seven days. Accepted-only SMS,
-- unstarted/unfinished calls and unrelated/missing dispatch receipts earn nothing.
-- Source uniqueness (provider ID, provider account + call SID, operation key)
-- makes the LIMIT a physical sample cap without a pre-LIMIT distinct sort.
-- Primary-line calls lack a current registry identity and earn no call score.
create or replace function public.icash_owner_demo_sender_rank(p_sender text) returns bigint[]
language sql stable security invoker set search_path='' as $$
 with sms as (
  select count(distinct recent.provider_id)::bigint n from (
   select m.provider_id
   from public.icash_text_messages m
   join public.icash_non_test_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
   where t.sender=p_sender and m.direction='outgoing' and m.state='delivered' and m.provider_id is not null
    and m.last_delivery_at between now()-interval '7 days' and now()
    and o.dispatched_at between now()-interval '7 days' and m.last_delivery_at
   limit 500
  ) recent
 ), calls as (
  select count(distinct recent.call_sid)::bigint n from (
   select r.call_sid
   from public.icash_call_recordings r
   join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=r.account_id
   where r.from_phone=p_sender and r.call_sid is not null and r.provider_started_at is not null
    and r.call_ended_at between now()-interval '7 days' and now()
    and r.provider_started_at between now()-interval '7 days' and r.call_ended_at
    and o.dispatched_at between now()-interval '7 days' and r.provider_started_at
    and r.provider_account_sid is not null
    and exists(select 1 from public.icash_business_voice_numbers n
     where n.phone=p_sender and n.provider_account_sid=r.provider_account_sid and n.caller_id_sid=r.caller_id_sid)
   limit 500
  ) recent
 )
 select array[case when public.icash_owner_demo_sender_recovered(p_sender) then 1 else 0 end::bigint,
  least(sms.n,calls.n),sms.n+calls.n] from sms cross join calls;
$$;
revoke all on function public.icash_owner_demo_sender_rank(text) from public,anon,authenticated;
grant execute on function public.icash_owner_demo_sender_rank(text) to service_role;

do $ranking$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure);
 if strpos(d,'owner_demo_confirmed_sender_v1')>0 then return;end if;
 if strpos(d,'owner_demo_call_capable_v1')=0 then raise exception 'Owner demo call-capable predecessor required';end if;
 needle:='require_voice boolean:=p_voice;';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking declaration changed';end if;
 d:=replace(d,needle,needle||' prefer_confirmed boolean:=false;');
 needle:=' select s.phone into chosen from public.icash_text_senders s';
 replacement:=$new$ -- owner_demo_confirmed_sender_v1: existing exact threads and any call history retain priority.
 prefer_confirmed:=chosen is null
  and p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid and p_recipient='+12142185280'
  and public.icash_outreach_voice_current(p_account)
  and exists(
   select 1 from public.icash_accounts a
   join public.icash_seller_intakes l on l.assigned_account=a.id and l.screening_id=p_screening
   join public.icash_seller_matches m on m.lead_id=l.id and m.account_id=a.id and m.screening_id=l.screening_id
   join public.icash_optin_call_requests r on r.lead_id=l.id and r.request_id=l.request_id and r.phone=l.phone
   where a.id=p_account and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
    and not a.bot_paused and l.phone=p_recipient and l.state='assigned' and l.ai_consented
    and l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=a.id::text
    and r.source='demo_form' and r.account_id=a.id and r.requested_by=a.owner_user_id
    and r.request_version='icash-optin-call-now-2026-10-16.1' and r.request_reference=r.request_version
    and l.created_at<=r.requested_at and r.requested_at<=now()
    and r.expires_at=r.requested_at+interval '5 minutes' and r.expires_at>now()
  );
 select s.phone into chosen from public.icash_text_senders s$new$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking allocation changed';end if;
 d:=replace(d,needle,replacement);
 needle:='and (chosen is null or s.phone=chosen)';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking pool changed';end if;
 d:=replace(d,needle,'and (not prefer_confirmed or s.enabled) '||needle);
 needle:='order by encode(sha256(convert_to(p_account::text';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking order changed';end if;
 replacement:='order by case when prefer_confirmed then public.icash_owner_demo_sender_rank(s.phone) end desc nulls last,'||chr(10)||'  encode(sha256(convert_to(p_account::text';
 execute replace(d,needle,replacement);
end $ranking$;
-- END COMPONENT: owner-demo-confirmed-sender
