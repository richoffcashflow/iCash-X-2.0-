-- Original-provider receipt observation only. No create/sign/replay or money settlement.
-- Caller atomically owns the function changes and migration-ledger receipt.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $guard$
declare d text;item record;p record;
begin
 for item in select * from (values
  ('public.icash_issue_due_signing_result()','e676da31fb3444893a4cc5e92fd8cb4b','v'),
  ('public.icash_claim_signing_poll(uuid,uuid)','e63f633daca865ecfda0a757cd8ec4a6','v'),
  ('public.icash_save_signing_status(uuid,text,jsonb)','e1dc6602dd98cb045da1a7845c3c4a28','v'),
  ('public.icash_signing_action_allowed(uuid,uuid)','0c8dd6053164498e0f2e400d8e55d3b7','s')
 ) expected(signature,hash,volatility) loop
  select * into p from pg_proc where oid=item.signature::regprocedure;
  if md5(pg_get_functiondef(p.oid)) is distinct from item.hash or pg_get_userbyid(p.proowner)<>'postgres'
   or p.prosecdef or p.provolatile::text<>item.volatility or p.proparallel<>'u'
   or p.proconfig is distinct from array['search_path=""'] or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  then raise exception 'Signing receipt predecessor source or metadata changed: %',item.signature;end if;
 end loop;
 select pg_get_constraintdef(oid) into strict d from pg_constraint where conrelid='public.icash_automation_tickets'::regclass and conname='icash_automation_tickets_kind_check';
 if md5(d) is distinct from 'bd136483bfd89d75683dd52b0b814c68' then raise exception 'Signing receipt ticket kinds changed';end if;
 lock table public.icash_automation_tickets in access exclusive mode nowait;
 alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
 execute 'alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check (kind=''signing_receipt'' or '||substr(d,7)||')';
end $guard$;

create schema icash_signing_receipt_private;
revoke all on schema icash_signing_receipt_private from public,anon,authenticated;
grant usage on schema icash_signing_receipt_private to service_role;
create table icash_signing_receipt_private.turn(id int primary key check(id=1),recovery boolean not null default false);
insert into icash_signing_receipt_private.turn values(1,false);
create table icash_signing_receipt_private.checkpoints(
 envelope_id uuid primary key references public.icash_signing_envelopes(id),account_id uuid not null,provider_id text not null,
 source jsonb not null,template_source jsonb not null,version text not null check(version='post_create_check_v1'),recorded_at timestamptz not null default now(),invalidated_at timestamptz,resolved_at timestamptz
);
create table icash_signing_receipt_private.observations(
 id uuid primary key default gen_random_uuid(),envelope_id uuid not null references public.icash_signing_envelopes(id),account_id uuid not null,
 provider_id text not null,terms_hash text not null,receipt_hash text not null,evidence jsonb not null,observed_state text not null,
 terminal boolean not null,observed_at timestamptz not null default now(),unique(envelope_id,provider_id,terms_hash,receipt_hash)
);
create index signing_terminal_receipts on icash_signing_receipt_private.observations(envelope_id,provider_id,terms_hash) where terminal;
create function icash_signing_receipt_private.immutable_evidence() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='checkpoints' and tg_op='UPDATE' then
  if row(new.envelope_id,new.account_id,new.provider_id,new.source,new.template_source,new.version,new.recorded_at)
   is not distinct from row(old.envelope_id,old.account_id,old.provider_id,old.source,old.template_source,old.version,old.recorded_at)
   and (old.invalidated_at is null or new.invalidated_at=old.invalidated_at) and (old.resolved_at is null or new.resolved_at=old.resolved_at) then return new;end if;
 end if;
 raise exception 'Original signing evidence is immutable';
