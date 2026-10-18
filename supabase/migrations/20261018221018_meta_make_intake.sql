begin;
set local lock_timeout='3s';

-- The owner may activate follow-up from an actual name/phone submission for
-- a specific source. Existing checkbox sources keep their original behavior.
alter table public.icash_meta_lead_sources add column contact_basis text not null default 'checkbox'
 check(contact_basis in ('checkbox','form_submission')),
 add constraint icash_meta_submission_no_call_now check(contact_basis<>'form_submission' or call_now_key is null);

-- Authenticated connector receipts are immutable, including test classification.
create table public.icash_make_lead_inbox(
 meta_id text primary key check(meta_id ~ '^[0-9]{5,40}$'),
 page_id text not null check(page_id ~ '^[0-9]{5,40}$'),
 form_id text not null check(form_id ~ '^[0-9]{5,40}$'),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=16384),
 payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
 is_test boolean not null default false,
 state text not null check(state in ('pending','fetching','accepted','review','test')),
 reason text,lead_id uuid references public.icash_meta_leads(lead_id),
 attempts integer not null default 0,claim_token uuid,claimed_at timestamptz,
 next_attempt_at timestamptz not null default now(),created_at timestamptz not null default now(),
 check(not is_test or state='test'),
 check(payload->>'id'=meta_id and payload->>'page_id'=page_id and payload->>'form_id'=form_id)
);
create index icash_make_lead_due on public.icash_make_lead_inbox(next_attempt_at,created_at) where not is_test and state in ('pending','fetching');
alter table public.icash_make_lead_inbox enable row level security;
revoke all on public.icash_make_lead_inbox from public,anon,authenticated;
grant all on public.icash_make_lead_inbox to service_role;

create function public.icash_make_receive_lead(p_payload jsonb,p_test boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare old public.icash_make_lead_inbox;src public.icash_meta_lead_sources;digest text;reason text;state text;outreach text;duplicate boolean;
begin
 if p_test is null or jsonb_typeof(p_payload) is distinct from 'object'
 or coalesce(p_payload->>'id','') !~ '^[0-9]{5,40}$'
 or coalesce(p_payload->>'page_id','') !~ '^[0-9]{5,40}$'
 or coalesce(p_payload->>'form_id','') !~ '^[0-9]{5,40}$'
 or jsonb_typeof(p_payload->'field_data') is distinct from 'array'
 or jsonb_typeof(p_payload->'custom_disclaimer_responses') is distinct from 'array'
 or octet_length(p_payload::text)>16384 then raise exception 'Valid Make receipt required';end if;
 digest:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended('make-lead:'||(p_payload->>'id'),0));
 select * into old from public.icash_make_lead_inbox where meta_id=p_payload->>'id' for update;
 duplicate:=found;
 if duplicate and (old.payload is distinct from p_payload or old.is_test is distinct from p_test) then
  return jsonb_build_object('status','conflict','duplicate',false,'outreach','none');
 end if;
 select * into src from public.icash_meta_lead_sources
 where page_id=p_payload->>'page_id' and form_id=p_payload->>'form_id' and enabled and reviewed_until>now();
 if p_test then state:='test';reason:='META_TEST_LEAD';outreach:='test_excluded';
 elsif src.id is null then state:='pending';reason:='META_SOURCE_REQUIRED';outreach:='form_setup_required';
 elsif src.contact_basis='checkbox' and ((select count(*) from jsonb_array_elements(p_payload->'custom_disclaimer_responses') e where e->>'checkbox_key'=src.consent_key)<>1
 or not exists(select 1 from jsonb_array_elements(p_payload->'custom_disclaimer_responses') e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb)
 ) then state:='review';reason:='META_CONTACT_CONSENT_REQUIRED';outreach:='contact_evidence_required';
 else state:='pending';reason:=null;outreach:='eligible_for_validation';end if;
 if not duplicate then
  insert into public.icash_make_lead_inbox(meta_id,page_id,form_id,payload,payload_hash,is_test,state,reason)
  values(p_payload->>'id',p_payload->>'page_id',p_payload->>'form_id',p_payload,digest,p_test,state,reason);
 elsif old.state='accepted' then outreach:='already_processed';
 elsif old.state='review' then outreach:='review_required';end if;
 return jsonb_build_object('status',case when p_test then 'test_received' when duplicate then old.state else state end,'duplicate',duplicate,'outreach',outreach);
end $$;

