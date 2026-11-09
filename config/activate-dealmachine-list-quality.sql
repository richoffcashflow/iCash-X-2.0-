-- Operator plan, never an automatic migration or deployment hook.
-- Supply icash.reviewed_release_sha after verifying exact-main CI, web and worker.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
do $activate$
declare release text:=current_setting('icash.reviewed_release_sha',true);
begin
 if coalesce(release,'') !~ '^[a-f0-9]{40}$' then raise exception 'Verified production release SHA required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then raise exception 'Operating budget missing';end if;
 -- Bind pre-rollout outreach to its first real attempted number. Do not reset
 -- recipients when their provider list changes, a sender is disabled or STOPs.
 insert into icash_research_private.owner_sms_choices(person_id,phone,account_id,screening_id,source_hash)
 select distinct on (person->>'personId') person->>'personId',t.recipient,oc.account_id,oc.screening_id,
  encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
 from public.icash_owner_contacts oc
 join public.icash_deal_files d on d.account_id=oc.account_id and d.screening_id=oc.screening_id
 join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party='seller'
 join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id and m.direction='outgoing'
 left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
 cross join lateral jsonb_array_elements(oc.result->'contacts') person
 where (m.state in ('dispatching','accepted','delivered') or o.state in ('dispatched','settled'))
  and person->'likelyOwner'='true'::jsonb and oc.result->'requestedPersonIds' ? (person->>'personId')
  and person->>'personId' ~ '^per_[a-zA-Z0-9]{1,100}$' and t.recipient ~ '^\+1[0-9]{10}$'
  and exists(select 1 from jsonb_array_elements(person->'phones') ph where public.icash_operational_phone(ph->>'number')=t.recipient)
 order by person->>'personId',coalesce(o.dispatched_at,m.created_at),m.id,oc.screening_id
 on conflict do nothing;
 update icash_research_private.list_quality_settings set enabled=true,activated_at=coalesce(activated_at,now()),release_sha=release where id=1;
end $activate$;
commit;
