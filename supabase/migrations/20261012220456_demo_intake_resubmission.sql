begin;
set local lock_timeout='3s';

-- Deduplicate a demo only within its presenting account. An explicitly archived
-- run can be tested anew; in-flight and active runs remain idempotent.
create or replace function public.icash_demo_intake_current(p_lead uuid,p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_seller_intakes l
  where l.id=p_lead and l.contact_consent_scope='icash_x_demo'
   and l.attribution->>'demoAccountId'=p_account::text
   and (
    not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id)
    or exists(select 1 from public.icash_seller_matches m
     join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
     where m.lead_id=l.id and m.account_id=p_account and s.state<>'archived')
   )
 );
$$;
revoke all on function public.icash_demo_intake_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_demo_intake_current(uuid,uuid) to service_role;

-- Cover both the submitted address/phone key and canonical provider property ID.
do $patch$
declare d text;needle text:=$old$and contact_consent_scope='icash_x_demo' and icash_seller_intakes.attribution->>'demoAccountId'=p_account::text$old$;
 replacement text:=$new$and public.icash_demo_intake_current(icash_seller_intakes.id,p_account)$new$;
begin
 d:=pg_get_functiondef('public.icash_submit_bot_demo_intake(uuid,uuid,uuid,text,text,text,text,boolean,text,text,text)'::regprocedure);
 if strpos(d,replacement)>0 then null;
 elsif strpos(d,needle)>0 then execute replace(d,needle,replacement);
 else raise exception 'Expected demo submission deduplication prerequisite missing';end if;
end $patch$;

do $patch$
declare d text;needle text:=$old$select id into duplicate_property from public.icash_seller_intakes where id<>l.id and property->>'id'=p_output->'property'->>'id' and state<>'duplicate' and checked_at is not null and created_at>now()-interval '90 days' order by created_at limit 1;$old$;
 replacement text:=$new$select candidate.id into duplicate_property from public.icash_seller_intakes candidate
  where candidate.id<>l.id and candidate.property->>'id'=p_output->'property'->>'id'
   and candidate.state<>'duplicate' and candidate.checked_at is not null and candidate.created_at>now()-interval '90 days'
   and case when l.contact_consent_scope='icash_x_demo'
    then public.icash_demo_intake_current(candidate.id,(l.attribution->>'demoAccountId')::uuid)
    else candidate.contact_consent_scope is distinct from 'icash_x_demo' end
  order by candidate.created_at,candidate.id limit 1;$new$;
begin
 d:=pg_get_functiondef('public.icash_finish_seller_lookup(uuid,uuid,jsonb)'::regprocedure);
 if strpos(d,replacement)>0 then null;
 elsif strpos(d,needle)>0 then execute replace(d,needle,replacement);
 else raise exception 'Expected property lookup deduplication prerequisite missing';end if;
end $patch$;

commit;
