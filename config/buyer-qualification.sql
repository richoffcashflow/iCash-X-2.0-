begin;
-- STAGED. Apply after reviewed-action-authority.sql and buyer-voice.sql.
-- No operator, contact consent, verified funds, provider credential or profile is seeded.
create table public.icash_buyer_qualification_requests (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 buyer_id uuid not null references public.icash_buyer_profiles(id),deal_id uuid not null references public.icash_deal_files(id),
 entity_key text not null,submitted_by uuid not null references auth.users(id),idempotency_key uuid not null,
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=14000),payload_hash text not null,
 state text not null default 'submitted' check(state in ('submitted','needs_information','approved','declined','revoked')),
 created_at timestamptz not null default now(),expires_at timestamptz not null,
 reviewed_by uuid references auth.users(id),reviewed_at timestamptz,decision_note text,verification jsonb,
 unique(account_id,idempotency_key)
);
create index icash_buyer_qualification_account on public.icash_buyer_qualification_requests(account_id,deal_id,created_at desc,id desc);
create table public.icash_buyer_qualification_audit (
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.icash_buyer_qualification_requests(id),
 actor_user_id uuid references auth.users(id),event text not null,note text not null,evidence jsonb not null default '{}',created_at timestamptz not null default now()
);
alter table public.icash_buyer_profiles add column qualification_request_id uuid references public.icash_buyer_qualification_requests(id),add column qualification_expires_at timestamptz;
alter table public.icash_buyer_matches add column qualification_request_id uuid references public.icash_buyer_qualification_requests(id);
alter table public.icash_buyer_qualification_requests enable row level security;
alter table public.icash_buyer_qualification_audit enable row level security;
revoke all on public.icash_buyer_qualification_requests,public.icash_buyer_qualification_audit from public,anon,authenticated;
grant select,insert,update on public.icash_buyer_qualification_requests to service_role;
grant select,insert on public.icash_buyer_qualification_audit to service_role;
create function public.icash_buyer_qualification_immutable() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if row(new.id,new.account_id,new.buyer_id,new.deal_id,new.entity_key,new.submitted_by,new.idempotency_key,new.payload,new.payload_hash,new.created_at)
 is distinct from row(old.id,old.account_id,old.buyer_id,old.deal_id,old.entity_key,old.submitted_by,old.idempotency_key,old.payload,old.payload_hash,old.created_at)
 then raise exception 'Buyer submission is immutable';end if;return new;
end $$;
create trigger icash_buyer_qualification_immutable before update on public.icash_buyer_qualification_requests for each row execute function public.icash_buyer_qualification_immutable();
create trigger icash_buyer_qualification_audit_immutable before update or delete on public.icash_buyer_qualification_audit for each row execute function public.icash_authority_no_mutation();