end $$;
create trigger signing_checkpoint_immutable before update or delete on icash_signing_receipt_private.checkpoints for each row execute function icash_signing_receipt_private.immutable_evidence();
create trigger signing_observation_immutable before update or delete on icash_signing_receipt_private.observations for each row execute function icash_signing_receipt_private.immutable_evidence();
alter table icash_signing_receipt_private.turn enable row level security;
alter table icash_signing_receipt_private.checkpoints enable row level security;
alter table icash_signing_receipt_private.observations enable row level security;
revoke all on all tables in schema icash_signing_receipt_private from public,anon,authenticated;
grant select,update on icash_signing_receipt_private.turn to service_role;
grant select on icash_signing_receipt_private.observations to service_role;

create function icash_signing_receipt_private.source(e public.icash_signing_envelopes) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(e)-array['state','updated_at','next_poll_at','last_poll_at'];
$$;
create function icash_signing_receipt_private.invalidate_checkpoint() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update icash_signing_receipt_private.checkpoints set invalidated_at=coalesce(invalidated_at,clock_timestamp()) where envelope_id=new.id and resolved_at is null;
 return new;
end $$;
create trigger icash_invalidate_signing_checkpoint after update of state,account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,requested_by,provider_id,provider_status,provider_evidence
 on public.icash_signing_envelopes for each row execute function icash_signing_receipt_private.invalidate_checkpoint();

