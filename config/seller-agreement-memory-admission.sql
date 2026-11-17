-- Runner-owned transaction: exact sources, bounded locks, and ledger commit together.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $predecessors$
declare e record;p record;
begin
 for e in select * from (values
 ('public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)','86f657d4a31ae04d26f9fd8538ef8f43',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb)','f75fe44890435cb9ca13f65b7bdd588e',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_seller_text_agreement(uuid,uuid)','0f016810b5a9bce5f4954232d0f67158',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_confirmed_seller_contract_text_current(uuid,uuid)','e9a384ea359031d9375f8e7d208a765b',true,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb)','7d4193a29979d0a3c07dbebfaad9f210',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)','b76d11ac37a25dea7135b513947bdc88',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_ingest_text_event_before_operational(jsonb,boolean)','7334d8809b1f1a72d41f4fac388da62c',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_live_result(uuid,jsonb)','d3b1a85b994df275165759daa404a129',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_seller_history_before_viewings(uuid,text,jsonb)','bd232edf6e68c123e7d9e5706b405a1d',true,'v','{postgres=X/postgres}'),
 ('public.icash_save_seller_inbound_history(uuid,text,jsonb)','7963d02462db6613dc199101cf41f3e9',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_seller_memory(uuid,uuid,text,text,jsonb)','dd9068acd817c539546af76c789ff86f',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_seller_memory_inbound_history(uuid,text,jsonb)','6639ec36269ae319e4387f3ddb8e49df',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_seller_memory_context(uuid,uuid,text)','7a680dae86359988c3f70c705a3369b0',true,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_seller_text_offer_context(uuid,uuid)','5f6e0a4049af7b8ca40b1bcb599f3547',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_signing_action_allowed(uuid,uuid)','0c8dd6053164498e0f2e400d8e55d3b7',false,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_sms_message_route()','f9d2f04ed7e0dfe2e14cf095c5eee0c0',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_transition_recorded_reception(uuid,uuid,text,bigint,text,jsonb)','98ad6a75aa4e9eb6492dbc22fd1e88ec',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_agreement_delivery_recovery()','c40c2cc0d525f4c417ad225848da552a',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_text_before_owner_question(uuid,uuid,text)','2ab7c58cc5a38b95651bb0ecb054d40d',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb)','88c280613085bf4bcbf73ca9a2f3ce91',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_ingest_text_event(jsonb,boolean)','803a18e1b80d57c470440fb9b6e694f0',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_seller_agreement_call_context(text,text)','7a8ff8331d8617f6692cbb8478259dd7',true,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_capture_seller_viewing(uuid,uuid,uuid,text,uuid,jsonb,timestamp with time zone)','4bfe292a52032b35539de486fbdf3fb2',true,'v','{postgres=X/postgres}'),
 ('public.icash_claim_seller_agreement_before_offer(text,text,jsonb,jsonb,jsonb)','c71458ca0786566187e00ebbfab7aa21',true,'v','{postgres=X/postgres}'),
 ('public.icash_membership_work_allowed(uuid)','554669115ef58cb0da536bda361dcdca',false,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_open_handoff(uuid,text,text,text)','41109df08fcfeaca6c29aecc306e57fa',false,'v','{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,source_hash,definer,volatility,acl) loop
 select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl into p from pg_proc where oid=to_regprocedure(e.signature);
 if p.source_hash is distinct from e.source_hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from e.definer or p.provolatile::text is distinct from e.volatility
  or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""'] or p.acl is distinct from e.acl then raise exception 'Seller memory admission prerequisite changed: %',e.signature;end if;
 end loop;
end $predecessors$;
-- Internal source admission for automatic seller agreements only.
create schema icash_seller_agreement_memory_private;
revoke all on schema icash_seller_agreement_memory_private from public,anon,authenticated;
grant usage on schema icash_seller_agreement_memory_private to service_role;
create table icash_seller_agreement_memory_private.admissions(
 confirmation_id uuid primary key references icash_seller_agreement_private.confirmations(id),
 account_id uuid not null,deal_id uuid not null,screening_id uuid not null,phone text not null,
 call_key text not null,conversation_id text,original_fingerprint text not null,
 fingerprint text not null,source_manifest jsonb not null,live_calls jsonb not null,
 call_prefix jsonb,created_at timestamptz not null default clock_timestamp()
);
create table icash_seller_agreement_memory_private.reviews(
 id uuid primary key default gen_random_uuid(),confirmation_id uuid not null references icash_seller_agreement_memory_private.admissions(confirmation_id),
 prior_fingerprint text not null,next_fingerprint text not null,call_prefix jsonb not null,source_manifest jsonb not null,reviewed_at timestamptz not null default clock_timestamp(),
 unique(confirmation_id,prior_fingerprint,next_fingerprint)
);
alter table icash_seller_agreement_memory_private.admissions enable row level security;
alter table icash_seller_agreement_memory_private.reviews enable row level security;
revoke all on all tables in schema icash_seller_agreement_memory_private from public,anon,authenticated,service_role;

create function icash_seller_agreement_memory_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_table_name='admissions' and tg_op='UPDATE'
  and (to_jsonb(new)-array['fingerprint','live_calls'])=(to_jsonb(old)-array['fingerprint','live_calls']) then return new;end if;
 raise exception 'Original seller memory admission is immutable';
end $$;
create trigger seller_memory_admission_immutable before update or delete on icash_seller_agreement_memory_private.admissions for each row execute function icash_seller_agreement_memory_private.immutable();
create trigger seller_memory_admission_no_truncate before truncate on icash_seller_agreement_memory_private.admissions for each statement execute function icash_seller_agreement_memory_private.immutable();
create trigger seller_memory_review_immutable before update or delete on icash_seller_agreement_memory_private.reviews for each row execute function icash_seller_agreement_memory_private.immutable();
create trigger seller_memory_review_no_truncate before truncate on icash_seller_agreement_memory_private.reviews for each statement execute function icash_seller_agreement_memory_private.immutable();

create function icash_seller_agreement_memory_private.original_source(p_call_key text) returns text language sql immutable set search_path='' as $$
 select case when p_call_key like 'outbound:%' then 'call:'||substr(p_call_key,10) when p_call_key like 'inbound:%' then 'reception:'||substr(p_call_key,9) end
$$;
create function icash_seller_agreement_memory_private.manifest(p_source jsonb,p_call_key text) returns jsonb language sql immutable set search_path='' as $$
 select case when p_source->>'callSourceVersion'='seller-call-source-v1' then jsonb_build_object(
  'conversations',coalesce(jsonb_agg(c order by n),'[]'::jsonb),'callSourceVersion','seller-call-source-v1',
  'callSourceComplete',p_source->'callSourceComplete','cutover',p_source->'callSourceCutover')
  else coalesce(jsonb_agg(c order by n),'[]'::jsonb) end from jsonb_array_elements(p_source->'conversations') with ordinality x(c,n)
 where c->>'sourceId' is distinct from icash_seller_agreement_memory_private.original_source(p_call_key)
$$;

-- The public projection uses transaction time. A writer that commits while this
-- transaction waits must not disappear behind that earlier clock boundary.
-- Owned original contract links are the only removed source: their creation
-- cannot revoke their own exact authorization, but any seller reply still does.
create function icash_seller_agreement_memory_private.current_source(p_account uuid,p_screening uuid,p_phone text,p_confirmation uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare source jsonb;owned uuid[];calls jsonb;entry jsonb;turns jsonb;removed integer;deal uuid;sms jsonb;raw_mode boolean;canonical jsonb;cutover timestamptz;
begin
 source:=public.icash_seller_memory_context(p_account,p_screening,p_phone);
 if source is null or source->'binding'->>'accountId' is distinct from p_account::text or source->'binding'->>'screeningId' is distinct from p_screening::text
  or source->'binding'->>'phone' is distinct from p_phone or jsonb_typeof(source->'conversations') is distinct from 'array' then return null;end if;
 raw_mode:=source->>'callSourceVersion'='seller-call-source-v1';
 if coalesce(raw_mode,false) then
  -- Raw voice sources deliberately make legacy top-level completeness false.
  -- This exact protocol proves SMS receipts and full voice coverage separately.
  if source->'callSourceComplete' is distinct from 'true'::jsonb
   or jsonb_typeof(source->'callSourceCutover') is distinct from 'string'
   or source->>'callSourceCutover' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$'
   or (select count(*) from jsonb_array_elements(source->'conversations') c where c->>'sourceId'='sms')<>1
   or (select count(*) from jsonb_array_elements(source->'conversations') c where c->>'sourceId' is distinct from 'sms')>100
   or exists(select 1 from jsonb_array_elements(source->'conversations') c where jsonb_typeof(c->'transcript') is distinct from 'array'
    or nullif(c->>'sourceId','') is null or (c->>'sourceId'<>'sms' and (c->>'channel' is distinct from 'voice' or c->'complete' is distinct from 'true'::jsonb)))
   or exists(select 1 from jsonb_array_elements(source->'conversations') c group by c->>'sourceId' having count(*)<>1) then return null;end if;
  begin
   cutover:=(source->>'callSourceCutover')::timestamptz;
   if not isfinite(cutover) or cutover>clock_timestamp() then return null;end if;
  exception when invalid_datetime_format or datetime_field_overflow then return null;
  end;
  select c into sms from jsonb_array_elements(source->'conversations') c where c->>'sourceId'='sms';
  if sms->>'receiptProjectionVersion' is distinct from 'seller-sms-receipts-v1' or sms->'receiptSourceComplete' is distinct from 'true'::jsonb
   or jsonb_typeof(sms->'rawSourceCount') is distinct from 'number' or coalesce(sms->>'rawSourceCount','') !~ '^(0|[1-9][0-9]{0,3})$' then return null;end if;
  if (sms->>'rawSourceCount')::integer>1000 then return null;end if;
  canonical:=jsonb_build_object('conversations',source->'conversations','callSourceVersion','seller-call-source-v1',
   'callSourceComplete',source->'callSourceComplete','cutover',source->'callSourceCutover');
  if source->>'fingerprint' is distinct from encode(sha256(convert_to(canonical::text,'UTF8')),'hex') then return null;end if;
 elsif source ? 'callSourceVersion' or source->'receiptSourceComplete' is distinct from 'true'::jsonb then return null;
 end if;
 deal:=(source->'binding'->>'dealId')::uuid;
 if exists(select 1 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where t.account_id=p_account and t.deal_id=deal and t.recipient=p_phone and t.party='seller' and t.retired_at is null
   and m.created_at>now() and (m.direction='outgoing' or m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)))
  or exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=p_screening
   and c.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex') and c.party='seller' and c.state='complete' and c.completed_at>now())
  or exists(select 1 from icash_seller_agreement_private.call_history h where h.account_id=p_account and h.screening_id=p_screening
   and h.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex') and h.completed_at>now())
  or exists(select 1 from icash_seller_memory_private.call_sources h where h.account_id=p_account and h.screening_id=p_screening
   and h.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex') and h.completed_at>now()) then return null;end if;
 -- A terminal provider clock is evidence that the original call has ended,
 -- not evidence that its transcript was fully reviewed. Wait for that source.
 if exists(select 1 from icash_recorded_reception_private.sessions s
  join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
  join public.icash_deal_files d on d.id=b.deal_id and d.account_id=b.account_id
  where s.account_id=p_account and d.id=deal and d.screening_id=p_screening and s.from_phone=p_phone and s.call_ended_at is not null
   and not exists(select 1 from jsonb_array_elements(source->'conversations') c where c->>'sourceId'='reception:'||s.id::text))
  or exists(select 1 from public.icash_live_conversations c join public.icash_call_recordings r on r.account_id=c.account_id and r.operation_key=c.operation_key
   where c.account_id=p_account and c.screening_id=p_screening and c.party='seller' and c.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
    and r.call_ended_at is not null and (c.state<>'complete' or not exists(select 1 from jsonb_array_elements(source->'conversations') x where x->>'sourceId'='call:'||c.id::text))) then return null;end if;
 if p_confirmation is null then return source;end if;
 select array_agg(m.id) into owned from icash_seller_agreement_private.confirmations c
 join public.icash_signing_envelopes e on e.id=c.envelope_id and e.account_id=c.account_id and e.deal_id=c.deal_id
 join public.icash_contract_text_deliveries x on x.envelope_id=e.id and x.account_id=e.account_id and x.signer_id=e.recipients->0->>'id'
 join public.icash_text_messages m on m.id=x.message_id and m.account_id=x.account_id and m.thread_id=x.thread_id
 join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.deal_id=e.deal_id
 where c.id=p_confirmation and c.account_id=p_account and c.deal_id=deal and c.state='ready'
  and e.kind='purchase' and not e.test_mode and e.state='awaiting_counterparty' and nullif(e.provider_id,'') is not null
  and (e.terms-array['assignmentFeeCents','assignmentDepositCents'])=(c.terms-array['assignmentFeeCents','assignmentDepositCents'])
  and e.recipients->0->>'phone'=p_phone and e.recipients->0->>'name'=c.confirmation->>'sellerLegalName'
  and t.recipient=p_phone and t.party='seller' and t.retired_at is null
  and m.direction='outgoing' and m.customer_author_id is null and cardinality(m.asset_ids)=0 and m.attachments='[]'::jsonb
  and m.body ~ '^Review your contract: https://docuseal[.]com/s/[A-Za-z0-9_-]+$';
 if coalesce(cardinality(owned),0)=0 then return source;end if;
 calls:='[]'::jsonb;
 for entry in select value from jsonb_array_elements(source->'conversations') loop
  if entry->>'sourceId'='sms' then
   select count(distinct t->>'sourceId'),coalesce(jsonb_agg(t order by n) filter(where not coalesce(t->>'sourceId'=any(owned::text[]),false)),'[]'::jsonb)
    into removed,turns from jsonb_array_elements(entry->'transcript') with ordinality x(t,n)
    where true;
   select count(distinct t->>'sourceId') into removed from jsonb_array_elements(entry->'transcript') t where t->>'sourceId'=any(owned::text[]);
   entry:=jsonb_set(jsonb_set(entry,'{transcript}',turns),'{rawSourceCount}',to_jsonb((entry->>'rawSourceCount')::integer-removed));
  end if;
  calls:=calls||jsonb_build_array(entry);
 end loop;
 canonical:=case when raw_mode then jsonb_build_object('conversations',calls,'callSourceVersion','seller-call-source-v1',
  'callSourceComplete',source->'callSourceComplete','cutover',source->'callSourceCutover') else calls end;
 return jsonb_set(jsonb_set(source,'{conversations}',calls),'{fingerprint}',to_jsonb(encode(sha256(convert_to(canonical::text,'UTF8')),'hex')));
end $$;

-- Keep the public signing function invoker-owned. Only this narrow private
-- helper can inspect the private automatic confirmation and its source receipt.
create function icash_seller_agreement_memory_private.admit_purchase(p_account uuid,p_deal uuid,p_template uuid,p_recipients jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare phone text;memory_confirmation uuid;d public.icash_deal_files;
begin
 if not public.icash_seller_memory_enabled(p_account)
  or not exists(select 1 from public.icash_signing_templates where id=p_template and not test_mode)
  or not exists(select 1 from icash_seller_agreement_private.confirmations where account_id=p_account and deal_id=p_deal) then return true;end if;
 select min(a.phone),(array_agg(c.id))[1] into phone,memory_confirmation
 from icash_seller_agreement_private.confirmations c join icash_seller_agreement_memory_private.admissions a on a.confirmation_id=c.id and a.account_id=c.account_id and a.deal_id=c.deal_id
 join public.icash_deal_files df on df.id=c.deal_id and df.account_id=c.account_id and (df.terms-array['assignmentFeeCents','assignmentDepositCents'])=(c.terms-array['assignmentFeeCents','assignmentDepositCents'])
 where c.account_id=p_account and c.deal_id=p_deal and c.envelope_id is null and c.state in ('preparing','needs_review') having count(*)=1;
 if phone is null or phone is distinct from p_recipients->0->>'phone' then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(phone,74));
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or not exists(select 1 from icash_seller_agreement_private.confirmations c where c.id=memory_confirmation and c.account_id=p_account and c.deal_id=p_deal
  and c.envelope_id is null and c.state in ('preparing','needs_review')
  and (c.terms-array['assignmentFeeCents','assignmentDepositCents'])=(d.terms-array['assignmentFeeCents','assignmentDepositCents'])) then return false;end if;
 return icash_seller_agreement_memory_private.current(memory_confirmation);
end $$;

create function icash_seller_agreement_memory_private.remember(p_confirmation uuid,p_scope jsonb,p_conversation text,p_source jsonb,p_prefix jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare a icash_seller_agreement_memory_private.admissions;
begin
 insert into icash_seller_agreement_memory_private.admissions(confirmation_id,account_id,deal_id,screening_id,phone,call_key,conversation_id,original_fingerprint,fingerprint,source_manifest,live_calls,call_prefix)
 values(p_confirmation,(p_scope->>'accountId')::uuid,(p_scope->>'dealId')::uuid,(p_scope->>'screeningId')::uuid,p_scope->>'phone',p_scope->>'callKey',p_conversation,
 p_source->>'fingerprint',p_source->>'fingerprint',icash_seller_agreement_memory_private.manifest(p_source,p_scope->>'callKey'),coalesce(p_source->'liveCalls','[]'::jsonb),p_prefix) on conflict do nothing;
 select * into strict a from icash_seller_agreement_memory_private.admissions where confirmation_id=p_confirmation;
 return a.account_id=(p_scope->>'accountId')::uuid and a.deal_id=(p_scope->>'dealId')::uuid and a.screening_id=(p_scope->>'screeningId')::uuid
  and a.phone=p_scope->>'phone' and a.call_key=p_scope->>'callKey' and a.conversation_id is not distinct from p_conversation
  and a.fingerprint=p_source->>'fingerprint' and a.live_calls=coalesce(p_source->'liveCalls','[]'::jsonb)
  and a.call_prefix is not distinct from p_prefix;
end $$;

create function icash_seller_agreement_memory_private.current(p_confirmation uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a icash_seller_agreement_memory_private.admissions;source jsonb;
begin
 select * into a from icash_seller_agreement_memory_private.admissions where confirmation_id=p_confirmation;
 if not found then return false;end if;
 source:=icash_seller_agreement_memory_private.current_source(a.account_id,a.screening_id,a.phone,a.confirmation_id);
 return source is not null and source->'binding'->>'dealId'=a.deal_id::text and source->>'fingerprint'=a.fingerprint
  and coalesce(source->'liveCalls','[]'::jsonb)=a.live_calls;
end $$;

alter function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) rename to icash_claim_seller_agreement_before_memory;
create function public.icash_claim_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb,p_memory_fingerprint text,p_call_prefix jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare scope jsonb;source jsonb;claim jsonb;enabled boolean;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);if scope is null then return null;end if;
 enabled:=public.icash_seller_memory_enabled((scope->>'accountId')::uuid);
 if not enabled then return public.icash_claim_seller_agreement_before_memory(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms);end if;
 if p_memory_fingerprint is null or p_memory_fingerprint !~ '^[a-f0-9]{64}$' then return null;end if;
 if p_call_prefix is not null then
 if jsonb_typeof(p_call_prefix) is distinct from 'object' or p_call_prefix-array['version','conversationId','pairCount','turnCount','fingerprint']<>'{}'::jsonb
  or p_call_prefix->>'version' is distinct from 'seller-call-prefix-v2' or p_call_prefix->>'conversationId' is distinct from p_conversation
  or jsonb_typeof(p_call_prefix->'pairCount') is distinct from 'number'
  or coalesce(p_call_prefix->>'pairCount','') !~ '^[1-9][0-9]{0,3}$'
  or jsonb_typeof(p_call_prefix->'turnCount') is distinct from 'number'
  or coalesce(p_call_prefix->>'turnCount','') !~ '^[1-9][0-9]{0,3}$'
  or coalesce(p_call_prefix->>'fingerprint','') !~ '^[a-f0-9]{64}$' then return null;end if;
 if (p_call_prefix->>'pairCount')::integer>1000 or (p_call_prefix->>'turnCount')::integer>1000
  or (p_call_prefix->>'pairCount')::integer>(p_call_prefix->>'turnCount')::integer then return null;end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(scope->>'phone',74));
 if public.icash_seller_agreement_call_context(p_hash,p_conversation) is distinct from scope then return null;end if;
 perform 1 from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid for update;
 source:=icash_seller_agreement_memory_private.current_source((scope->>'accountId')::uuid,(scope->>'screeningId')::uuid,scope->>'phone');
 if source is null or source->>'fingerprint' is distinct from p_memory_fingerprint or source->'binding'->>'dealId' is distinct from scope->>'dealId' then return null;end if;
 claim:=public.icash_claim_seller_agreement_before_memory(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms);if claim is null then return null;end if;
 -- An older confirmation has no admission-time transcript proof. A new caller
 -- must not attach a retrospective fingerprint to that already claimed record.
 if claim->'claimed' is distinct from 'true'::jsonb and not exists(select 1 from icash_seller_agreement_memory_private.admissions where confirmation_id=(claim->>'id')::uuid) then return null;end if;
 if not icash_seller_agreement_memory_private.remember((claim->>'id')::uuid,scope,p_conversation,source,p_call_prefix) then raise exception 'Original seller memory admission changed';end if;
 return claim;
end $$;
create function public.icash_claim_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb,p_memory_fingerprint text)
returns jsonb language sql security definer set search_path='' as $$ select public.icash_claim_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,p_memory_fingerprint,null) $$;
create function public.icash_claim_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb)
returns jsonb language sql security definer set search_path='' as $$ select public.icash_claim_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,null,null) $$;