create function public.icash_make_claim_lead(p_meta text default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare row public.icash_make_lead_inbox;src uuid;token uuid:=gen_random_uuid();
begin
 select i.* into row from public.icash_make_lead_inbox i
 join public.icash_meta_lead_sources s on s.page_id=i.page_id and s.form_id=i.form_id and s.enabled and s.reviewed_until>now()
 where not i.is_test and (i.state='pending' or i.state='fetching' and i.claimed_at<now()-interval '2 minutes')
 and i.next_attempt_at<=now() and i.attempts<8 and (p_meta is null or i.meta_id=p_meta)
 order by i.next_attempt_at,i.created_at limit 1 for update of i skip locked;
 if not found then return null;end if;
 select id into src from public.icash_meta_lead_sources where page_id=row.page_id and form_id=row.form_id and enabled and reviewed_until>now();
 if src is null then return null;end if;
 update public.icash_make_lead_inbox set state='fetching',attempts=attempts+1,claim_token=token,claimed_at=now(),next_attempt_at=now()+interval '2 minutes' where meta_id=row.meta_id;
 return jsonb_build_object('metaId',row.meta_id,'sourceId',src,'token',token,'payload',row.payload,'isTest',row.is_test);
end $$;
revoke all on function public.icash_make_receive_lead(jsonb,boolean),public.icash_make_claim_lead(text) from public,anon,authenticated;
grant execute on function public.icash_make_receive_lead(jsonb,boolean),public.icash_make_claim_lead(text) to service_role;

-- A submission-based receipt must match the original authenticated connector
-- payload, exact phone, name, source and time. It is not a checkbox/call-now event.
create function public.icash_meta_contact_receipt_current(p_source uuid,p_payload jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare src public.icash_meta_lead_sources;raw jsonb;phone text;receipt jsonb;
begin
 select * into src from public.icash_meta_lead_sources where id=p_source and enabled and reviewed_until>now();
 if not found or jsonb_typeof(p_payload->'consentResponses') is distinct from 'array' then return false;end if;
 if src.contact_basis='checkbox' then
  return (select count(*) from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.consent_key)=1
   and exists(select 1 from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb);
 end if;
 select payload into raw from public.icash_make_lead_inbox where meta_id=p_payload->>'metaId'
  and page_id=src.page_id and form_id=src.form_id and not is_test and state in ('pending','fetching','accepted');
 if not found or p_payload->>'pageId' is distinct from src.page_id or p_payload->>'formId' is distinct from src.form_id
 or p_payload->>'submittedAt' is distinct from raw->>'created_time' then return false;end if;
 if (select count(*) from jsonb_array_elements(raw->'field_data') f where f->>'name'='full_name')<>1
 or (select count(*) from jsonb_array_elements(raw->'field_data') f where f->>'name'='phone_number')<>1
 or not exists(select 1 from jsonb_array_elements(raw->'field_data') f where f->>'name'='full_name' and f->'values'=jsonb_build_array(p_payload->>'name')) then return false;end if;
 select regexp_replace(f->'values'->>0,'[[:space:]().-]','','g') into phone
 from jsonb_array_elements(raw->'field_data') f where f->>'name'='phone_number' and jsonb_array_length(f->'values')=1;
 phone:=case when phone ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then '+1'||phone when phone ~ '^1[2-9][0-9]{2}[2-9][0-9]{6}$' then '+'||phone else phone end;
 if phone is null or phone is distinct from p_payload->>'phone' then return false;end if;
 receipt:=jsonb_build_array(jsonb_build_object('kind','form_submission','provider','meta','metaId',p_payload->>'metaId','pageId',src.page_id,'formId',src.form_id,'submittedAt',raw->>'created_time'));
 return p_payload->'consentResponses'=receipt;
end $$;
revoke all on function public.icash_meta_contact_receipt_current(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_meta_contact_receipt_current(uuid,jsonb) to service_role;

do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_meta_accept_lead(uuid,jsonb,text)'::regprocedure);
 needle:=$needle$not exists(select 1 from jsonb_array_elements(p_payload->'consentResponses') e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb)$needle$;
 if position(needle in def)=0 then raise exception 'Meta acceptance prerequisite changed';end if;
 execute replace(def,needle,'not public.icash_meta_contact_receipt_current(src.id,p_payload)');
 def:=pg_get_functiondef('public.icash_meta_pool_receipt_current(uuid)'::regprocedure);
 needle:=$needle$and (select count(*) from jsonb_array_elements(m.consent_receipt) e where e->>'checkbox_key'=src.consent_key)=1
 and exists(select 1 from jsonb_array_elements(m.consent_receipt) e where e->>'checkbox_key'=src.consent_key and e->'is_checked'='true'::jsonb)$needle$;
 if position(needle in def)=0 then raise exception 'Meta pool evidence prerequisite changed';end if;
 execute replace(def,needle,$replacement$and public.icash_meta_contact_receipt_current(src.id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))$replacement$);
 def:=pg_get_functiondef('public.icash_meta_direct_contact_evidence(uuid,uuid,uuid,text)'::regprocedure);
 needle:=$needle$or l.consent_version is distinct from m.consent_version or l.consent_text is distinct from m.consent_text$needle$;
 if position(needle in def)=0 then raise exception 'Meta direct evidence prerequisite changed';end if;
 execute replace(def,needle,needle||$replacement$
  or not public.icash_meta_contact_receipt_current(m.source_id,jsonb_build_object('metaId',m.meta_id,'pageId',m.page_id,'formId',m.form_id,'submittedAt',m.consent_receipt->0->>'submittedAt','name',l.name,'phone',l.phone,'consentResponses',m.consent_receipt))$replacement$);
end $patch$;
commit;