-- Prospective evidence only: called solely after saved provider ID acknowledgement,
-- when the next cancellation-check read itself throws. No historical backfill.
create function public.icash_note_signing_checkpoint_failure(p_account uuid,p_envelope uuid,p_provider text,p_hash text,p_template jsonb,p_original jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare e public.icash_signing_envelopes;t public.icash_signing_templates;
begin
 select * into e from public.icash_signing_envelopes where id=p_envelope and account_id=p_account for update;
 if not found or e.state<>'awaiting_counterparty' or e.provider_id is distinct from p_provider or e.terms_hash is distinct from p_hash
  or e.provider_status is distinct from 'Created' or e.provider_evidence is not null
  or p_original->>'state' is distinct from 'creating' or p_original->'provider_id' is distinct from 'null'::jsonb
  or (icash_signing_receipt_private.source(e)-array['provider_id','provider_status','provider_evidence'])
   is distinct from (p_original-array['state','updated_at','next_poll_at','last_poll_at','provider_id','provider_status','provider_evidence'])
  or exists(select 1 from icash_signing_receipt_private.checkpoints where envelope_id=e.id) then return false;end if;
 select * into t from public.icash_signing_templates where id=e.template_id for share;
 if not found or to_jsonb(t) is distinct from p_template then return false;end if;
 update public.icash_signing_envelopes set state='needs_review',updated_at=clock_timestamp() where id=e.id;
 insert into icash_signing_receipt_private.checkpoints(envelope_id,account_id,provider_id,source,template_source,version)
 values(e.id,e.account_id,e.provider_id,icash_signing_receipt_private.source(e),p_template,'post_create_check_v1');
 return true;
end $$;

create function public.icash_record_signing_receipt(p_account uuid,p_envelope uuid,p_provider text,p_hash text,p_state text,p_evidence jsonb,p_terminal boolean default false) returns text
language plpgsql security definer set search_path='' as $$
declare e public.icash_signing_envelopes;c icash_signing_receipt_private.checkpoints;d public.icash_deal_files;resume boolean:=false;
begin
 -- Retain existing saver/cancellation lock order and re-read original bindings.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict e from public.icash_signing_envelopes where id=p_envelope and account_id=p_account;
 select * into d from public.icash_deal_files where id=e.deal_id and account_id=e.account_id for share;
 select * into strict e from public.icash_signing_envelopes where id=p_envelope and account_id=p_account for update;
 if e.provider_id is distinct from p_provider or e.terms_hash is distinct from p_hash or p_provider is null or p_hash is null
  or p_state not in ('awaiting_counterparty','customer_signature_needed','completed','test_completed','needs_review')
  or p_evidence->>'id' is distinct from e.provider_id or p_evidence->'test_mode' is distinct from to_jsonb(e.test_mode)
  or p_evidence->'metadata'->>'icash_envelope' is distinct from e.id::text or p_evidence->'metadata'->>'terms_hash' is distinct from e.terms_hash
  or p_evidence->'apply_signing_order' is distinct from 'true'::jsonb or jsonb_typeof(p_evidence->'recipients') is distinct from 'array'
  or octet_length(p_evidence::text)>262144 then raise exception 'Original signing receipt binding required';end if;
 if jsonb_array_length(p_evidence->'recipients')<>jsonb_array_length(e.recipients) or exists(
  select 1 from jsonb_array_elements(e.recipients) with ordinality r(v,n)
  where not exists(select 1 from jsonb_array_elements(p_evidence->'recipients') x where x->>'id'=r.v->>'id' and x->>'signing_order'=r.n::text
   and case when nullif(r.v->>'phone','') is not null then x->>'phone'=r.v->>'phone' else lower(x->>'email')=lower(r.v->>'email') end)
 ) then raise exception 'Original signing recipient binding required';end if;
 if p_terminal and (p_state<>'needs_review' or p_evidence->>'status' not in ('Declined','Expired','Archived')) then raise exception 'Known terminal signing receipt required';end if;
 if p_state in ('completed','test_completed') and (p_evidence->>'status'<>'Completed' or (p_state='test_completed') is distinct from e.test_mode
  or exists(select 1 from jsonb_array_elements(p_evidence->'recipients') r where r->>'status' is distinct from 'signed')) then raise exception 'Original completed signing receipt required';end if;
 insert into icash_signing_receipt_private.observations(envelope_id,account_id,provider_id,terms_hash,receipt_hash,evidence,observed_state,terminal)
 values(e.id,e.account_id,e.provider_id,e.terms_hash,md5(p_evidence::text||p_state||p_terminal::text),p_evidence,p_state,p_terminal) on conflict do nothing;
 if e.state in ('cancellation_pending','cancelled') then
  perform public.icash_save_signing_status(e.id,p_state,p_evidence);return e.state;
 end if;
 if e.state in ('completed','test_completed') then return e.state;end if;
 if e.state='needs_review' then
  select * into c from icash_signing_receipt_private.checkpoints where envelope_id=e.id for update;
  if c.envelope_id is not null and c.invalidated_at is null and c.resolved_at is null and c.version='post_create_check_v1'
   and c.account_id=e.account_id and c.provider_id=e.provider_id and c.source=icash_signing_receipt_private.source(e)
   and not p_terminal and p_state<>'needs_review' then
   -- Merely observing a provider ID never clears a review. Re-check current
   -- controls/terms/template before restoring this exact prospective checkpoint.
   perform 1 from public.icash_accounts where id=e.account_id and owner_user_id=e.requested_by and not bot_paused for share;
   if found then
    perform 1 from public.icash_signing_templates where id=e.template_id for share;
    perform 1 from public.icash_property_controls pc join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=e.account_id where pc.account_id=e.account_id and pc.property_id=j.snapshot->>'propertyId' for share of pc,j;
    if d.terms=e.terms and public.icash_signing_action_allowed(e.account_id,e.id)
     and exists(select 1 from public.icash_signing_templates where id=e.template_id and provider='docuseal' and enabled and reviewed_until>clock_timestamp() and to_jsonb(icash_signing_templates)=c.template_source)
     and exists(select 1 from public.icash_screening_jobs where id=d.screening_id and account_id=e.account_id)
     and not exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs j on j.id=d.screening_id and j.account_id=e.account_id where pc.account_id=e.account_id and pc.property_id=j.snapshot->>'propertyId' and pc.manual)
     and (e.test_mode or exists(select 1 from public.icash_operation_spend where account_id=e.account_id and operation_key='signing:'||e.id and state in ('dispatched','settled'))) then resume:=true;end if;
   end if;
  end if;
  if not resume then return 'needs_review';end if;
  update icash_signing_receipt_private.checkpoints set resolved_at=clock_timestamp() where envelope_id=e.id;
 end if;
 if e.state not in ('awaiting_counterparty','customer_signature_needed','needs_review') then return e.state;end if;
 perform public.icash_save_signing_status(e.id,p_state,p_evidence);
 return (select state from public.icash_signing_envelopes where id=e.id);
end $$;

