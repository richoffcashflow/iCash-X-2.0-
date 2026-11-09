-- Additive list quality rollout. Activate only after exact release verification.
begin;
-- Data quality is separate from consent, DNC, source validity and spending.
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

-- Bounded edits to reviewed production functions; no original receipt rewrites.
set local lock_timeout='3s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_targeting_filters(jsonb)'::regprocedure);
 needle:=$n$ when 'mobile' then return '[]';$n$;
 if strpos(d,needle)=0 then raise exception 'Targeting filter boundary changed';end if;
 execute replace(d,needle,$n$ when 'out_of_state_old_sale' then return jsonb_build_array(
  jsonb_build_object('filter_id','has_absentee_owners','value',true),jsonb_build_object('filter_id','has_out_of_state_owners','value',true),
  jsonb_build_object('filter_id','last_sale_date','operator','is_before','value',to_char(cutoff-interval '10 years','YYYY-MM-DD')));
 when 'off_market_repairs' then return '[{"filter_id":"market_status","operator":"contains_any","value":[6]},{"filter_id":"estimated_repair_cost","operator":"greater_than_or_equal","value":25000}]';
$n$||needle);
 d:=pg_get_functiondef('public.icash_targeting_definition_valid(jsonb)'::regprocedure);
 needle:=$n$'vacant_absentee','mobile'$n$;
 if strpos(d,needle)=0 then raise exception 'Targeting definition boundary changed';end if;
 execute replace(d,needle,$n$'vacant_absentee','out_of_state_old_sale','off_market_repairs','mobile'$n$);

 d:=pg_get_functiondef('public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'4cdc81fd590f2871038f06d9ed062255' then raise exception 'Owner export admission prerequisite changed';end if;
 needle:=$n$ if p_request is distinct from expected then return 'held';end if;$n$;
 if strpos(d,needle)=0 then raise exception 'Owner export request boundary changed';end if;
 execute replace(d,needle,$n$
 -- Output-only usage fields do not change the owner audience or credit cap.
 -- Original requests stay valid for their original outstanding preflights.
 if p_request->'fields'='["person_full_name","has_active_phone_number","phone_1_usage_2_months_id","phone_1_usage_12_months_id","phone_2_usage_2_months_id","phone_2_usage_12_months_id","phone_3_usage_2_months_id","phone_3_usage_12_months_id"]'::jsonb then
  expected:=jsonb_set(expected,'{fields}',p_request->'fields');
 end if;
$n$||needle);
 d:=pg_get_functiondef('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'ba208152879c73def06c765ccc91680c' then raise exception 'Owner export saver prerequisite changed';end if;
 needle:=$n$'activityBasis','provider_export_filter'));$n$;
 if strpos(d,needle)=0 then raise exception 'Owner export phone boundary changed';end if;
 execute replace(d,needle,$n$'activityBasis','provider_export_filter')
  ||case when row_data ? ('phone_'||i||'_usage_2_months_id') then jsonb_build_object('usage2Months',row_data->>('phone_'||i||'_usage_2_months_id')) else '{}'::jsonb end
  ||case when row_data ? ('phone_'||i||'_usage_12_months_id') then jsonb_build_object('usage12Months',row_data->>('phone_'||i||'_usage_12_months_id')) else '{}'::jsonb end);$n$);

 d:=pg_get_functiondef('public.icash_operational_contact_current(uuid,uuid,text,boolean)'::regprocedure);
 if md5(d)<>'87b3d2c38e35b766ef901b34ae6aa388' then raise exception 'Operational contact prerequisite changed';end if;
 needle:=' h:=extract(hour from stamp at time zone c.timezone);';
 if strpos(d,needle)=0 then raise exception 'Operational quality boundary changed';end if;
 execute replace(d,needle,$n$ if p_channel='sms' and not public.icash_owner_sms_quality_current(p_account,c.screening_id,c.phone) then return false;end if;
$n$||needle);
end $patch$;

