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
 select coalesce(jsonb_agg(c order by n),'[]'::jsonb) from jsonb_array_elements(p_source->'conversations') with ordinality x(c,n)
 where c->>'sourceId' is distinct from icash_seller_agreement_memory_private.original_source(p_call_key)
$$;

-- The public projection uses transaction time. A writer that commits while this
-- transaction waits must not disappear behind that earlier clock boundary.
-- Owned original contract links are the only removed source: their creation
-- cannot revoke their own exact authorization, but any seller reply still does.
create function icash_seller_agreement_memory_private.current_source(p_account uuid,p_screening uuid,p_phone text,p_confirmation uuid default null)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare source jsonb;owned uuid[];calls jsonb;entry jsonb;turns jsonb;removed integer;deal uuid;
begin
 source:=public.icash_seller_memory_context(p_account,p_screening,p_phone);
 if source is null or source->'binding'->>'accountId' is distinct from p_account::text or source->'binding'->>'screeningId' is distinct from p_screening::text
  or source->'binding'->>'phone' is distinct from p_phone or source->>'receiptSourceComplete' is distinct from 'true' then return null;end if;
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
 return jsonb_set(jsonb_set(source,'{conversations}',calls),'{fingerprint}',to_jsonb(encode(sha256(convert_to(calls::text,'UTF8')),'hex')));
end $$;

-- Keep the public signing function invoker-owned. Only this narrow private
-- helper can inspect the private automatic confirmation and its source receipt.
create function icash_seller_agreement_memory_private.admit_purchase(p_account uuid,p_deal uuid,p_template uuid,p_recipients jsonb) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare phone text;confirmation uuid;d public.icash_deal_files;
begin
 if not public.icash_seller_memory_enabled(p_account)
  or not exists(select 1 from public.icash_signing_templates where id=p_template and not test_mode)
  or not exists(select 1 from icash_seller_agreement_private.confirmations where account_id=p_account and deal_id=p_deal) then return true;end if;
 select min(a.phone),(array_agg(c.id))[1] into phone,confirmation
 from icash_seller_agreement_private.confirmations c join icash_seller_agreement_memory_private.admissions a on a.confirmation_id=c.id and a.account_id=c.account_id and a.deal_id=c.deal_id
 join public.icash_deal_files df on df.id=c.deal_id and df.account_id=c.account_id and (df.terms-array['assignmentFeeCents','assignmentDepositCents'])=(c.terms-array['assignmentFeeCents','assignmentDepositCents'])
 where c.account_id=p_account and c.deal_id=p_deal and c.envelope_id is null and c.state in ('preparing','needs_review') having count(*)=1;
 if phone is null or phone is distinct from p_recipients->0->>'phone' then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(phone,74));
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or not exists(select 1 from icash_seller_agreement_private.confirmations c where c.id=confirmation and c.account_id=p_account and c.deal_id=p_deal
  and c.envelope_id is null and c.state in ('preparing','needs_review')
  and (c.terms-array['assignmentFeeCents','assignmentDepositCents'])=(d.terms-array['assignmentFeeCents','assignmentDepositCents'])) then return false;end if;
 return icash_seller_agreement_memory_private.current(confirmation);
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
 if p_call_prefix is not null and (jsonb_typeof(p_call_prefix) is distinct from 'object' or p_call_prefix-array['version','conversationId','pairCount','fingerprint']<>'{}'::jsonb
  or p_call_prefix->>'version' is distinct from 'seller-call-prefix-v1' or p_call_prefix->>'conversationId' is distinct from p_conversation
  or jsonb_typeof(p_call_prefix->'pairCount') is distinct from 'number'
  or coalesce(p_call_prefix->>'pairCount','') !~ '^[1-9][0-9]{0,3}$' or (p_call_prefix->>'pairCount')::integer>1000
  or coalesce(p_call_prefix->>'fingerprint','') !~ '^[a-f0-9]{64}$') then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(scope->>'phone',74));
 if public.icash_seller_agreement_call_context(p_hash,p_conversation) is distinct from scope then return null;end if;
 perform 1 from public.icash_deal_files where id=(scope->>'dealId')::uuid and account_id=(scope->>'accountId')::uuid for update;
 source:=icash_seller_agreement_memory_private.current_source((scope->>'accountId')::uuid,(scope->>'screeningId')::uuid,scope->>'phone');
 if source is null or source->>'fingerprint' is distinct from p_memory_fingerprint or source->'binding'->>'dealId' is distinct from scope->>'dealId' then return null;end if;
 claim:=public.icash_claim_seller_agreement_before_memory(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms);if claim is null then return null;end if;
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