create function icash_seller_agreement_memory_private.original_call(p_admission icash_seller_agreement_memory_private.admissions,p_source jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare original jsonb;valid boolean;
begin
 select c into original from jsonb_array_elements(p_source->'conversations') c where c->>'sourceId'=icash_seller_agreement_memory_private.original_source(p_admission.call_key);
 if original is null then return null;end if;
 if p_admission.call_key like 'outbound:%' then
  select exists(select 1 from public.icash_live_conversations c where 'outbound:'||c.id::text=p_admission.call_key and c.account_id=p_admission.account_id
   and c.screening_id=p_admission.screening_id and c.party='seller' and c.state='complete' and c.conversation_id=p_admission.conversation_id
   and c.contact_key=encode(sha256(convert_to(p_admission.phone,'UTF8')),'hex')) into valid;
 elsif p_admission.call_key like 'inbound:%' then
  select exists(select 1 from icash_recorded_reception_private.sessions s where 'inbound:'||s.id::text=p_admission.call_key and s.account_id=p_admission.account_id
   and s.from_phone=p_admission.phone and s.conversation_id=p_admission.conversation_id and s.call_ended_at is not null) into valid;
 end if;
 if valid is distinct from true then return null;end if;
 return original||jsonb_build_object('conversationId',p_admission.conversation_id);
end $$;

create function icash_seller_agreement_memory_private.review_ready(p_confirmation uuid) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare a icash_seller_agreement_memory_private.admissions;source jsonb;
begin
 select * into a from icash_seller_agreement_memory_private.admissions where confirmation_id=p_confirmation;
 if not found then return false;end if;
 source:=icash_seller_agreement_memory_private.current_source(a.account_id,a.screening_id,a.phone,a.confirmation_id);
 if source is null then return false;end if;
 if source->>'fingerprint'=a.fingerprint and coalesce(source->'liveCalls','[]'::jsonb)=a.live_calls then return true;end if;
 return a.call_prefix is not null and a.conversation_id is not null
  and icash_seller_agreement_memory_private.manifest(source,a.call_key)=a.source_manifest
  and (select count(*) from jsonb_array_elements(source->'conversations') c where c->>'sourceId'=icash_seller_agreement_memory_private.original_source(a.call_key))=1
  and icash_seller_agreement_memory_private.original_call(a,source) is not null
  and (select coalesce(jsonb_agg(c order by c::text),'[]'::jsonb) from jsonb_array_elements(coalesce(source->'liveCalls','[]'::jsonb)) c where c->>'conversationId' is distinct from a.conversation_id)
   =(select coalesce(jsonb_agg(c order by c::text),'[]'::jsonb) from jsonb_array_elements(a.live_calls) c where c->>'conversationId' is distinct from a.conversation_id);
end $$;

create function public.icash_seller_agreement_memory_context(p_account uuid,p_recovery uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare r icash_seller_agreement_private.delivery_recovery;c icash_seller_agreement_private.confirmations;a icash_seller_agreement_memory_private.admissions;source jsonb;
begin
 select * into r from icash_seller_agreement_private.delivery_recovery where id=p_recovery and account_id=p_account and state='claimed' and expires_at>clock_timestamp();
 if not found or r.request_key not like 'seller-confirmed:%' or not public.icash_seller_memory_enabled(p_account) then return null;end if;
 select * into c from icash_seller_agreement_private.confirmations where account_id=p_account and deal_id=r.deal_id and 'seller-confirmed:'||id::text=r.request_key;
 if not found then return null;end if;
 select * into a from icash_seller_agreement_memory_private.admissions where confirmation_id=c.id and account_id=p_account and deal_id=r.deal_id and phone=r.phone;
 if not found then return null;end if;
 source:=icash_seller_agreement_memory_private.current_source(a.account_id,a.screening_id,a.phone,a.confirmation_id);
 return jsonb_build_object('confirmationId',c.id,'originalSourceId',icash_seller_agreement_memory_private.original_source(a.call_key),
  'admission',jsonb_build_object('fingerprint',a.fingerprint,'originalFingerprint',a.original_fingerprint,'callKey',a.call_key,'conversationId',a.conversation_id,'phone',a.phone,
   'screeningId',a.screening_id,'callPrefix',a.call_prefix,'sourceManifest',a.source_manifest,'liveCalls',a.live_calls,'confirmation',c.confirmation,'terms',c.terms,'createdAt',a.created_at),
  'current',source,'currentManifest',icash_seller_agreement_memory_private.manifest(source,a.call_key),'originalCall',icash_seller_agreement_memory_private.original_call(a,source));
end $$;

create function public.icash_refresh_seller_agreement_memory(p_account uuid,p_confirmation uuid,p_expected_fingerprint text,p_new_fingerprint text,p_call_prefix jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare a icash_seller_agreement_memory_private.admissions;c icash_seller_agreement_private.confirmations;source jsonb;
begin
 select * into a from icash_seller_agreement_memory_private.admissions where confirmation_id=p_confirmation and account_id=p_account;
 if not found or a.call_prefix is null or a.call_prefix is distinct from p_call_prefix or a.fingerprint is distinct from p_expected_fingerprint then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(a.phone,74));
 perform 1 from public.icash_deal_files where id=a.deal_id and account_id=a.account_id for update;
 select * into a from icash_seller_agreement_memory_private.admissions where confirmation_id=p_confirmation and account_id=p_account for update;
 select * into c from icash_seller_agreement_private.confirmations where id=a.confirmation_id and account_id=a.account_id and deal_id=a.deal_id for update;
 if not found or c.envelope_id is not null or c.state not in ('preparing','needs_review')
  or a.call_prefix is distinct from p_call_prefix or a.fingerprint is distinct from p_expected_fingerprint
  or exists(select 1 from public.icash_signing_envelopes e where e.account_id=a.account_id and e.deal_id=a.deal_id and e.kind='purchase' and not e.test_mode)
  or not exists(select 1 from icash_seller_agreement_private.delivery_recovery r join public.icash_deal_files d on d.id=r.deal_id and d.account_id=r.account_id
   where r.account_id=a.account_id and r.deal_id=a.deal_id and r.phone=a.phone and r.request_key='seller-confirmed:'||c.id::text
    and r.state='claimed' and r.expires_at>clock_timestamp() and r.envelope_id is null
    and (r.expected_terms-array['assignmentFeeCents','assignmentDepositCents'])=(c.terms-array['assignmentFeeCents','assignmentDepositCents'])
    and (d.terms-array['assignmentFeeCents','assignmentDepositCents'])=(c.terms-array['assignmentFeeCents','assignmentDepositCents'])) then return false;end if;
 source:=icash_seller_agreement_memory_private.current_source(a.account_id,a.screening_id,a.phone,a.confirmation_id);
 if source is null or source->>'fingerprint' is distinct from p_new_fingerprint
  or icash_seller_agreement_memory_private.review_ready(a.confirmation_id) is distinct from true
  or icash_seller_agreement_memory_private.manifest(source,a.call_key) is distinct from a.source_manifest
  or (select count(*) from jsonb_array_elements(source->'conversations') x where x->>'sourceId'=icash_seller_agreement_memory_private.original_source(a.call_key))<>1 then return false;end if;
 insert into icash_seller_agreement_memory_private.reviews(confirmation_id,prior_fingerprint,next_fingerprint,call_prefix,source_manifest)
 values(a.confirmation_id,a.fingerprint,p_new_fingerprint,p_call_prefix,a.source_manifest) on conflict do nothing;
 update icash_seller_agreement_memory_private.admissions set fingerprint=p_new_fingerprint,live_calls=coalesce(source->'liveCalls','[]'::jsonb) where confirmation_id=a.confirmation_id;
 return true;
end $$;

CREATE OR REPLACE FUNCTION public.icash_defer_seller_agreement(p_hash text, p_conversation text, p_confirmation jsonb, p_expected_terms jsonb, p_terms jsonb, p_memory_fingerprint text, p_call_prefix jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare scope jsonb;claim jsonb;c icash_seller_agreement_private.confirmations;d public.icash_deal_files;r icash_seller_agreement_private.delivery_recovery;
begin
 scope:=public.icash_seller_agreement_call_context(p_hash,p_conversation);
 if scope is null then return null;end if;
 if public.icash_seller_memory_enabled((scope->>'accountId')::uuid) and p_call_prefix is null then return null;end if;
 if not exists(
  select 1 from public.icash_accounts a
  join public.icash_deal_files df on df.account_id=a.id and df.id=(scope->>'dealId')::uuid and df.stage='draft'
  join public.icash_screening_jobs s on s.id=df.screening_id and s.account_id=a.id and s.state='complete'
  join auth.users u on u.id=a.owner_user_id and u.email is not null and u.email_confirmed_at is not null
  where a.id=(scope->>'accountId')::uuid and a.owner_user_id=(scope->>'ownerUserId')::uuid and not a.bot_paused
   and public.icash_membership_work_allowed(a.id)
   and not exists(select 1 from public.icash_property_controls pc where pc.account_id=a.id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=scope->>'phone')
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(scope->>'phone','UTF8')),'hex'))
 ) then return null;end if;
 claim:=public.icash_claim_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,p_memory_fingerprint,p_call_prefix);
 if claim is null then return null;end if;
 select * into c from icash_seller_agreement_private.confirmations
 where id=(claim->>'id')::uuid and account_id=(scope->>'accountId')::uuid and deal_id=(scope->>'dealId')::uuid for update;
 if not found or c.confirmation is distinct from p_confirmation
  or (c.terms-array['assignmentFeeCents','assignmentDepositCents']) is distinct from (p_terms-array['assignmentFeeCents','assignmentDepositCents']) then return null;end if;
 select * into d from public.icash_deal_files where id=c.deal_id and account_id=c.account_id and stage='draft' for update;
 -- These two fields are buyer-side economics, absent from the seller purchase
 -- document. They can be recalculated without changing any seller-agreed term.
 if not found or (d.terms-array['assignmentFeeCents','assignmentDepositCents']) is distinct from (c.terms-array['assignmentFeeCents','assignmentDepositCents']) then return null;end if;
 select * into r from icash_seller_agreement_private.delivery_recovery where request_key='seller-confirmed:'||c.id::text for update;
 if found then return jsonb_build_object('queued',r.state in ('queued','claimed') and r.expires_at>now(),'id',r.id);end if;
 -- Provider creation always has an envelope first. Any envelope, including an
 -- uncertain/failed one, blocks automatic recreation. Never retry ambiguity.
 if c.envelope_id is not null or exists(select 1 from public.icash_signing_envelopes where account_id=c.account_id and deal_id=c.deal_id and kind='purchase' and not test_mode) then return null;end if;
 insert into icash_seller_agreement_private.delivery_recovery(request_key,account_id,requested_by,deal_id,phone,seller_name,expected_terms,authorization_reference,expires_at)
 values('seller-confirmed:'||c.id::text,c.account_id,(scope->>'ownerUserId')::uuid,c.deal_id,scope->>'phone',p_confirmation->>'sellerLegalName',d.terms,
  'Automatic recovery of call-bound seller text authorization; confirmation '||c.id::text,
  least(now()+interval '24 hours',((p_confirmation->>'closingDate')::date)::timestamptz)) returning * into r;
 return jsonb_build_object('queued',true,'id',r.id);
