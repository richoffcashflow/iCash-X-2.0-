-- Service-reviewed, complete cost breakdowns; an LLM or customer cannot settle spending.
create table public.icash_cost_manifests (
 operation_key text primary key references public.icash_operation_spend(operation_key),
 charge_cents bigint not null check(charge_cents>=0),actual_micros bigint not null check(actual_micros>=0),
 components jsonb not null,evidence_ref text not null,created_at timestamptz not null default now()
);
alter table public.icash_cost_manifests enable row level security;
revoke all on public.icash_cost_manifests from public,anon,authenticated,service_role;
grant select,insert on public.icash_cost_manifests to service_role;
create function public.icash_settle_complete_costs(p_operation text,p_charge bigint,p_components jsonb,p_evidence text) returns void language plpgsql set search_path='' as $$
declare cat text;n numeric;total numeric:=0;old public.icash_cost_manifests;
begin
 if p_evidence is null or length(trim(p_evidence))<10 or p_charge is null or p_charge<0 or jsonb_typeof(p_components) is distinct from 'object' then raise exception 'Verified complete cost evidence required';end if;
 if (select count(*) from jsonb_object_keys(p_components))<>16 then raise exception 'All cost categories required';end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(p_components->cat->'amountMicros') is distinct from 'number' or jsonb_typeof(p_components->cat->'evidenceRef') is distinct from 'string' or length(trim(p_components->cat->>'evidenceRef'))<10 then raise exception 'Verified cost category required: %',cat;end if;
  n:=(p_components->cat->>'amountMicros')::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost';end if;
  total:=total+n;
 end loop;
 if total>9007199254740991 then raise exception 'Cost total out of range';end if;
 -- Ledger lock first, matching reserve/settle lock order.
 perform 1 from public.icash_operating_budget where id=1 for update;
 insert into public.icash_cost_manifests(operation_key,charge_cents,actual_micros,components,evidence_ref) values(p_operation,p_charge,total,p_components,p_evidence) on conflict do nothing;
 select * into strict old from public.icash_cost_manifests where operation_key=p_operation;
 if row(old.charge_cents,old.actual_micros,old.components,old.evidence_ref) is distinct from row(p_charge,total::bigint,p_components,p_evidence) then raise exception 'Cost manifest conflict';end if;
 perform public.icash_settle_operation(p_operation,p_charge,total::bigint,p_evidence);
end $$;
revoke all on function public.icash_settle_complete_costs(text,bigint,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_settle_complete_costs(text,bigint,jsonb,text) to service_role;

create table public.icash_buyer_profiles (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 entity_key text not null,display_name text not null,criteria jsonb not null,
 source_ref text not null check(length(source_ref)>10),updated_at timestamptz not null default now(),unique(account_id,entity_key)
);
create table public.icash_disposition_authorities (
 deal_id uuid primary key references public.icash_deal_files(id),account_id uuid not null references public.icash_accounts(id),
 purchase_envelope_id uuid not null references public.icash_signing_envelopes(id),
 market text not null,property_type text not null check(property_type in ('house','land')),
 asking_price_cents bigint not null check(asking_price_cents>0),repairs_cents bigint not null check(repairs_cents>=0),
 retain_credit_cents bigint not null default 0 check(retain_credit_cents>=0),
 marketing_evidence text not null check(length(marketing_evidence)>10),expires_at timestamptz not null
);
create table public.icash_fulfillment_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 deal_id uuid not null unique references public.icash_deal_files(id),purchase_envelope_id uuid not null references public.icash_signing_envelopes(id),
 state text not null default 'ready' check(state in ('ready','issued','complete','held')),
 result jsonb,updated_at timestamptz not null default now()
);
create table public.icash_buyer_matches (
 deal_id uuid not null references public.icash_deal_files(id),buyer_id uuid not null references public.icash_buyer_profiles(id),
 score integer not null,ready boolean not null,rank integer not null,source_ref text not null,
 created_at timestamptz not null default now(),primary key(deal_id,buyer_id)
);
alter table public.icash_deal_documents add column fulfillment_job_id uuid references public.icash_fulfillment_jobs(id);
create unique index icash_fulfillment_document_once on public.icash_deal_documents(fulfillment_job_id,kind) where fulfillment_job_id is not null;
alter table public.icash_buyer_profiles enable row level security;
alter table public.icash_disposition_authorities enable row level security;
alter table public.icash_fulfillment_jobs enable row level security;
alter table public.icash_buyer_matches enable row level security;
revoke all on public.icash_buyer_profiles,public.icash_disposition_authorities,public.icash_fulfillment_jobs,public.icash_buyer_matches from public,anon,authenticated;
grant all on public.icash_buyer_profiles,public.icash_disposition_authorities,public.icash_fulfillment_jobs,public.icash_buyer_matches to service_role;
create function public.icash_queue_fulfillment() returns void language plpgsql set search_path='' as $$
begin
 insert into public.icash_fulfillment_jobs(account_id,deal_id,purchase_envelope_id)
 select d.account_id,d.id,e.id from public.icash_deal_files d join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id and e.kind='purchase' and e.state='completed' and not e.test_mode
 where d.stage in ('under_contract','buyer_selected','title_open','closing') and not exists(select 1 from public.icash_fulfillment_jobs j where j.deal_id=d.id) order by d.updated_at limit 100 on conflict do nothing;
 update public.icash_fulfillment_jobs j set state='ready',updated_at=now() from public.icash_deal_files d where d.id=j.deal_id and d.stage in ('under_contract','buyer_selected','title_open','closing') and j.state='complete' and (j.updated_at<now()-interval '1 day' or exists(select 1 from public.icash_disposition_authorities a where a.deal_id=d.id and a.account_id=j.account_id and a.purchase_envelope_id=j.purchase_envelope_id and a.expires_at>now() and j.result->>'buyerStatus'='marketing_review_required'));
 update public.icash_fulfillment_jobs set state='ready',updated_at=now() where state='issued' and updated_at<now()-interval '5 minutes';