create function public.icash_submit_buyer_qualification(p_account uuid,p_user uuid,p_key uuid,p_payload jsonb)
returns public.icash_buyer_qualification_requests language plpgsql security invoker set search_path='' as $$
declare r public.icash_buyer_qualification_requests;b public.icash_buyer_profiles;d public.icash_deal_files;h text;observed timestamptz;expiry timestamptz;k text;
begin
 if p_user is null or p_key is null or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>14000 then raise exception 'Invalid buyer review';end if;
 -- Clients cannot smuggle verification, rate, history or permission flags into intake.
 if exists(select 1 from jsonb_object_keys(p_payload) x where x not in ('buyerId','dealId','markets','propertyTypes','maxPriceCents','maxRepairCents','criteriaObservedAt','expiresAt','sourceName','sourceReference','buyerStatement')) then raise exception 'Unsupported buyer claim';end if;
 h:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 perform pg_advisory_xact_lock(hashtextextended(p_account::text||p_key::text,583));
 select * into r from public.icash_buyer_qualification_requests where account_id=p_account and idempotency_key=p_key;
 if found then if r.payload_hash<>h then raise exception 'Idempotency payload conflict';end if;return r;end if;
 select * into b from public.icash_buyer_profiles where id=(p_payload->>'buyerId')::uuid and account_id=p_account for share;
 select * into d from public.icash_deal_files where id=(p_payload->>'dealId')::uuid and account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing') for share;
 if b.id is null or d.id is null or not exists(select 1 from public.icash_buyer_candidates where buyer_id=b.id and deal_id=d.id and rights_until>now()) then raise exception 'Owned current buyer candidate and deal required';end if;
 if not public.icash_authority_text(p_payload,'sourceName',3) or not public.icash_authority_text(p_payload,'sourceReference') or jsonb_typeof(p_payload->'buyerStatement') is distinct from 'string' or length(trim(p_payload->>'buyerStatement')) not between 12 and 4000 then raise exception 'Attributed buyer source required';end if;
 observed:=(p_payload->>'criteriaObservedAt')::timestamptz;expiry:=(p_payload->>'expiresAt')::timestamptz;
 if observed is null or observed not between now()-interval '30 days' and now() or expiry is null or expiry<=now() or expiry>least(now()+interval '30 days',observed+interval '30 days') then raise exception 'Fresh criteria and bounded expiry required';end if;
 if jsonb_typeof(p_payload->'markets') is distinct from 'array' or jsonb_array_length(p_payload->'markets') not between 1 and 10 or jsonb_typeof(p_payload->'propertyTypes') is distinct from 'array' or jsonb_array_length(p_payload->'propertyTypes') not between 1 and 2 then raise exception 'Bounded markets and property types required';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'markets') x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 2 and 100)
 or exists(select 1 from jsonb_array_elements(p_payload->'propertyTypes') x where jsonb_typeof(x)<>'string' or x#>>'{}' not in ('house','land'))
 or (select count(distinct lower(trim(x#>>'{}'))) from jsonb_array_elements(p_payload->'markets') x)<>jsonb_array_length(p_payload->'markets')
 or (select count(distinct x) from jsonb_array_elements(p_payload->'propertyTypes') x)<>jsonb_array_length(p_payload->'propertyTypes') then raise exception 'Invalid or duplicate buyer criteria';end if;
 foreach k in array array['maxPriceCents','maxRepairCents'] loop
  if jsonb_typeof(p_payload->k) is distinct from 'number' or (p_payload->>k)::numeric<>trunc((p_payload->>k)::numeric) or (p_payload->>k)::numeric not between 0 and 100000000000 then raise exception 'Exact bounded buyer amounts required';end if;
 end loop;
 if (p_payload->>'maxPriceCents')::bigint<=0 then raise exception 'Positive buyer price required';end if;
 insert into public.icash_buyer_qualification_requests(account_id,buyer_id,deal_id,entity_key,submitted_by,idempotency_key,payload,payload_hash,expires_at)
 values(p_account,b.id,d.id,b.entity_key,p_user,p_key,p_payload,h,expiry) returning * into r;
 insert into public.icash_buyer_qualification_audit(request_id,actor_user_id,event,note) values(r.id,p_user,'submitted','Buyer statements only; no funds, authority or permission verified');
 return r;
end $$;

create function public.icash_revoke_buyer_qualification(p_request uuid,p_actor uuid,p_note text) returns void language plpgsql security invoker set search_path='' as $$
declare r public.icash_buyer_qualification_requests;
begin
 select * into strict r from public.icash_buyer_qualification_requests where id=p_request;
 perform pg_advisory_xact_lock(hashtextextended(r.account_id::text||r.buyer_id::text,584));
 select * into strict r from public.icash_buyer_qualification_requests where id=p_request for update;
 if r.state='revoked' then return;end if;
 update public.icash_buyer_qualification_requests set state='revoked',decision_note=p_note where id=r.id;
 update public.icash_buyer_profiles set qualification_expires_at=least(qualification_expires_at,now()),criteria='{}',updated_at=now() where id=r.buyer_id and account_id=r.account_id and qualification_request_id=r.id;
 delete from public.icash_buyer_matches where buyer_id=r.buyer_id and deal_id=r.deal_id and qualification_request_id=r.id;
 insert into public.icash_buyer_qualification_audit(request_id,actor_user_id,event,note) values(r.id,p_actor,'revoked',p_note);
end $$;

create function public.icash_decide_buyer_qualification(p_reviewer uuid,p_request uuid,p_decision text,p_note text,p_verification jsonb default '{}')
returns public.icash_buyer_qualification_requests language plpgsql security invoker set search_path='' as $$
declare r public.icash_buyer_qualification_requests;b public.icash_buyer_profiles;d public.icash_deal_files;p jsonb;v jsonb:=p_verification;expiry timestamptz;funds_at timestamptz;authority_at timestamptz;rate public.icash_operation_rates;prior uuid;
begin
 if not exists(select 1 from public.icash_trusted_operators where user_id=p_reviewer and scopes @> array['authority_review']::text[] and revoked_at is null and expires_at>now()) then raise exception 'Trusted authority reviewer required';end if;
 if p_decision is null or p_decision not in ('approved','needs_information','declined','revoked') or p_note is null or length(trim(p_note)) not between 12 and 1000 then raise exception 'Explicit reviewed decision required';end if;
 -- One stable account/buyer lock serializes competing approvals, withdrawal and supersession.
 select * into strict r from public.icash_buyer_qualification_requests where id=p_request;
 perform pg_advisory_xact_lock(hashtextextended(r.account_id::text||r.buyer_id::text,584));
 select * into strict r from public.icash_buyer_qualification_requests where id=p_request for update;
 if jsonb_typeof(v) is distinct from 'object' or exists(select 1 from jsonb_object_keys(v) x where x not in ('criteriaConfirmed','fundsVerified','signatoryVerified','reviewReference','validUntil','fundsReference','fundsObservedAt','fundsAmountCents','currency','signatoryName','authorityReference','authorityObservedAt')) then raise exception 'Unsupported verification data';end if;
 if p_decision='revoked' then perform public.icash_revoke_buyer_qualification(r.id,p_reviewer,p_note);select * into r from public.icash_buyer_qualification_requests where id=r.id;return r;end if;
 if r.state=p_decision then
  if r.decision_note is distinct from p_note or (p_decision='approved' and r.verification-array['rateId','sourceEntityKey'] is distinct from v) then raise exception 'Conflicting review retry';end if;return r;
 end if;
 if r.state<>'submitted' or r.expires_at<=now() then raise exception 'Current submitted review required';end if;
 if not exists(select 1 from public.icash_accounts where id=r.account_id and owner_user_id=r.submitted_by) then raise exception 'Owner changed; new review required';end if;
 if p_decision<>'approved' then
  update public.icash_buyer_qualification_requests set state=p_decision,reviewed_by=p_reviewer,reviewed_at=now(),decision_note=p_note where id=r.id returning * into r;
  insert into public.icash_buyer_qualification_audit(request_id,actor_user_id,event,note) values(r.id,p_reviewer,p_decision,p_note);return r;
 end if;
 select * into b from public.icash_buyer_profiles where id=r.buyer_id and account_id=r.account_id and entity_key=r.entity_key for update;
 select * into d from public.icash_deal_files where id=r.deal_id and account_id=r.account_id and stage in ('under_contract','buyer_selected','title_open','closing') for share;
 if b.id is null or d.id is null or not exists(select 1 from public.icash_buyer_candidates where buyer_id=b.id and deal_id=d.id and rights_until>now()) then raise exception 'Current buyer/deal binding required';end if;
 p:=r.payload;
 if (p->>'criteriaObservedAt')::timestamptz not between now()-interval '30 days' and now() then raise exception 'Buyer criteria expired';end if;
 if jsonb_typeof(v) is distinct from 'object' or v->'criteriaConfirmed' is distinct from 'true'::jsonb or v->'fundsVerified' is distinct from 'true'::jsonb or v->'signatoryVerified' is distinct from 'true'::jsonb
 or not public.icash_authority_text(v,'reviewReference') or not public.icash_authority_text(v,'fundsReference') or not public.icash_authority_text(v,'authorityReference') or not public.icash_authority_text(v,'signatoryName',2) or v->>'currency' is distinct from 'USD' then raise exception 'Actual human review of criteria, funds and signing authority required';end if;
 if jsonb_typeof(v->'fundsAmountCents') is distinct from 'number' or (v->>'fundsAmountCents')::numeric<>trunc((v->>'fundsAmountCents')::numeric) or (v->>'fundsAmountCents')::numeric not between (p->>'maxPriceCents')::numeric and 100000000000 then raise exception 'Verified funds must cover the claimed maximum purchase amount';end if;
 funds_at:=(v->>'fundsObservedAt')::timestamptz;authority_at:=(v->>'authorityObservedAt')::timestamptz;
 if funds_at is null or authority_at is null or funds_at not between now()-interval '30 days' and now() or authority_at not between now()-interval '30 days' and now() or v->>'validUntil' is null then raise exception 'Dated funds and authority evidence required';end if;
 expiry:=least(r.expires_at,(v->>'validUntil')::timestamptz,funds_at+interval '30 days',authority_at+interval '30 days',(p->>'criteriaObservedAt')::timestamptz+interval '30 days');
 if expiry<=now() then raise exception 'Review expiry must be current';end if;
 select * into rate from public.icash_operation_rates where operation='buyer_call' and enabled and verified_at<=now() and expires_at>now() and charge_cents>0 order by verified_at desc,id limit 1 for share;
 if not found then raise exception 'Current server buyer contact quote required';end if;
 expiry:=least(expiry,rate.expires_at);
 prior:=b.qualification_request_id;
 if prior is not null then perform public.icash_revoke_buyer_qualification(prior,p_reviewer,'Superseded by a new explicit buyer review');end if;
 -- Claims become reviewed only here. Qualification itself NEVER grants outreach.
 -- Unknown deal history stays null; the planner uses an explicitly neutral prior.
 update public.icash_buyer_profiles set criteria=jsonb_build_object('markets',p->'markets','propertyTypes',p->'propertyTypes','maxPriceCents',(p->>'maxPriceCents')::bigint,'maxRepairCents',(p->>'maxRepairCents')::bigint,'criteriaConfirmedAt',floor(extract(epoch from (p->>'criteriaObservedAt')::timestamptz)*1000),'permitted',false,'proofOfFundsVerifiedAt',floor(extract(epoch from funds_at)*1000),'authorityVerified',true,'completedDeals',null,'failedDeals',null,'estimatedContactChargeCents',rate.charge_cents),qualification_request_id=r.id,qualification_expires_at=expiry,updated_at=now() where id=b.id and account_id=r.account_id;
 update public.icash_buyer_qualification_requests set state='approved',expires_at=expiry,reviewed_by=p_reviewer,reviewed_at=now(),decision_note=p_note,verification=v||jsonb_build_object('rateId',rate.id,'sourceEntityKey',b.entity_key) where id=r.id returning * into r;
 insert into public.icash_buyer_qualification_audit(request_id,actor_user_id,event,note,evidence) values(r.id,p_reviewer,'approved',p_note,r.verification);
 -- Preparation is safe to re-evaluate; this is not a voice/email dispatch ticket.
 update public.icash_fulfillment_jobs set state='ready',updated_at=now() where account_id=r.account_id and deal_id=r.deal_id and state='complete';
 return r;
end $$;

create function public.icash_withdraw_buyer_qualification(p_account uuid,p_user uuid,p_request uuid) returns void language plpgsql security invoker set search_path='' as $$
declare r public.icash_buyer_qualification_requests;
begin
 select * into strict r from public.icash_buyer_qualification_requests where id=p_request and account_id=p_account;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Owned buyer review required';end if;
 perform pg_advisory_xact_lock(hashtextextended(r.account_id::text||r.buyer_id::text,584));
 perform public.icash_revoke_buyer_qualification(r.id,p_user,'Withdrawn by the account owner');
end $$;

-- Recipient/channel-specific authority is evaluated freshly, never copied from intake.
create function public.icash_buyer_contact_current(p_account uuid,p_buyer uuid,p_screening uuid,p_phone text default null) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_contact_permissions p join public.icash_authority_review_requests r on r.id=p.review_request_id and r.account_id=p.account_id
 where p.account_id=p_account and p.buyer_id=p_buyer and p.screening_id=p_screening and p.party='buyer' and (p_phone is null or p.phone=p_phone)
 and p.contact_key=encode(sha256(convert_to(p.phone,'UTF8')),'hex') and p.revoked_at is null and p.permission_until>now() and p.dnc_clear and p.dnc_checked_at between now()-interval '30 days' and now()
 and r.state='approved' and r.kind='contact_permission' and r.expires_at>now()
 and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=p.contact_key)
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=p.phone));
$$;
create function public.icash_buyer_qualification_current(p_account uuid,p_buyer uuid,p_deal uuid,p_request uuid default null) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_buyer_profiles b
 join public.icash_buyer_qualification_requests r on r.id=b.qualification_request_id and r.buyer_id=b.id and r.account_id=b.account_id and r.entity_key=b.entity_key
 join public.icash_deal_files d on d.id=r.deal_id and d.account_id=b.account_id
 join public.icash_operation_rates rate on rate.id=(r.verification->>'rateId')::uuid
 where b.id=p_buyer and b.account_id=p_account and d.id=p_deal and (p_request is null or r.id=p_request)
 and d.stage in ('under_contract','buyer_selected','title_open','closing') and b.qualification_expires_at>now() and r.state='approved' and r.expires_at>now()
 and rate.enabled and rate.operation='buyer_call' and rate.verified_at<=now() and rate.expires_at>now() and rate.charge_cents=(b.criteria->>'estimatedContactChargeCents')::bigint
 and exists(select 1 from public.icash_buyer_candidates c where c.buyer_id=b.id and c.deal_id=d.id and c.rights_until>now())
 and b.criteria=jsonb_build_object('markets',r.payload->'markets','propertyTypes',r.payload->'propertyTypes','maxPriceCents',(r.payload->>'maxPriceCents')::bigint,'maxRepairCents',(r.payload->>'maxRepairCents')::bigint,'criteriaConfirmedAt',floor(extract(epoch from (r.payload->>'criteriaObservedAt')::timestamptz)*1000),'permitted',false,'proofOfFundsVerifiedAt',floor(extract(epoch from (r.verification->>'fundsObservedAt')::timestamptz)*1000),'authorityVerified',true,'completedDeals',null,'failedDeals',null,'estimatedContactChargeCents',rate.charge_cents));
$$;
create function public.icash_reviewed_buyers(p_account uuid,p_deal uuid)
returns table(id uuid,entity_key text,criteria jsonb,source_ref text,qualification_request_id uuid) language sql stable security invoker set search_path='' as $$
 select b.id,b.entity_key,b.criteria||jsonb_build_object('permitted',public.icash_buyer_contact_current(p_account,b.id,d.screening_id)),b.source_ref,b.qualification_request_id
 from public.icash_buyer_profiles b join public.icash_buyer_qualification_requests r on r.id=b.qualification_request_id and r.account_id=b.account_id and r.buyer_id=b.id and r.entity_key=b.entity_key
 join public.icash_deal_files d on d.id=r.deal_id and d.account_id=b.account_id
 where b.account_id=p_account and d.id=p_deal and public.icash_buyer_qualification_current(p_account,b.id,d.id,b.qualification_request_id)
 order by b.updated_at desc,b.id limit 500;
$$;
create function public.icash_buyer_qualification_options(p_account uuid,p_deal uuid) returns setof jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('buyerId',b.id,'name',b.display_name,'entityKey',b.entity_key,'qualificationState',case when r.state='approved' and b.qualification_expires_at<=now() then 'expired' else coalesce(r.state,'unreviewed') end,'expiresAt',b.qualification_expires_at)
 from public.icash_buyer_candidates c join public.icash_buyer_profiles b on b.id=c.buyer_id and b.account_id=p_account
 join public.icash_deal_files d on d.id=c.deal_id and d.account_id=p_account
 left join public.icash_buyer_qualification_requests r on r.id=b.qualification_request_id and r.deal_id=d.id
 where c.deal_id=p_deal and c.rights_until>now() order by c.discovered_at desc,b.id limit 100;
$$;
-- Preserve the existing buyer context's contract, property, phone, marketing,
-- current permission and criteria gates. Replace only its stale boolean mirror.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_buyer_voice_context(uuid)'::regprocedure);
 needle:='and b.criteria->>''permitted''=''true''';
 replacement:='and m.qualification_request_id=b.qualification_request_id and public.icash_buyer_qualification_current(p.account_id,b.id,d.id,m.qualification_request_id) and public.icash_buyer_contact_current(p.account_id,b.id,p.screening_id,p.phone)';
 if position(needle in definition)=0 then raise exception 'Unexpected buyer voice context; review before patching';end if;
 definition:=replace(definition,needle,replacement);
 needle:='''packageId'',doc.id';
 if position(needle in definition)=0 then raise exception 'Unexpected buyer context fields';end if;
 execute replace(definition,needle,needle||',''qualificationRequestId'',b.qualification_request_id');
end $patch$;
-- Serialize revocation/supersession with both persisted matches and final dispatch.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_save_fulfillment(uuid,jsonb,jsonb,jsonb)'::regprocedure);
 needle:='select * into strict j from public.icash_fulfillment_jobs where id=p_job for update;';
 replacement:=$replacement$select * into strict j from public.icash_fulfillment_jobs where id=p_job;
 if jsonb_typeof(p_matches) is distinct from 'array' or jsonb_array_length(p_matches)>50 then raise exception 'Invalid buyer matches';end if;
 for item in select value from jsonb_array_elements(p_matches) order by value->>'id' loop
  perform pg_advisory_xact_lock(hashtextextended(j.account_id::text||(item->>'id')::uuid::text,584));
 end loop;
 select * into strict j from public.icash_fulfillment_jobs where id=p_job for update;$replacement$;
 if position(needle in definition)=0 then raise exception 'Unexpected fulfillment lock';end if;definition:=replace(definition,needle,replacement);
 needle:=$needle$if not exists(select 1 from public.icash_buyer_profiles where id=(item->>'id')::uuid and account_id=j.account_id) then raise exception 'Buyer tenant mismatch';end if;$needle$;
 replacement:=$replacement$if item->>'qualificationRequestId' is null or not public.icash_buyer_qualification_current(j.account_id,(item->>'id')::uuid,d.id,(item->>'qualificationRequestId')::uuid) then raise exception 'Current buyer qualification required';end if;$replacement$;
 if position(needle in definition)=0 then raise exception 'Unexpected match verification';end if;definition:=replace(definition,needle,replacement);
 needle:='icash_buyer_matches(deal_id,buyer_id,score,ready,rank,source_ref)';
 if position(needle in definition)=0 then raise exception 'Unexpected match insert';end if;definition:=replace(definition,needle,'icash_buyer_matches(deal_id,buyer_id,score,ready,rank,source_ref,qualification_request_id)');
 needle:=$needle$item->>'sourceRef') on conflict(deal_id,buyer_id)$needle$;
 if position(needle in definition)=0 then raise exception 'Unexpected match values';end if;definition:=replace(definition,needle,$replacement$item->>'sourceRef',(item->>'qualificationRequestId')::uuid) on conflict(deal_id,buyer_id)$replacement$);
 needle:='source_ref=excluded.source_ref,created_at=now();';
 if position(needle in definition)=0 then raise exception 'Unexpected match conflict';end if;definition:=replace(definition,needle,'source_ref=excluded.source_ref,qualification_request_id=excluded.qualification_request_id,created_at=now();');
 execute definition;
 definition:=pg_get_functiondef('public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb)'::regprocedure);
 needle:='if p.party=''buyer'' then';
 replacement:=$replacement$if p.party='buyer' then
  if p.buyer_id is null then return false;end if;
  perform pg_advisory_xact_lock(hashtextextended(j.account_id::text||p.buyer_id::text,584));$replacement$;
 if position(needle in definition)=0 then raise exception 'Unexpected reviewed voice claim';end if;execute replace(definition,needle,replacement);
end $patch$;
revoke all on function public.icash_buyer_qualification_immutable(),public.icash_submit_buyer_qualification(uuid,uuid,uuid,jsonb),public.icash_revoke_buyer_qualification(uuid,uuid,text),public.icash_decide_buyer_qualification(uuid,uuid,text,text,jsonb),public.icash_withdraw_buyer_qualification(uuid,uuid,uuid),public.icash_buyer_contact_current(uuid,uuid,uuid,text),public.icash_buyer_qualification_current(uuid,uuid,uuid,uuid),public.icash_reviewed_buyers(uuid,uuid),public.icash_buyer_qualification_options(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_buyer_qualification_immutable(),public.icash_submit_buyer_qualification(uuid,uuid,uuid,jsonb),public.icash_revoke_buyer_qualification(uuid,uuid,text),public.icash_decide_buyer_qualification(uuid,uuid,text,text,jsonb),public.icash_withdraw_buyer_qualification(uuid,uuid,uuid),public.icash_buyer_contact_current(uuid,uuid,uuid,text),public.icash_buyer_qualification_current(uuid,uuid,uuid,uuid),public.icash_reviewed_buyers(uuid,uuid),public.icash_buyer_qualification_options(uuid,uuid) to service_role;
commit;