-- A distinct capability is safe during rolling deployment: old handlers hold an
-- unknown kind instead of routing review evidence through signature authority.
create or replace function public.icash_issue_due_signing_result() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_signing_envelopes;t public.icash_automation_tickets;last_recovery boolean;wanted boolean;attempt integer;
begin
 select recovery into last_recovery from icash_signing_receipt_private.turn where id=1 for update skip locked;
 if not found then return null;end if;
 for attempt in 0..1 loop
  wanted:=case when attempt=0 then not last_recovery else last_recovery end;
  select s.* into e from public.icash_signing_envelopes s
  where s.state in ('awaiting_counterparty','customer_signature_needed','needs_review') and s.provider_id is not null and s.next_poll_at<=clock_timestamp()
   and (s.state='needs_review' or s.created_at<=clock_timestamp()-interval '45 days')=wanted
   and not exists(select 1 from icash_signing_receipt_private.observations o where o.envelope_id=s.id and o.provider_id=s.provider_id and o.terms_hash=s.terms_hash and o.terminal)
  order by s.next_poll_at,s.created_at,s.id for update of s skip locked limit 1;
  if found then
   update public.icash_signing_envelopes set next_poll_at=clock_timestamp()+interval '10 minutes' where id=e.id;
   update icash_signing_receipt_private.turn set recovery=wanted where id=1;
   insert into public.icash_automation_tickets(account_id,kind,signing_id) values(e.account_id,case when wanted then 'signing_receipt' else 'signing_result' end,e.id) returning * into t;
   return jsonb_build_object('token',t.token);
  end if;
 end loop;
 return null;
end $$;
create index icash_signing_review_due on public.icash_signing_envelopes(next_poll_at,created_at,id) where state='needs_review' and provider_id is not null;
revoke all on all functions in schema icash_signing_receipt_private from public,anon,authenticated;
grant execute on function icash_signing_receipt_private.source(public.icash_signing_envelopes),icash_signing_receipt_private.invalidate_checkpoint() to service_role;
revoke all on function public.icash_note_signing_checkpoint_failure(uuid,uuid,text,text,jsonb,jsonb),public.icash_record_signing_receipt(uuid,uuid,text,text,text,jsonb,boolean),public.icash_issue_due_signing_result() from public,anon,authenticated;
grant execute on function public.icash_note_signing_checkpoint_failure(uuid,uuid,text,text,jsonb,jsonb),public.icash_record_signing_receipt(uuid,uuid,text,text,text,jsonb,boolean),public.icash_issue_due_signing_result() to service_role;

do $postconditions$
declare item record;p record;
begin
 for item in select * from (values
  ('public.icash_issue_due_signing_result()','ac6227d7393013208c2d346184eef05d',false,'v'),
  ('public.icash_note_signing_checkpoint_failure(uuid,uuid,text,text,jsonb,jsonb)','54aa72d684332b53b8e623e741e83be1',true,'v'),
  ('public.icash_record_signing_receipt(uuid,uuid,text,text,text,jsonb,boolean)','ce1bc2d8a75fa768041a8cb63115220b',true,'v'),
  ('public.icash_claim_signing_poll(uuid,uuid)','e63f633daca865ecfda0a757cd8ec4a6',false,'v'),
  ('public.icash_save_signing_status(uuid,text,jsonb)','e1dc6602dd98cb045da1a7845c3c4a28',false,'v'),
  ('public.icash_signing_action_allowed(uuid,uuid)','0c8dd6053164498e0f2e400d8e55d3b7',false,'s')
 ) expected(signature,hash,definer,volatility) loop
  select * into p from pg_proc where oid=item.signature::regprocedure;
  if md5(pg_get_functiondef(p.oid)) is distinct from item.hash or pg_get_userbyid(p.proowner)<>'postgres'
   or p.prosecdef is distinct from item.definer or p.provolatile::text<>item.volatility or p.proparallel<>'u'
   or p.proconfig is distinct from array['search_path=""'] or p.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}'
  then raise exception 'Signing receipt postcondition failed: %',item.signature;end if;
 end loop;
end $postconditions$;