end $$;
-- Pure preparation may safely retry: documents and matches have unique persistence keys.
create function public.icash_save_fulfillment(p_job uuid,p_result jsonb,p_documents jsonb,p_matches jsonb) returns void language plpgsql set search_path='' as $$
declare j public.icash_fulfillment_jobs;d public.icash_deal_files;item jsonb;
begin
 select * into strict j from public.icash_fulfillment_jobs where id=p_job for update;
 if j.state='complete' then return;end if;
 if j.state<>'issued' or jsonb_typeof(p_documents) is distinct from 'array' or jsonb_typeof(p_matches) is distinct from 'array' or jsonb_array_length(p_matches)>50 then raise exception 'Invalid preparation';end if;
 select * into strict d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for update;
 if d.stage not in ('under_contract','buyer_selected','title_open','closing') or not exists(select 1 from public.icash_signing_envelopes where id=j.purchase_envelope_id and deal_id=d.id and account_id=d.account_id and kind='purchase' and state='completed' and not test_mode) then raise exception 'Signed purchase required';end if;
 if exists(select 1 from public.icash_accounts where id=j.account_id and bot_paused) or exists(select 1 from public.icash_property_controls c join public.icash_screening_jobs s on s.id=d.screening_id where c.account_id=j.account_id and c.property_id=s.snapshot->>'propertyId' and c.manual) then raise exception 'Work paused';end if;
 for item in select value from jsonb_array_elements(p_documents) loop
  if item->>'kind' not in ('buyer_package','title_packet') then raise exception 'Preparation cannot sign';end if;
  insert into public.icash_deal_documents(deal_id,kind,terms,html,fulfillment_job_id) values(d.id,item->>'kind',d.terms,item->>'html',j.id) on conflict (fulfillment_job_id,kind) where fulfillment_job_id is not null do update set html=excluded.html,terms=excluded.terms;
 end loop;
 if jsonb_array_length(p_matches)>0 and not exists(select 1 from public.icash_disposition_authorities where deal_id=d.id and account_id=j.account_id and purchase_envelope_id=j.purchase_envelope_id and expires_at>now()) then raise exception 'Current marketing authority required';end if;
 delete from public.icash_buyer_matches where deal_id=d.id;
 for item in select value from jsonb_array_elements(p_matches) loop
  if not exists(select 1 from public.icash_buyer_profiles where id=(item->>'id')::uuid and account_id=j.account_id) then raise exception 'Buyer tenant mismatch';end if;
  insert into public.icash_buyer_matches(deal_id,buyer_id,score,ready,rank,source_ref) values(d.id,(item->>'id')::uuid,(item->>'score')::integer,(item->>'ready')::boolean,(item->>'rank')::integer,item->>'sourceRef') on conflict(deal_id,buyer_id) do update set score=excluded.score,ready=excluded.ready,rank=excluded.rank,source_ref=excluded.source_ref,created_at=now();
 end loop;
 update public.icash_fulfillment_jobs set state='complete',result=p_result,updated_at=now() where id=j.id;
end $$;
alter function public.icash_next_automation() rename to icash_next_before_fulfillment;
alter table public.icash_automation_tickets drop constraint icash_automation_tickets_kind_check;
alter table public.icash_automation_tickets add constraint icash_automation_tickets_kind_check check(kind in ('discovery','contacts','voice_result','signing_result','voice_dispatch','fulfillment'));
alter table public.icash_automation_tickets add column fulfillment_job_id uuid references public.icash_fulfillment_jobs(id);
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare j public.icash_fulfillment_jobs;t public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 perform public.icash_queue_fulfillment();
 -- Limit preparation tickets to one per minute globally so reconciliation/calls are not starved.
 if not exists(select 1 from public.icash_automation_tickets where kind='fulfillment' and created_at>now()-interval '1 minute') then
 select f.* into j from public.icash_fulfillment_jobs f join public.icash_accounts a on a.id=f.account_id and not a.bot_paused where f.state='ready' order by f.updated_at for update of f skip locked limit 1;
 if found then
 update public.icash_fulfillment_jobs set state='issued',updated_at=now() where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,fulfillment_job_id) values(j.account_id,'fulfillment',j.id) returning * into t;
 return jsonb_build_object('token',t.token);
 end if;end if;
 return public.icash_next_before_fulfillment();
end $$;
create or replace function public.icash_consume_automation(p_token text) returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id,'liveCallId',t.live_call_id,'signingId',t.signing_id,'voiceJobId',t.voice_job_id,'fulfillmentJobId',t.fulfillment_job_id);
end $$;
revoke all on function public.icash_queue_fulfillment(),public.icash_save_fulfillment(uuid,jsonb,jsonb,jsonb),public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_queue_fulfillment(),public.icash_save_fulfillment(uuid,jsonb,jsonb,jsonb),public.icash_next_automation() to service_role;