end $function$
;

create or replace function public.icash_defer_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb) returns jsonb language sql security definer set search_path='' as $$ select public.icash_defer_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,null,null) $$;
create function public.icash_defer_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb,p_memory_fingerprint text) returns jsonb language sql security definer set search_path='' as $$ select public.icash_defer_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,p_memory_fingerprint,null) $$;

CREATE OR REPLACE FUNCTION public.icash_begin_signing(p_user uuid, p_account uuid, p_deal uuid, p_kind text, p_template uuid, p_hash text, p_recipients jsonb)
 RETURNS icash_signing_envelopes
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare d public.icash_deal_files; t public.icash_signing_templates; e public.icash_signing_envelopes;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 if p_kind='purchase' and icash_seller_agreement_memory_private.admit_purchase(p_account,p_deal,p_template,p_recipients) is distinct from true then raise exception 'Seller memory source changed';end if;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 select * into strict t from public.icash_signing_templates where id=p_template and enabled and reviewed_until>now() and kind=p_kind and (template_scope='standard' or state_code=d.terms->>'state');
 if t.signer_count+1<>jsonb_array_length(p_recipients) then raise exception 'All signers required';end if;
 if p_kind='purchase' and d.stage<>'draft' then raise exception 'Purchase already executed';end if;
 if p_kind='assignment' and (d.seller_signed_at is null or d.stage not in ('under_contract','buyer_selected','title_open','closing')) then raise exception 'Executed purchase required';end if;
 insert into public.icash_signing_envelopes(account_id,deal_id,kind,template_id,terms,terms_hash,recipients,test_mode,consent_version,requested_by)
 values(p_account,p_deal,p_kind,p_template,d.terms,p_hash,p_recipients,t.test_mode,'2026-09-28-signing-1',p_user) returning * into e;
 return e;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_claim_seller_text_agreement(p_account uuid, p_job uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;c jsonb;d public.icash_deal_files;p jsonb;st jsonb;terms jsonb;confirmation jsonb;new_id uuid;memory_phone text;memory_source jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and id=p_job and state='drafted' and analysis->>'offerPolicy'='seller-text-offer-v1' and analysis->'offerPlan'->>'kind'='agreement';
 if not found then return null;end if;
 select t.recipient into memory_phone from public.icash_text_threads t where t.id=j.thread_id and t.account_id=p_account;
 if public.icash_seller_memory_enabled(p_account) then
  if memory_phone is null then return null;end if;
  perform pg_advisory_xact_lock(hashtextextended(memory_phone,74));
 end if;
 select df.* into d from public.icash_deal_files df join public.icash_text_threads t on t.deal_id=df.id and t.account_id=df.account_id where t.id=j.thread_id and t.account_id=p_account for update of df;
 c:=public.icash_seller_text_offer_context(p_account,j.message_id);st:=c->'offerState';p:=j.analysis->'offerPlan';terms:=p->'terms';confirmation:=p->'confirmation';
 if c is null or c->>'fingerprint' is distinct from j.analysis->>'offerFingerprint' or st is distinct from j.analysis->'offerState'
  or st->'contractBlocked' is distinct from 'false'::jsonb or st->'acceptanceConditional' is distinct from 'false'::jsonb
  or st->>'acceptedPriceCents' is null or st->'acceptedPriceCents' is distinct from terms->'priceCents'
  or terms->'priceCents' is distinct from confirmation->'agreedPriceCents'
  or terms->>'seller' is distinct from confirmation->>'sellerLegalName' or terms->>'closingDate' is distinct from confirmation->>'closingDate'
  or confirmation->'soleOwner' is distinct from 'true'::jsonb or confirmation->'allDecisionMakersAgree' is distinct from 'true'::jsonb
  or confirmation->'priceAndDateConfirmed' is distinct from 'true'::jsonb or confirmation->'termsConfirmed' is distinct from 'true'::jsonb
  or confirmation->'sendTextRequested' is distinct from 'true'::jsonb or confirmation->'materialFactsChanged' is distinct from 'false'::jsonb
  or row(terms->'address',terms->'buyer',terms->'state') is distinct from row(d.terms->'address',d.terms->'buyer',d.terms->'state')
  or public.icash_sms_thread_review_current(p_account,j.thread_id,true) is distinct from true then return null;end if;
 if exists(select 1 from icash_seller_agreement_private.confirmations where call_key='sms:'||j.message_id)
  or exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='purchase' and not test_mode) then return null;end if;
 if public.icash_seller_memory_enabled(p_account) then
  memory_source:=icash_seller_agreement_memory_private.current_source(p_account,d.screening_id,memory_phone);
  if memory_source is null or memory_source->>'fingerprint' is distinct from c->>'memoryFingerprint'
   or memory_source->'binding'->>'dealId' is distinct from d.id::text then return null;end if;
 end if;
 update public.icash_deal_files df set terms=p->'terms',updated_at=now() where df.id=d.id and df.account_id=p_account;
 insert into icash_seller_agreement_private.confirmations(call_key,account_id,deal_id,confirmation,terms,state)
 values('sms:'||j.message_id,p_account,d.id,confirmation,terms,'preparing') returning id into new_id;
 if public.icash_seller_memory_enabled(p_account) and not icash_seller_agreement_memory_private.remember(new_id,
   jsonb_build_object('accountId',p_account,'dealId',d.id,'screeningId',d.screening_id,'phone',memory_phone,'callKey','sms:'||j.message_id),null,memory_source,null)
  then raise exception 'Original seller text admission changed';end if;
 update public.icash_text_ai_jobs set state='handoff',analysis=analysis||jsonb_build_object('agreementClaim',new_id),updated_at=now() where id=j.id;
 update public.icash_seller_reply_progress set state='waiting',milestone='contract_preparation',reason='agreement_preparing',wait_trigger='original signing provider receipt',next_step='Prepare the confirmed agreement once and reconcile its original delivery.',next_check_at=now()+interval '15 minutes' where message_id=j.message_id and account_id=p_account;
 return c||jsonb_build_object('claimId',new_id,'sellerName',terms->>'seller');
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_confirmed_seller_contract_text_current(p_account uuid, p_message uuid)
 RETURNS boolean
 LANGUAGE sql
 VOLATILE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.icash_contract_text_deliveries x
  join public.icash_text_messages m on m.id=x.message_id and m.account_id=x.account_id and m.thread_id=x.thread_id
  join public.icash_text_threads t on t.id=x.thread_id and t.account_id=x.account_id
  join public.icash_signing_envelopes e on e.id=x.envelope_id and e.account_id=x.account_id and e.deal_id=t.deal_id
  join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id and d.terms=e.terms and d.stage='draft'
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id and s.state='complete'
  join icash_seller_agreement_private.confirmations c on c.envelope_id=e.id and c.account_id=e.account_id and c.deal_id=e.deal_id
  join icash_call_offer_private.offers o on o.account_id=d.account_id and o.deal_id=d.id and o.snapshot=s.snapshot
  where x.account_id=p_account and x.message_id=p_message
   and m.direction='outgoing' and m.state='ready' and m.provider_id is null and m.customer_author_id is null
   and cardinality(m.asset_ids)=0 and m.attachments='[]'::jsonb
   and m.body ~ '^Review your contract: https://docuseal[.]com/s/[A-Za-z0-9_-]+$'
   and t.party='seller' and t.retired_at is null and not t.paused and not t.manual_only and t.ai_mode='auto'
   and e.kind='purchase' and not e.test_mode and e.state='awaiting_counterparty' and nullif(e.provider_id,'') is not null
   and public.icash_signing_action_allowed(p_account,e.id)
   and jsonb_array_length(e.recipients)=2 and e.recipients->0->>'id'=x.signer_id
   and e.recipients->0->>'phone'=t.recipient and e.recipients->0->>'name'=e.terms->>'seller'
   and e.terms->>'closingDate' ~ '^\d{4}-\d{2}-\d{2}$'
   and e.terms->>'closingDate'>to_char(now() at time zone 'Pacific/Kiritimati','YYYY-MM-DD')
   and c.state='ready' and c.created_at<=now()
   and (not public.icash_seller_memory_enabled(p_account) or icash_seller_agreement_memory_private.current(c.id))
   and (c.terms-array['assignmentFeeCents','assignmentDepositCents'])=(e.terms-array['assignmentFeeCents','assignmentDepositCents'])
   and c.confirmation @> '{"sendTextRequested":true,"termsConfirmed":true,"priceAndDateConfirmed":true,"allDecisionMakersAgree":true,"soleOwner":true,"materialFactsChanged":false}'::jsonb
   and c.confirmation->'agreedPriceCents'=e.terms->'priceCents'
   and c.confirmation->>'sellerLegalName'=e.terms->>'seller' and c.confirmation->>'closingDate'=e.terms->>'closingDate'
   and coalesce(o.state->>'acceptedPriceCents','') ~ '^[1-9][0-9]*$'
   and o.state->'acceptedPriceCents'=e.terms->'priceCents' and o.state->'quotedPriceCents'=e.terms->'priceCents'
   and not exists(select 1 from jsonb_each(o.state) flag where flag.key in
    ('factsPending','conditionPending','agreementRevisionRequired','contractBlocked','acceptanceConditional','payoffPending') and flag.value<>'false'::jsonb)
 );
