-- Data quality is separate from consent, DNC, source validity and spending.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create table icash_research_private.list_quality_settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 activated_at timestamptz,release_sha text check(release_sha ~ '^[a-f0-9]{40}$')
);
insert into icash_research_private.list_quality_settings(id) values(1);
create table icash_research_private.owner_sms_choices(
 person_id text primary key check(person_id ~ '^per_[a-zA-Z0-9]{1,100}$'),
 phone text not null check(phone ~ '^\+1[0-9]{10}$'),
 account_id uuid not null,screening_id uuid not null,
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now()
);
alter table icash_research_private.list_quality_settings enable row level security;
alter table icash_research_private.owner_sms_choices enable row level security;
revoke all on icash_research_private.list_quality_settings,icash_research_private.owner_sms_choices from public,anon,authenticated,service_role;
create function icash_research_private.immutable_owner_sms_choice() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Original owner SMS choice is immutable';end $$;
create trigger immutable_owner_sms_choice before update or delete on icash_research_private.owner_sms_choices
 for each row execute function icash_research_private.immutable_owner_sms_choice();

-- Unknown usage stays unknown. This rank is not a match/ownership score.
create function public.icash_phone_usage_rank(p text) returns integer language sql immutable set search_path='' as $$
 select case replace(lower(btrim(p)),' ','_') when 'very_heavy' then 5 when 'heavy' then 4 when 'moderate' then 3
 when 'light' then 2 when 'minimal' then 1 when 'no_data_or_no_usage' then 0 else null end
$$;
create function public.icash_owner_sms_best_phone(p_person jsonb) returns text language sql immutable set search_path='' as $$
 select public.icash_operational_phone(ph->>'number')
 from jsonb_array_elements(case when jsonb_typeof(p_person->'phones')='array' then p_person->'phones' else '[]'::jsonb end) with ordinality x(ph,position)
 where lower(ph->>'type') in ('wireless','mobile') and ph->'doNotCall'='false'::jsonb
  and public.icash_operational_phone(ph->>'number') ~ '^\+1[0-9]{10}$'
 order by case when jsonb_typeof(ph->'matchConfidence')='number' and (ph->>'matchConfidence')::numeric between 0 and 100
   then case when (ph->>'matchConfidence')::numeric=0 then -2 else (ph->>'matchConfidence')::numeric end else -1 end desc,
  public.icash_phone_usage_rank(ph->>'usage2Months') desc nulls last,
  public.icash_phone_usage_rank(ph->>'usage12Months') desc nulls last,position
 limit 1
$$;

-- Called only after the original eligibility function has validated and locked
-- its exact account, owner receipt, DNC, source hash and suppression evidence.
-- The common budget lock serializes choices with dispatch/STOP across accounts.
create function public.icash_owner_sms_quality_current(p_account uuid,p_screening uuid,p_phone text) returns boolean
language plpgsql security definer set search_path='' as $$
declare source public.icash_owner_contacts;person jsonb;chosen text;existing text;known_phones text[];
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return false;end if;
 if not exists(select 1 from icash_research_private.list_quality_settings where id=1 and enabled) then return true;end if;
 select * into source from public.icash_owner_contacts where account_id=p_account and screening_id=p_screening for share;
 if not found then return false;end if;
 for person in select c from jsonb_array_elements(source.result->'contacts') c
  where c->'likelyOwner'='true'::jsonb and source.result->'requestedPersonIds' ? (c->>'personId')
   and exists(select 1 from jsonb_array_elements(c->'phones') ph where public.icash_operational_phone(ph->>'number')=p_phone
    and lower(ph->>'type') in ('wireless','mobile') and ph->'doNotCall'='false'::jsonb)
  order by c->>'personId'
 loop
  -- Existing human conversations retain their original number; all original
  -- STOP, pause, age, sender, billing and reply checks remain outside this gate.
  if exists(select 1 from public.icash_text_threads t join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
    where t.account_id=p_account and t.recipient=p_phone and t.party='seller' and m.direction='incoming' and m.state='received'
     and (m.provider_id is not null or m.event_id is not null)) then return true;end if;
  select phone into chosen from icash_research_private.owner_sms_choices where person_id=person->>'personId';
  if found then
   if chosen=p_phone then return true;end if;
   continue;
  end if;
  -- A pre-rollout attempt (including unknown dispatch) takes precedence over
  -- ranking. Suppression or a disabled sender never selects an alternate phone.
  select array_agg(public.icash_operational_phone(ph->>'number')) into known_phones from jsonb_array_elements(person->'phones') ph;
  select t.recipient into chosen from public.icash_text_threads t
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
   left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
   where t.party='seller' and t.recipient=any(known_phones) and m.direction='outgoing'
    and (m.state in ('dispatching','accepted','delivered') or o.state in ('dispatched','settled'))
   order by coalesce(o.dispatched_at,m.created_at),m.id limit 1;
  if not found then chosen:=public.icash_owner_sms_best_phone(person);end if;
  if chosen is null then continue;end if;
  insert into icash_research_private.owner_sms_choices(person_id,phone,account_id,screening_id,source_hash)
   values(person->>'personId',chosen,p_account,p_screening,encode(sha256(convert_to(source.result::text,'UTF8')),'hex')) on conflict do nothing;
  select phone into existing from icash_research_private.owner_sms_choices where person_id=person->>'personId';
  if existing=p_phone then return true;end if;
 end loop;
 return false;
end $$;

-- Direct recipient words only, using the existing quote/negation handling.
create function public.icash_seller_wrong_number(p_body text) returns boolean language sql immutable set search_path='' as $$
 select public.icash_seller_direct_response_match(regexp_replace(lower(replace(coalesce(p_body,''),'’',chr(39))),
  $pattern$\y(?:not|isn't|is not) (?:the |a )?wrong number\y$pattern$,'','g'),
  $pattern$\y(?:wrong number|(?:i am|i'm) not (?:the )?owner|(?:i |we )?(?:do not|don't|dont) own (?:that|this|the) (?:house|home|property))\y$pattern$)
$$;
revoke all on function public.icash_phone_usage_rank(text),public.icash_owner_sms_best_phone(jsonb),public.icash_owner_sms_quality_current(uuid,uuid,text),public.icash_seller_wrong_number(text) from public,anon,authenticated;
grant execute on function public.icash_phone_usage_rank(text),public.icash_owner_sms_best_phone(jsonb),public.icash_owner_sms_quality_current(uuid,uuid,text),public.icash_seller_wrong_number(text) to service_role;
commit;