set local lock_timeout='3s';
set local statement_timeout='30s';
create function public.icash_screening_wrong_number(p_account uuid,p_screening uuid,p_after timestamptz) returns boolean
language sql stable set search_path='' as $$
 select p_after is not null and (
  exists(select 1 from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
   join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
   where d.account_id=p_account and d.screening_id=p_screening and t.party='seller'
    and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
    and m.created_at between p_after and now() and public.icash_seller_wrong_number(m.body))
  or exists(select 1 from public.icash_live_conversations c
   cross join lateral jsonb_array_elements(case when jsonb_typeof(c.result->'transcript')='array' then c.result->'transcript' else '[]'::jsonb end) t
   where c.account_id=p_account and c.screening_id=p_screening and c.party='seller' and c.state='complete' and c.conversation_id is not null
    and c.completed_at between p_after and now() and t->>'role'='user' and public.icash_seller_wrong_number(t->>'message')))
$$;
revoke all on function public.icash_screening_wrong_number(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_screening_wrong_number(uuid,uuid,timestamptz) to service_role;
do $patch$
declare d text;needle text;name text;
begin
 foreach name in array array['icash_discovery_filter_feedback','icash_targeting_feedback'] loop
  d:=pg_get_functiondef(('public.'||name||'(uuid,text)')::regprocedure);
  needle:='first_attempt.at is not null attempted,';
  if strpos(d,needle)=0 then raise exception 'Feedback attempt boundary changed: %',name;end if;
  d:=replace(d,needle,'public.icash_screening_wrong_number(a.account_id,a.screening_id,first_attempt.at) wrong_number,'||needle);
  needle:=$n$'interested',f.interested,'optedOut',f.opted_out,$n$;
  if strpos(d,needle)=0 then raise exception 'Feedback output boundary changed: %',name;end if;
  d:=replace(d,needle,needle||$n$'wrongNumbers',f.wrong_numbers,$n$);
  d:=replace(d,'attempted and not mature and not interested and not opted_out','attempted and not mature and (not interested or wrong_number) and not opted_out');
  needle:='count(*) filter(where attempted and interested) interested,';
  if strpos(d,needle)=0 then raise exception 'Feedback count boundary changed: %',name;end if;
  execute replace(d,needle,'count(*) filter(where attempted and wrong_number) wrong_numbers,count(*) filter(where attempted and interested and not wrong_number) interested,');
 end loop;
 d:=pg_get_functiondef('public.icash_targeting_learning_evidence(uuid,text,uuid)'::regprocedure);
 needle:='first_attempt.at attempted_at,';
 if strpos(d,needle)=0 then raise exception 'Learning attempt boundary changed';end if;
 d:=replace(d,needle,needle||'public.icash_screening_wrong_number(a.account_id,a.screening_id,first_attempt.at) wrong_number,');
 needle:=$n$'interested',f.interested,'optedOut',f.opted_out,$n$;
 if strpos(d,needle)=0 then raise exception 'Learning output boundary changed';end if;
 d:=replace(d,needle,needle||$n$'wrongNumbers',f.wrong_numbers,$n$);
 needle:=$n$count(*) filter(where attempted_at is not null and opted_out) opted_out,$n$;
 if strpos(d,needle)=0 then raise exception 'Learning count boundary changed';end if;
 d:=replace(d,needle,needle||'count(*) filter(where attempted_at is not null and wrong_number) wrong_numbers,');
 needle:=$n$and not opted_out) interested,$n$;
 if strpos(d,needle)=0 then raise exception 'Learning interest boundary changed';end if;
 execute replace(d,needle,'and not opted_out and not wrong_number) interested,');
end $patch$;
alter function public.icash_targeting_report(uuid) rename to icash_targeting_report_before_list_quality;
create function public.icash_targeting_report(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare report jsonb;
begin
 report:=public.icash_targeting_report_before_list_quality(p_actor);
 return report||jsonb_build_object('listQuality',(select jsonb_build_object('enabled',enabled,'activatedAt',activated_at)
  from icash_research_private.list_quality_settings where id=1));
end $$;
revoke all on function public.icash_targeting_report_before_list_quality(uuid),public.icash_targeting_report(uuid) from public,anon,authenticated;
grant execute on function public.icash_targeting_report(uuid) to service_role;
commit;