$function$
;

CREATE OR REPLACE FUNCTION public.icash_ingest_text_event_before_operational(p_event jsonb, p_optout boolean)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;typ text:=p_event->>'type';v jsonb:=p_event->'data';n integer;stamp timestamptz;resolved_thread uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if typ in ('text.incoming.sms','text.incoming.mms','text.delivery.confirmed','text.delivery.failed','text.cancelled') then
  perform pg_advisory_xact_lock(hashtextextended(case when typ in ('text.incoming.sms','text.incoming.mms') then v->>'from' else v->>'to' end,74));
 end if;
 if v->>'message_id' is not null then perform pg_advisory_xact_lock(hashtextextended(v->>'message_id',75));end if;
 insert into public.icash_text_events(id,type,payload) values(p_event->>'id',typ,p_event) on conflict(id) do nothing;
 get diagnostics n=row_count;if n=0 then return;end if;
 if typ in ('text.incoming.sms','text.incoming.mms') then
 -- STOP applies even when the sender has never been mapped to a tenant.
 if p_optout then
 perform pg_advisory_xact_lock(hashtextextended(v->>'from',74));
 insert into public.icash_text_suppressions(phone,reason) values(v->>'from','Incoming opt-out') on conflict(phone) do nothing;
 update public.icash_text_messages m set state='cancelled',updated_at=now() from public.icash_text_threads th where m.thread_id=th.id and th.recipient=v->>'from' and m.direction='outgoing' and m.state='ready';
 end if;
 resolved_thread:=public.icash_sms_resolve_property(v->>'to',v->>'from',v->>'body');
 select * into t from public.icash_text_threads where id=resolved_thread;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,attachments,state,event_id,provider_id) values(t.id,t.account_id,'incoming',coalesce(v->>'body',''),coalesce(v->'attachments','[]'),'received',p_event->>'id',nullif(v->>'message_id','')) on conflict do nothing;
 elsif typ='numbers.substitution' then
 update public.icash_text_senders set enabled=false where phone=v->>'from';
 elsif typ in ('text.delivery.confirmed','text.delivery.failed','text.cancelled') then
 stamp:=to_timestamp((p_event->>'timestamp')::double precision);
 update public.icash_text_messages m set state=case when typ='text.delivery.confirmed' then 'delivered' when typ='text.cancelled' then 'cancelled' else 'needs_review' end,last_delivery_at=stamp,updated_at=now()
 from public.icash_text_threads th where m.thread_id=th.id and m.provider_id=v->>'message_id' and th.sender=v->>'from' and th.recipient=v->>'to' and m.direction='outgoing'
 and (m.last_delivery_at is null or m.last_delivery_at<=stamp) and (m.state<>'delivered' or typ='text.delivery.confirmed');
 end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_save_live_result(p_call uuid, p_result jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_live_conversations; prop text; due timestamptz; zone text;memory_binding jsonb;memory_phone text;
begin
 select * into strict c from public.icash_live_conversations where id=p_call;
 if c.party='seller' and public.icash_seller_memory_enabled(c.account_id) then
  memory_binding:=jsonb_build_array(c.account_id,c.screening_id,c.contact_key);
  select min(phone) into memory_phone from (
   select t.recipient phone from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where t.account_id=c.account_id and d.screening_id=c.screening_id and t.party='seller' and t.retired_at is null and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=c.contact_key
   union select p.phone from public.icash_contact_permissions p where p.account_id=c.account_id and p.screening_id=c.screening_id and p.party='seller' and encode(sha256(convert_to(p.phone,'UTF8')),'hex')=c.contact_key
  ) phones having count(distinct phone)=1;
  if memory_phone is not null then perform pg_advisory_xact_lock(hashtextextended(memory_phone,74));end if;
 end if;
 select * into strict c from public.icash_live_conversations where id=p_call for update;
 if memory_binding is not null and memory_binding is distinct from jsonb_build_array(c.account_id,c.screening_id,c.contact_key) then raise exception 'Seller call source binding changed';end if;
 if c.state='complete' then if c.result<>p_result then raise exception 'Conflicting result';end if;return;end if;
 if octet_length(p_result::text)>262144 or jsonb_typeof(p_result->'transcript') is distinct from 'array' or nullif(p_result->>'summary','') is null or p_result->>'party' is distinct from c.party then raise exception 'Invalid result';end if;
 select snapshot->>'propertyId' into strict prop from public.icash_screening_jobs where id=c.screening_id and account_id=c.account_id;
 if exists(select 1 from public.icash_inbound_voice_receipts where live_call_id=c.id) then
  perform public.icash_open_handoff(c.id,'Incoming caller details need verification',left(p_result->>'summary',6000),'Confirm the caller and property before using saved deal terms.');
 end if;
 if (p_result->>'humanRequested')::boolean then perform public.icash_open_handoff(c.id,'Requested a person',left(p_result->>'summary',6000),p_result->>'nextAction');end if;
 update public.icash_handoffs set summary=left(p_result->>'summary',6000) where conversation_id=c.id;
 if (case when c.party='seller' then public.icash_seller_call_disposition(p_result)='opt_out' else coalesce((p_result->>'optedOut')::boolean,false) end) then
  insert into public.icash_contact_suppressions(account_id,contact_key,source_conversation) values(c.account_id,c.contact_key,c.id) on conflict do nothing;
  insert into public.icash_property_controls(account_id,property_id,manual) values(c.account_id,prop,true) on conflict(account_id,property_id) do update set manual=true,updated_at=now();
  update public.icash_live_callbacks b set state='canceled' from public.icash_live_conversations v where b.conversation_id=v.id and v.account_id=c.account_id and v.contact_key=c.contact_key and b.state in ('pending_dispatch_review','held_for_human');
 elsif p_result->>'callbackDueAt' is not null then
  due:=(p_result->>'callbackDueAt')::timestamptz;zone:=p_result->>'callbackTimezone';
  if not exists(select 1 from public.icash_timezone_names where name=zone) or due>now()+interval '90 days' then raise exception 'Invalid callback time';end if;
  insert into public.icash_live_callbacks(conversation_id,account_id,screening_id,due_at,timezone,evidence,state)
  values(c.id,c.account_id,c.screening_id,due,zone,jsonb_build_object('quote',p_result->'callbackQuote','readback',p_result->'callbackEvidence'),case when due<=now() then 'missed' when exists(select 1 from public.icash_property_controls where account_id=c.account_id and property_id=prop and manual) then 'held_for_human' else 'pending_dispatch_review' end) on conflict(conversation_id) do update set due_at=excluded.due_at,timezone=excluded.timezone,evidence=excluded.evidence,state=excluded.state where icash_live_callbacks.state in ('pending_dispatch_review','held_for_human');
 else
  -- A tool request is provisional until the provider transcript verifies it.
  update public.icash_live_callbacks set state='canceled' where conversation_id=c.id and state in ('pending_dispatch_review','held_for_human');
 end if;
 update public.icash_live_conversations set result=p_result,state='complete',completed_at=now(),tool_token_hash=null where id=c.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_save_seller_history_before_viewings(p_session uuid, p_conversation text, p_transcript jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s icash_recorded_reception_private.sessions; b icash_seller_agreement_private.inbound_bindings;screen uuid;
begin
 if jsonb_typeof(p_transcript) is distinct from 'array' or jsonb_array_length(p_transcript) not between 1 and 80
 or exists(select 1 from jsonb_array_elements(p_transcript) t where jsonb_typeof(t) is distinct from 'object' or coalesce(t->>'role','') not in ('agent','user') or jsonb_typeof(t->'message') is distinct from 'string' or length(t->>'message')>12000 or t-array['role','message']<>'{}'::jsonb) then return false;end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation;
 if found and public.icash_seller_memory_enabled(s.account_id) then perform pg_advisory_xact_lock(hashtextextended(s.from_phone,74));end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation and call_ended_at between now()-interval '30 days' and now();
 if not found then return false;end if;
 select * into b from icash_seller_agreement_private.inbound_bindings where session_id=s.id and account_id=s.account_id;
 if not found then return false;end if;
 select d.screening_id into screen from public.icash_deal_files d join public.icash_text_threads t on t.id=b.thread_id and t.account_id=d.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=s.from_phone where d.id=b.deal_id and d.account_id=s.account_id;
 if screen is null then return false;end if;
 delete from icash_seller_agreement_private.call_history h where h.completed_at<now()-interval '30 days'
  and (not public.icash_seller_memory_enabled(h.account_id) or (public.icash_seller_memory_enabled(s.account_id)
   and h.account_id=s.account_id and h.screening_id=screen and h.contact_key=encode(sha256(convert_to(s.from_phone,'UTF8')),'hex')));
 insert into icash_seller_agreement_private.call_history values(s.id,s.account_id,screen,encode(sha256(convert_to(s.from_phone,'UTF8')),'hex'),s.conversation_id,s.call_ended_at,p_transcript) on conflict do nothing;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_save_seller_memory(p_account uuid, p_screening uuid, p_phone text, p_fingerprint text, p_projection jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare source jsonb;
begin
 if p_projection->>'version' is distinct from 'seller-memory-v1' or jsonb_typeof(p_projection->'facts') is distinct from 'object'
  or octet_length(p_projection::text)>20000 then return false;end if;
 if public.icash_seller_memory_enabled(p_account) then perform pg_advisory_xact_lock(hashtextextended(p_phone,74));end if;
 source:=public.icash_seller_memory_context(p_account,p_screening,p_phone);
 if source->>'fingerprint' is distinct from p_fingerprint or source->>'complete' is distinct from 'true' then return false;end if;
 -- Every projected fact retains an exact seller statement in this source. The
 -- service computes meaning; a cache never grants a price, call or signature.
 if exists(select 1 from jsonb_each(p_projection->'facts') f where not exists(
  select 1 from jsonb_array_elements(source->'conversations') c cross join lateral jsonb_array_elements(c->'transcript') with ordinality turns(t,n)
  where t->>'role'='user' and trim(t->>'message')=f.value->>'quote'
   and coalesce(t->>'sourceId',c->>'sourceId'||':'||(n-1))=f.value->>'sourceId'
 )) then return false;end if;
 -- Retain source-backed inbound answers when the older 30-day context expires.
 -- Reset/retirement still changes the binding; this table grants no authority.
 insert into icash_seller_memory_private.call_sources(session_id,account_id,screening_id,contact_key,conversation_id,completed_at,transcript,complete)
 select h.session_id,h.account_id,h.screening_id,h.contact_key,h.conversation_id,h.completed_at,h.transcript,true
 from icash_seller_agreement_private.call_history h
 where h.account_id=p_account and h.screening_id=p_screening and h.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
 and h.completed_at<=now() and jsonb_array_length(h.transcript)<80
 on conflict do nothing;
 insert into icash_seller_memory_private.snapshots(account_id,screening_id,contact_key,source_fingerprint,extractor_version,projection)
 values(p_account,p_screening,encode(sha256(convert_to(p_phone,'UTF8')),'hex'),p_fingerprint,'seller-memory-v1',p_projection)
 on conflict do nothing;
 return true;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_save_seller_memory_inbound_history(p_session uuid, p_conversation text, p_transcript jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare h icash_seller_agreement_private.call_history;legacy jsonb;whole jsonb;clipped jsonb;memory_phone text;
begin
 select s.from_phone into memory_phone from icash_recorded_reception_private.sessions s where s.id=p_session and s.conversation_id=p_conversation and public.icash_seller_memory_enabled(s.account_id);
 if memory_phone is not null then perform pg_advisory_xact_lock(hashtextextended(memory_phone,74));end if;
 select * into h from icash_seller_agreement_private.call_history where session_id=p_session and conversation_id=p_conversation;
 if not found or not public.icash_seller_memory_enabled(h.account_id) then return true;end if;
 if jsonb_typeof(p_transcript) is distinct from 'array' or jsonb_array_length(p_transcript) not between 1 and 1001 or octet_length(p_transcript::text)>2000000
 or exists(select 1 from jsonb_array_elements(p_transcript) t where jsonb_typeof(t) is distinct from 'object' or t->>'role' not in ('agent','user')
  or jsonb_typeof(t->'message') is distinct from 'string' or length(t->>'message')>12000 or t-array['role','message','at']<>'{}'::jsonb
  or (t?'at' and (jsonb_typeof(t->'at') is distinct from 'string' or (t->>'at')::timestamptz>h.completed_at))) then return false;end if;
 select jsonb_agg(jsonb_build_object('role',t->>'role','message',t->>'message') order by n) into whole from jsonb_array_elements(p_transcript) with ordinality x(t,n);
 select jsonb_agg(t order by n) into clipped from jsonb_array_elements(whole) with ordinality x(t,n) where jsonb_array_length(whole)<=80 or n<=40 or n>jsonb_array_length(whole)-40;
 if h.transcript is distinct from clipped then return false;end if;
 insert into icash_seller_memory_private.call_sources values(h.session_id,h.account_id,h.screening_id,h.contact_key,h.conversation_id,h.completed_at,p_transcript,jsonb_array_length(p_transcript)<=1000,now(),true)
 on conflict(session_id) do update set transcript=excluded.transcript,complete=excluded.complete,full_source=true
 where not call_sources.full_source and call_sources.transcript=clipped;
 select transcript into legacy from icash_seller_memory_private.call_sources where session_id=p_session;
 return legacy=p_transcript;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_transition_recorded_reception(p_id uuid, p_account uuid, p_operation text, p_expected_version bigint, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_recorded_reception_private.sessions;t timestamptz;started timestamptz;finished timestamptz;utterance text;ns text;
begin
 if p_action='call_ended' then
  perform pg_advisory_xact_lock(hashtextextended(s.from_phone,74)) from icash_recorded_reception_private.sessions s
  where s.id=p_id and s.account_id=p_account and s.operation_key=p_operation and public.icash_seller_memory_enabled(s.account_id);
 end if;
 if p_action='stop' then perform 1 from public.icash_operating_budget where id=1 for update;end if;
 select * into r from icash_recorded_reception_private.sessions where id=p_id and account_id=p_account and operation_key=p_operation and row_version=p_expected_version for update;
 if not found then return null;end if;t:=icash_recorded_reception_private.clock_now();ns:=r.state;
 if r.state='deleted' and p_action not in ('call_ended','bind_conversation','request_end') then return null;end if;
 -- Fresh work honors current paused/disabled/review state. Cleanup and receipt
 -- reconciliation deliberately remain possible after these gates close.
 if p_action in ('claim_setup','bounded','consent','authorize_recording','claim_start','claim_register') then
  if r.end_requested_at is not null or r.call_ended_at is not null or r.call_deadline_at<=t or not exists(
   select 1 from icash_recorded_reception_private.configs c join public.icash_accounts a on a.id=c.account_id and a.owner_user_id=c.owner_user_id
   join public.icash_operation_spend o on o.account_id=a.id and o.operation_key=r.operation_key
   join public.icash_operation_rates rate on rate.id=r.rate_id
   where c.id=r.config_id and c.enabled and not a.bot_paused and icash_callback_private.config_current(c) and icash_callback_private.session_current(r) and c.approved_at<=t and c.reviewed_until>t
    and o.state='dispatched' and o.permission_until>t and o.rate_id=r.rate_id and o.charge_cap_cents=r.charge_cap_cents
    and rate.enabled and rate.expires_at>t and icash_recorded_reception_private.rate_binding(rate)=r.rate_snapshot
    and not exists(select 1 from icash_reception_private.config where enabled)
  ) then return null;end if;
 end if;
 if p_action='claim_setup' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid setup claim';end if;
  if r.state<>'reserved' or r.setup_claimed_at is not null then return null;end if;
  r.setup_claimed_at:=t;ns:='setup_pending';r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action='bounded' then
  if not icash_recorded_reception_private.keys(p_payload,array['callSid','providerAccountSid','fromPhone','toPhone','direction','timeLimitSeconds']) then raise exception 'Invalid bound call evidence';end if;
  if r.state<>'setup_pending' or r.setup_confirmed_at is not null or r.setup_claimed_at is null
   or row(r.call_sid,r.provider_account_sid,r.from_phone,r.to_phone,r.direction) is distinct from row(p_payload->>'callSid',p_payload->>'providerAccountSid',p_payload->>'fromPhone',p_payload->>'toPhone',p_payload->>'direction')
   or p_payload->'timeLimitSeconds' is distinct from to_jsonb(r.max_total_seconds) then return null;end if;
  r.setup_confirmed_at:=t;ns:='consent_pending';r.next_reconcile_at:=r.consent_deadline_at;
 elsif p_action='bind_call_start' then
  -- Receipt binding is recoverable after pause/expiry; it grants no new work.
  -- Only the service's canonical account/Call readback can supply this value.
  if not icash_recorded_reception_private.keys(p_payload,array['callSid','providerAccountSid','fromPhone','toPhone','direction','status','callStartedAt'])
   or jsonb_typeof(p_payload->'callStartedAt') is distinct from 'string' then raise exception 'Invalid answered call evidence';end if;
  if r.setup_confirmed_at is null or r.call_started_at is not null or r.consent_at is not null
   or row(r.call_sid,r.provider_account_sid,r.from_phone,r.to_phone,r.direction) is distinct from row(p_payload->>'callSid',p_payload->>'providerAccountSid',p_payload->>'fromPhone',p_payload->>'toPhone',p_payload->>'direction')
   or coalesce(p_payload->>'status','') not in ('in-progress','completed','failed','canceled') then return null;end if;
  started:=(p_payload->>'callStartedAt')::timestamptz;
  if not isfinite(started) or started<r.created_at-interval '1 second' or started>r.created_at+interval '60 seconds' or started>t+interval '1 second'
   or started+make_interval(secs=>r.max_total_seconds)>least((r.configuration->>'reviewed_until')::timestamptz,(r.rate_snapshot->>'expires_at')::timestamptz,coalesce((r.cost_policy_snapshot->>'reviewed_until')::timestamptz,'infinity'::timestamptz)) then return null;end if;
  r.call_started_at:=started;r.call_deadline_at:=started+make_interval(secs=>r.max_total_seconds);r.consent_deadline_at:=started+interval '45 seconds';
  r.next_reconcile_at:=case when r.end_requested_at is not null or r.call_ended_at is not null then t else least(r.next_reconcile_at,r.consent_deadline_at) end;
 elsif p_action in ('setup_unknown','start_unknown','register_unknown') then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid uncertain outcome';end if;
  if (p_action='setup_unknown' and (r.setup_claimed_at is null or r.setup_confirmed_at is not null))
   or (p_action='start_unknown' and (r.start_claimed_at is null or r.recording_sid is not null))
   or (p_action='register_unknown' and (r.register_claimed_at is null or r.conversation_id is not null)) then return null;end if;
  ns:='failed';r.last_error:=p_action||'_no_retry';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='consent' then
  if r.entry_policy='direct_recorded_v1' then return null;end if;
  if p_payload ? 'evidenceVersion' then
   if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion','evidenceVersion','resultKind','confidenceBasis','confidenceReported','confidencePolicy']) then raise exception 'Invalid spoken consent evidence';end if;
   if not icash_voice_consent_private.valid_final_evidence_v4(p_payload) then return null;end if;
  else
   if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion']) or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or jsonb_typeof(p_payload->'confidence') is distinct from 'number' then raise exception 'Invalid spoken consent evidence';end if;
   utterance:=lower(btrim(regexp_replace(btrim(p_payload->>'utterance'),'[.!]+$','')));
   if (p_payload->>'confidence')::numeric not between 0.9 and 1 or utterance not in ('yes','yeah','yep','sure','yes please','yes that''s okay','yes you can record','yes i agree','i agree','i consent','yes you may record') then return null;end if;
  end if;
  if length(p_payload->>'utterance') not between 1 and 120 or r.state<>'consent_pending' or r.call_started_at is null or r.consent_at is not null or r.consent_deadline_at<=t or r.nonce_hash is distinct from p_payload->>'nonceHash'
   or r.disclosure_version is distinct from p_payload->>'disclosureVersion' or p_payload->>'source' is distinct from 'twilio_gather_speech' then return null;end if;
  r.consent_at:=t;r.consent_evidence:=jsonb_build_object('method','speech','source','twilio_gather_speech','utterance',case when p_payload ? 'evidenceVersion' then p_payload->>'utterance' else btrim(p_payload->>'utterance') end,'confidence',p_payload->'confidence','accountSid',r.provider_account_sid,'callSid',r.call_sid,'disclosureVersion',r.disclosure_version);
  if p_payload ? 'evidenceVersion' then r.consent_evidence:=r.consent_evidence||jsonb_build_object('evidenceVersion',p_payload->>'evidenceVersion','resultKind','gather_action_final','confidenceBasis',p_payload->>'confidenceBasis','confidenceReported',p_payload->'confidenceReported','confidencePolicy','advisory');end if;
 elsif p_action='contact_opt_out' then
  if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','utterance']) or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or length(p_payload->>'utterance') not between 1 and 16384 then raise exception 'Invalid contact opt-out';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null or r.nonce_hash is distinct from p_payload->>'nonceHash' or not icash_voice_consent_private.contact_opt_out_v3(p_payload->>'utterance') then return null;end if;
  if r.from_phone ~ '^\+[1-9][0-9]{7,14}$' then
   insert into public.icash_text_suppressions(phone,reason) values(r.from_phone,'voice_recording_gate_opt_out:'||r.id::text) on conflict(phone) do nothing;
  end if;
  ns:='declined';r.last_error:='contact_opt_out';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='decline' then
  if not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') not in ('declined','timeout','ambiguous') then raise exception 'Invalid decline';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null then return null;end if;
  ns:='declined';r.last_error:=p_payload->>'reason';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='authorize_recording' then
  -- Operator-authorized recording. This is NOT a caller's spoken yes; consent evidence remains null.
  if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','policy']) then raise exception 'Invalid recording authority';end if;
  if r.entry_policy<>'direct_recorded_v1' or p_payload->>'policy'<>'direct_recorded_v1' or r.nonce_hash is distinct from p_payload->>'nonceHash'
   or r.state<>'consent_pending' or r.consent_at is not null or r.recording_authorized_at is not null or r.start_claimed_at is not null
   or r.consent_deadline_at<=t or r.call_started_at is null or r.setup_confirmed_at is null then return null;end if;
  r.recording_authorized_at:=t;
 elsif p_action='claim_start' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid start claim';end if;
  if r.state<>'consent_pending' or coalesce(r.consent_at,r.recording_authorized_at) is null or r.start_claimed_at is not null or r.consent_deadline_at<=t then return null;end if;
  ns:='starting';r.start_claimed_at:=t;r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action in ('started','processing','available') then
  if not icash_recorded_reception_private.keys(p_payload,case when p_action='available' then array['recordingSid','providerStartedAt','endedAt','durationSeconds'] else array['recordingSid','providerStartedAt'] end,case when p_action='available' then array['providerRecordingPriceMicros'] else '{}'::text[] end)
   or coalesce(p_payload->>'recordingSid','') !~ '^RE[0-9a-fA-F]{32}$' or jsonb_typeof(p_payload->'providerStartedAt') is distinct from 'string' then raise exception 'Invalid recording evidence';end if;
  if r.start_claimed_at is null or coalesce(r.consent_at,r.recording_authorized_at) is null or r.state not in ('starting','recording','stopping','processing','available','failed','absent') then return null;end if;
  started:=(p_payload->>'providerStartedAt')::timestamptz;
  if not isfinite(started) or started<coalesce(r.consent_at,r.recording_authorized_at)-interval '1 second' or started>t+interval '1 minute' or started>r.call_deadline_at
   or (r.recording_sid is not null and r.recording_sid is distinct from p_payload->>'recordingSid')
   or (r.provider_started_at is not null and r.provider_started_at is distinct from started
    and not (p_action='available' and started>r.provider_started_at and started<=r.provider_started_at+interval '1 second'))
   or (p_action='available' and r.final_provider_started_at is not null and r.final_provider_started_at is distinct from started) then return null;end if;
  -- Keep the initial start and earliest retention deadline immutable. Final
  -- whole-second provider metadata may advance by at most one second.
  r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=coalesce(r.provider_started_at,started);r.audio_expires_at:=r.provider_started_at+interval '720 hours';r.next_delete_at:=coalesce(r.next_delete_at,r.audio_expires_at);
  if p_action='available' then
   if not icash_recorded_reception_private.micros(p_payload->'durationSeconds') or (p_payload->>'durationSeconds')::numeric>r.max_total_seconds
    or jsonb_typeof(p_payload->'endedAt') is distinct from 'string'
    or (p_payload ? 'providerRecordingPriceMicros' and not icash_recorded_reception_private.micros(p_payload->'providerRecordingPriceMicros')) then raise exception 'Invalid completed recording';end if;
   finished:=(p_payload->>'endedAt')::timestamptz;
   if not isfinite(finished) or finished<>started+make_interval(secs=>(p_payload->>'durationSeconds')::integer) or finished>t+interval '1 minute' or finished>r.call_deadline_at+interval '2 seconds'
    or (r.ended_at is not null and row(r.ended_at,r.duration_seconds) is distinct from row(finished,(p_payload->>'durationSeconds')::integer))
    or (r.provider_recording_price_micros is not null and r.provider_recording_price_micros is distinct from (p_payload->>'providerRecordingPriceMicros')::bigint) then return null;end if;
   r.final_provider_started_at:=started;r.ended_at:=finished;r.duration_seconds:=(p_payload->>'durationSeconds')::integer;r.provider_recording_price_micros:=(p_payload->>'providerRecordingPriceMicros')::bigint;r.price_is_estimate:=r.provider_recording_price_micros is null;
   ns:=case when r.audio_expires_at<=t then 'expired' else 'available' end;
  elsif p_action='processing' then ns:='processing';
  else ns:=case when r.end_requested_at is not null then 'stopping' when r.state in ('processing','available') then r.state else 'recording' end;end if;
  r.next_reconcile_at:=t+interval '1 minute';
 elsif p_action='claim_register' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid registration claim';end if;
  if r.state<>'recording' or r.recording_sid is null or r.register_claimed_at is not null or r.conversation_id is not null then return null;end if;
  r.register_claimed_at:=t;r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action='bind_conversation' then
  if not icash_recorded_reception_private.keys(p_payload,array['conversationId','agentId','branchId','versionId']) or coalesce(p_payload->>'conversationId','') !~ '^conv_[A-Za-z0-9_-]{1,160}$' then raise exception 'Invalid conversation evidence';end if;
  if r.register_claimed_at is null or r.recording_sid is null or r.conversation_id is not null
   or row(r.agent_id,r.branch_id,r.version_id) is distinct from row(p_payload->>'agentId',p_payload->>'branchId',p_payload->>'versionId') then return null;end if;
  r.conversation_id:=p_payload->>'conversationId';r.next_reconcile_at:=t;
 elsif p_action in ('stop','request_end','fail') then
  if p_action='stop' then
   if not icash_recorded_reception_private.keys(p_payload,array['stopTokenHash']) then raise exception 'Invalid stop request';end if;
   if r.stop_token_hash is distinct from p_payload->>'stopTokenHash' or r.start_claimed_at is null then return null;end if;
   if r.state not in ('available','expired','deletion_pending','deleted','absent') then ns:='stopping';end if;
  else
   if not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$' then raise exception 'Invalid end reason';end if;
   r.last_error:=p_payload->>'reason';if p_action='fail' and r.state not in ('available','expired','deletion_pending','deleted','absent') then ns:='failed';end if;
  end if;
  r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='call_ended' then
  if not icash_recorded_reception_private.keys(p_payload,array['callSid','providerAccountSid','fromPhone','toPhone','direction','status']) then raise exception 'Invalid call receipt';end if;
  if row(r.call_sid,r.provider_account_sid,r.from_phone,r.to_phone,r.direction) is distinct from row(p_payload->>'callSid',p_payload->>'providerAccountSid',p_payload->>'fromPhone',p_payload->>'toPhone',p_payload->>'direction') or coalesce(p_payload->>'status','') not in ('completed','failed','busy','no-answer','canceled')
   or (r.call_terminal_status is not null and r.call_terminal_status is distinct from p_payload->>'status') then return null;end if;
  r.call_ended_at:=coalesce(r.call_ended_at,t);r.call_terminal_status:=p_payload->>'status';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
  if r.start_claimed_at is null and r.state not in ('declined','failed') then ns:='failed';r.last_error:=coalesce(r.last_error,'carrier_terminal_before_recording');end if;
 elsif p_action='absent' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid absent evidence';end if;
  if r.start_claimed_at is null or r.state in ('available','expired','deletion_pending','deleted') then return null;end if;
  ns:='absent';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='expire' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid expiry';end if;
  if r.recording_sid is null or r.audio_expires_at>t or r.state in ('deletion_pending','deleted') then return null;end if;
  ns:='expired';r.next_delete_at:=t;
 else raise exception 'Unknown recorded reception action';end if;
 update icash_recorded_reception_private.sessions set state=ns,call_started_at=r.call_started_at,call_deadline_at=r.call_deadline_at,consent_deadline_at=r.consent_deadline_at,setup_claimed_at=r.setup_claimed_at,setup_confirmed_at=r.setup_confirmed_at,consent_at=r.consent_at,consent_evidence=r.consent_evidence,recording_authorized_at=r.recording_authorized_at,start_claimed_at=r.start_claimed_at,register_claimed_at=r.register_claimed_at,
  recording_sid=r.recording_sid,conversation_id=r.conversation_id,provider_started_at=r.provider_started_at,final_provider_started_at=r.final_provider_started_at,ended_at=r.ended_at,duration_seconds=r.duration_seconds,audio_expires_at=r.audio_expires_at,
  provider_recording_price_micros=r.provider_recording_price_micros,price_is_estimate=r.price_is_estimate,end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,call_terminal_status=r.call_terminal_status,
  next_reconcile_at=r.next_reconcile_at,next_delete_at=r.next_delete_at,last_error=r.last_error,last_action=p_action,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_finish_recorded_reception_work(p_id uuid, p_account uuid, p_operation text, p_kind text, p_lease_token uuid, p_expected_version bigint, p_outcome text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_recorded_reception_private.sessions;result jsonb;t timestamptz;
begin
 if p_kind='reconcile' and p_outcome='call_ended' then
  perform pg_advisory_xact_lock(hashtextextended(s.from_phone,74)) from icash_recorded_reception_private.sessions s
  where s.id=p_id and s.account_id=p_account and s.operation_key=p_operation and public.icash_seller_memory_enabled(s.account_id);
 end if;
 select * into r from icash_recorded_reception_private.sessions where id=p_id and account_id=p_account and operation_key=p_operation and row_version=p_expected_version for update;
 if not found then return null;end if;t:=icash_recorded_reception_private.clock_now();
 if p_kind='delete' then
  if r.state<>'deletion_pending' or p_lease_token is null or r.deletion_lease_token is distinct from p_lease_token or r.deletion_lease_expires_at<=t then return null;end if;
  if p_outcome='deleted' then
   if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid deletion receipt';end if;
   update icash_recorded_reception_private.sessions set state='deleted',deleted_at=t,deletion_lease_token=null,deletion_lease_expires_at=null,next_delete_at=null,last_action='deleted',row_version=row_version+1,updated_at=t where id=r.id returning * into r;
  elsif p_outcome='retry' then
   if not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$' then raise exception 'Invalid deletion retry';end if;
   update icash_recorded_reception_private.sessions set deletion_lease_token=null,deletion_lease_expires_at=null,next_delete_at=t+make_interval(secs=>least(3600,60*greatest(1,least(deletion_attempts,60)))),last_error=p_payload->>'reason',last_action='delete_retry',row_version=row_version+1,updated_at=t where id=r.id returning * into r;
  else raise exception 'Invalid deletion outcome';end if;
 elsif p_kind='reconcile' then
  if p_lease_token is null or r.reconcile_lease_token is distinct from p_lease_token or r.reconcile_lease_expires_at<=t then return null;end if;
  if p_outcome in ('retry','done','checked') then
   if p_outcome='checked' and not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid check receipt';end if;
   if p_outcome='retry' and (not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$') then raise exception 'Invalid reconciliation retry';end if;
   if p_outcome='done' and (not icash_recorded_reception_private.keys(p_payload,'{}') or r.call_ended_at is null or r.billing_state<>'settled' or (r.register_claimed_at is not null and r.conversation_id is null) or (r.start_claimed_at is not null and r.state not in ('available','expired','deleted','absent'))) then return null;end if;
  elsif p_outcome in ('started','processing','available','absent','call_ended','bind_conversation') then
   result:=public.icash_transition_recorded_reception(r.id,r.account_id,r.operation_key,r.row_version,p_outcome,p_payload);
   if result is null then return null;end if;
  else raise exception 'Invalid reconciliation outcome';end if;
  update icash_recorded_reception_private.sessions set reconcile_lease_token=null,reconcile_lease_expires_at=null,next_reconcile_at=case when p_outcome='done' or (p_outcome='checked' and call_ended_at is not null and billing_state='settled' and (register_claimed_at is null or conversation_id is not null) and (start_claimed_at is null or state in ('available','expired','deleted','absent'))) then null
   -- recorded-reception-identity-backoff-v1: a bound callback or other
   -- transition during this lease must remain due, even when finish rereads
   -- its new row version. Both orders serialize on the original session lock.
   when last_action<>'claim_reconcile' and next_reconcile_at<=t then t
   when p_outcome='retry' and p_payload->>'reason' in ('conversation_identity_required','conversation_binding_required')
    and last_action='claim_reconcile' and call_ended_at<=t-interval '24 hours'
    and call_terminal_status in ('completed','failed','busy','no-answer','canceled')
    and state in ('available','expired','deletion_pending','deleted')
    and recording_sid is not null and register_claimed_at is not null and conversation_id is null
    and billing_state='reserved' and reconcile_attempts>=3
    then t+case when reconcile_attempts>=12 then interval '1 hour'
      when reconcile_attempts>=6 then interval '15 minutes' else interval '5 minutes' end
   else t+interval '1 minute' end,
   last_error=case when p_outcome='retry' then p_payload->>'reason' else last_error end,last_action='reconcile_'||p_outcome,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 else raise exception 'Invalid work kind';end if;
 return to_jsonb(r);
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_claim_agreement_delivery_recovery()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_seller_agreement_private.delivery_recovery;email text;current_terms jsonb;
begin
 select j.* into r from icash_seller_agreement_private.delivery_recovery j
 join public.icash_accounts a on a.id=j.account_id and a.owner_user_id=j.requested_by and not a.bot_paused
 join public.icash_deal_files d on d.id=j.deal_id and d.account_id=j.account_id and d.stage='draft'
  and (d.terms-array['assignmentFeeCents','assignmentDepositCents'])=(j.expected_terms-array['assignmentFeeCents','assignmentDepositCents']) and d.terms->>'seller'=j.seller_name
 join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=j.account_id and s.state='complete'
 join auth.users u on u.id=j.requested_by and u.email is not null and u.email_confirmed_at is not null
 where (j.state='queued' or (
  j.state='needs_review' and j.result='{"sent":false,"status":"held"}'::jsonb
  and j.claimed_at<now()-interval '1 minute' and j.request_key like 'seller-confirmed:%'
  and exists(select 1 from public.icash_contract_text_deliveries x
   join public.icash_text_messages m on m.id=x.message_id and m.account_id=x.account_id and m.thread_id=x.thread_id
   join icash_seller_agreement_private.confirmations c on c.envelope_id=x.envelope_id and c.account_id=x.account_id and c.deal_id=j.deal_id
   where x.account_id=j.account_id and x.envelope_id=j.envelope_id and j.request_key='seller-confirmed:'||c.id::text
    and public.icash_confirmed_seller_contract_text_current(j.account_id,m.id)
    and not exists(select 1 from public.icash_operation_spend spend where spend.operation_key='text:'||m.id)
  ))) and j.expires_at>now() and public.icash_membership_work_allowed(j.account_id)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=j.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and exists(select 1 from public.icash_text_threads t where t.account_id=j.account_id and t.deal_id=j.deal_id and t.recipient=j.phone and t.party='seller'
  and t.retired_at is null and not t.paused and not t.manual_only and public.icash_sms_thread_review_current(j.account_id,t.id,true))
 and not exists(select 1 from public.icash_text_suppressions x where x.phone=j.phone)
 and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=encode(sha256(convert_to(j.phone,'UTF8')),'hex'))
 -- Automatic recovery retains the current offer-authority guards. A later
 -- withdrawal, changed property facts or revised quote invalidates old consent.
 and (j.request_key not like 'seller-confirmed:%' or not exists(
  select 1 from icash_call_offer_private.offers o where o.account_id=j.account_id and o.deal_id=j.deal_id
  and (o.snapshot is distinct from s.snapshot or coalesce(o.state->>'acceptedPriceCents','') !~ '^[1-9][0-9]*$'
   or o.state->'acceptedPriceCents' is distinct from d.terms->'priceCents' or o.state->'quotedPriceCents' is distinct from d.terms->'priceCents'
   or o.state->'factsPending'='true'::jsonb or o.state->'conditionPending'='true'::jsonb or o.state->'agreementRevisionRequired'='true'::jsonb
   or o.state->'contractBlocked'='true'::jsonb or o.state->'acceptanceConditional'='true'::jsonb or o.state->'payoffPending'='true'::jsonb)))
 and (not public.icash_seller_memory_enabled(j.account_id) or j.request_key not like 'seller-confirmed:%'
  or exists(select 1 from icash_seller_agreement_private.confirmations c where c.account_id=j.account_id and c.deal_id=j.deal_id
   and j.request_key='seller-confirmed:'||c.id::text and icash_seller_agreement_memory_private.review_ready(c.id)))
 order by j.created_at for update of j,d skip locked limit 1;
 if not found then return null;end if;
 select u.email into email from auth.users u where u.id=r.requested_by;
 select d.terms into current_terms from public.icash_deal_files d where d.id=r.deal_id and d.account_id=r.account_id;
 update icash_seller_agreement_private.delivery_recovery set state='claimed',claimed_at=now(),expected_terms=current_terms where id=r.id;
 return jsonb_build_object('id',r.id,'accountId',r.account_id,'userId',r.requested_by,'customerEmail',email,'dealId',r.deal_id,'phone',r.phone,'sellerName',r.seller_name,'expectedTerms',current_terms,'memoryReviewRequired',public.icash_seller_memory_enabled(r.account_id) and r.request_key like 'seller-confirmed:%');
end $function$
;

revoke all on all functions in schema icash_seller_agreement_memory_private from public,anon,authenticated,service_role;
grant execute on function icash_seller_agreement_memory_private.current(uuid),icash_seller_agreement_memory_private.admit_purchase(uuid,uuid,uuid,jsonb) to service_role;
revoke all on function public.icash_claim_seller_agreement_before_memory(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb,text) to service_role;
revoke all on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb) to service_role;
revoke all on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb) to service_role;
revoke all on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb,text) from public,anon,authenticated;
grant execute on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb,text) to service_role;
revoke all on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb) to service_role;
revoke all on function public.icash_seller_agreement_memory_context(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_agreement_memory_context(uuid,uuid) to service_role;
revoke all on function public.icash_refresh_seller_agreement_memory(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_refresh_seller_agreement_memory(uuid,uuid,text,text,jsonb) to service_role;
do $unchanged$ begin if md5(pg_get_functiondef('public.icash_signing_action_allowed(uuid,uuid)'::regprocedure))<>'0c8dd6053164498e0f2e400d8e55d3b7' or md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure))<>'7a680dae86359988c3f70c705a3369b0' then raise exception 'Seller memory unrelated authority changed';end if;end $unchanged$;
do $results$
declare e record;p record;role_name text;table_name text;
begin
 for e in select * from (values
 ('public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)','7ffc621ba4f68474622cd28886c9302e',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_agreement_delivery_recovery()','f3e6103f13dda778780e33dab4069a4c',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb)','067caa5b2c6fbe57cc988ceef40d2430',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb,text)','e3e9f966f8e6a213deef43643b78ac01',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb)','11f85c6ef5cae298f5a8a7cc33d2135f',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_seller_agreement_before_memory(text,text,jsonb,jsonb,jsonb)','c4b1748fc26ce94a795fc218f56e7e58',true,'v','{postgres=X/postgres}'),
 ('public.icash_claim_seller_text_agreement(uuid,uuid)','142769dd2770623355cd4aca24b3ee92',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_claim_text_before_owner_question(uuid,uuid,text)','2ab7c58cc5a38b95651bb0ecb054d40d',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_confirmed_seller_contract_text_current(uuid,uuid)','c13c2bd2a578a67ad18bd234fc37ed73',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb)','15ec165fffbcb5135e0da48f4ab750cb',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb,text)','31f2a421e7eab7dbcbe4961e5b7766ee',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_defer_seller_agreement(text,text,jsonb,jsonb,jsonb,text,jsonb)','72a1ee1b4a76ac67daf7b67134618176',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb)','88c280613085bf4bcbf73ca9a2f3ce91',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb)','cd1cc13e60840806c48458e1f527497b',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_ingest_text_event(jsonb,boolean)','803a18e1b80d57c470440fb9b6e694f0',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_ingest_text_event_before_operational(jsonb,boolean)','299b21b220c28c7c0c96acfe3eb65c7e',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_refresh_seller_agreement_memory(uuid,uuid,text,text,jsonb)','b12b1cb42ad093486481176f4fa26b71',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_live_result(uuid,jsonb)','82af3a7c40a85cb346ad37f571b3fdca',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_seller_history_before_viewings(uuid,text,jsonb)','9d137e57f1e3c8c0f076316f73e00a56',true,'v','{postgres=X/postgres}'),
 ('public.icash_save_seller_inbound_history(uuid,text,jsonb)','7963d02462db6613dc199101cf41f3e9',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_seller_memory(uuid,uuid,text,text,jsonb)','cb500322550548af5e5ec881ddce9457',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_save_seller_memory_inbound_history(uuid,text,jsonb)','9796f1591a0eda07b0bee1cbfd917e00',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_seller_agreement_call_context(text,text)','7a8ff8331d8617f6692cbb8478259dd7',true,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_seller_agreement_memory_context(uuid,uuid)','029e3a8e9f27a3a3971859461be07d69',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('icash_seller_agreement_memory_private.admit_purchase(uuid,uuid,uuid,jsonb)','47f2c051ca6158a8b6a8dadf2576c794',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('icash_seller_agreement_memory_private.current(uuid)','8dac0c6ac25fb841587e4992fc181360',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('icash_seller_agreement_memory_private.current_source(uuid,uuid,text,uuid)','72cbe7bb1261d3a1e975e1707953622f',true,'v','{postgres=X/postgres}'),
 ('icash_seller_agreement_memory_private.immutable()','b80dccd1e11111decefe4843637bc78a',false,'v','{postgres=X/postgres}'),
 ('icash_seller_agreement_memory_private.manifest(jsonb,text)','e7e8711d171d8551a9dde41c8a0effcb',false,'i','{postgres=X/postgres}'),
 ('icash_seller_agreement_memory_private.original_call(icash_seller_agreement_memory_private.admissions,jsonb)','96972c4297ff2c152266b3b225b59ae9',true,'s','{postgres=X/postgres}'),
 ('icash_seller_agreement_memory_private.original_source(text)','ab7604c2e79701bc2c63b66475dc288d',false,'i','{postgres=X/postgres}'),
 ('icash_seller_agreement_memory_private.remember(uuid,jsonb,text,jsonb,jsonb)','a9091bc2ffbc0a18f29665dca2dbd43d',true,'v','{postgres=X/postgres}'),
 ('icash_seller_agreement_memory_private.review_ready(uuid)','500f2556dbb6f0c87a13b005f00a7248',true,'v','{postgres=X/postgres}'),
 ('public.icash_seller_memory_context(uuid,uuid,text)','7a680dae86359988c3f70c705a3369b0',true,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_seller_text_offer_context(uuid,uuid)','5f6e0a4049af7b8ca40b1bcb599f3547',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_signing_action_allowed(uuid,uuid)','0c8dd6053164498e0f2e400d8e55d3b7',false,'s','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_sms_message_route()','f9d2f04ed7e0dfe2e14cf095c5eee0c0',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
 ('public.icash_transition_recorded_reception(uuid,uuid,text,bigint,text,jsonb)','e346ec2f5a1e948e818f0875b144bca4',true,'v','{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,source_hash,definer,volatility,acl) loop
 select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl into p from pg_proc where oid=to_regprocedure(e.signature);
 if p.source_hash is distinct from e.source_hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from e.definer or p.provolatile::text is distinct from e.volatility
  or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""'] or p.acl is distinct from e.acl then raise exception 'Seller memory admission result changed: %',e.signature;end if;
 end loop;
 foreach table_name in array array['icash_seller_agreement_memory_private.admissions','icash_seller_agreement_memory_private.reviews'] loop
  if not exists(select 1 from pg_class c where c.oid=table_name::regclass and pg_get_userbyid(c.relowner)='postgres' and c.relrowsecurity) then raise exception 'Private seller memory table protection changed';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop
   if has_table_privilege(role_name,table_name,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Private seller memory table privilege changed';end if;
  end loop;
 end loop;
end $results$;
