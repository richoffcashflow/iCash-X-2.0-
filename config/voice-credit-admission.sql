-- Prevent new paid outbound dials when existing provider metadata proves
-- voice credits are exhausted. Other work and original call receipts continue.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $guard$
declare item record;
begin
 for item in select * from (values
  ('icash_outgoing_voice_capacity_open()','9ab4d9b1162b224e849f2218412609c6'),
  ('icash_save_voice_capacity(integer,jsonb,text)','c9a6866e8a2ec6424eaf069522ef2871'),
  ('icash_voice_capacity_available(uuid,text,text,text,boolean)','8d87fea023a3e760869ed804fec7fd2d')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Voice credit admission prerequisite changed: %',item.signature;
  end if;
 end loop;
end $guard$;

alter table public.icash_voice_capacity_policy
 add column credit_state text not null default 'unknown' check(credit_state in ('unknown','available','exhausted')),
 add column credit_verified_at timestamptz;
-- The current release already records this exact bounded, service-only metadata.
-- Seed only a fresh, explicit exhausted balance with usage billing disabled.
with evidence as (
 select id,verified_at,regexp_match(source,'; units=([0-9]{1,16})/([0-9]{1,16});extra=0;overage=(true|false);daily=') observed
 from public.icash_voice_capacity_policy where verified_at between now()-interval '5 minutes' and now()
)
update public.icash_voice_capacity_policy p set credit_state='exhausted',credit_verified_at=e.verified_at
from evidence e where p.id=e.id and e.observed is not null and (e.observed[1])::numeric>=(e.observed[2])::numeric;

do $patch$
declare d text;needle text;replacement text;body text;
begin
 d:=pg_get_functiondef('public.icash_save_voice_capacity(integer,jsonb,text)'::regprocedure);
 d:=replace(d,'declare a jsonb;','declare a jsonb;credit_state text;');
 needle:=' perform 1 from public.icash_operating_budget where id=1 for update;';
 replacement:=needle||$new$
 -- Every target uses the same verified workspace subscription. Old deployments
 -- and incomplete/malformed observations must not clear a known exhaustion.
 credit_state:=case
  when not exists(select 1 from jsonb_array_elements(p_agents) x where x->>'creditState' is distinct from 'exhausted') then 'exhausted'
  when not exists(select 1 from jsonb_array_elements(p_agents) x where x->>'creditState' is distinct from 'available') then 'available'
  else 'unknown' end;
$new$;
 if position(needle in d)=0 then raise exception 'Capacity save lock changed';end if;
 d:=replace(d,needle,replacement);
 needle:='insert into public.icash_voice_capacity_policy values(1,p_limit,now(),p_source)';
 replacement:='insert into public.icash_voice_capacity_policy(id,workspace_limit,verified_at,source,credit_state,credit_verified_at) values(1,p_limit,now(),p_source,credit_state,case when credit_state<>''unknown'' then now() end)';
 if position(needle in d)=0 then raise exception 'Capacity policy insert changed';end if;
 d:=replace(d,needle,replacement);
 needle:='source=excluded.source;';
 replacement:=$new$source=excluded.source,
   credit_state=case when excluded.credit_state='unknown' then public.icash_voice_capacity_policy.credit_state else excluded.credit_state end,
   credit_verified_at=case when excluded.credit_state='unknown' then public.icash_voice_capacity_policy.credit_verified_at else excluded.credit_verified_at end;$new$;
 if position(needle in d)=0 then raise exception 'Capacity policy update changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('public.icash_voice_capacity_available(uuid,text,text,text,boolean)'::regprocedure);
 needle:=E'begin\n select least(10,workspace_limit)';
 replacement:=E'begin\n if p_incoming is not true and exists(select 1 from public.icash_voice_capacity_policy where id=1 and credit_state=''exhausted'') then return false;end if;\n select least(10,workspace_limit)';
 if position(needle in d)=0 then raise exception 'Final voice capacity entry changed';end if;
 execute replace(d,needle,replacement);

 d:=pg_get_functiondef('public.icash_outgoing_voice_capacity_open()'::regprocedure);
 body:=split_part(split_part(d,'AS $function$',2),'$function$',1);
 if body not like '%with slots as materialized%' or body not like '%icash_voice_capacity_targets%' then raise exception 'Voice capacity shortcut changed';end if;
 d:=replace(split_part(d,'AS $function$',1),'LANGUAGE sql','LANGUAGE plpgsql')||$new$AS $function$
begin
 if exists(select 1 from public.icash_voice_capacity_policy where id=1 and credit_state='exhausted') then return false;end if;
 return ($new$||regexp_replace(body,';[[:space:]]*$','')||$new$);
end $function$;$new$;
 execute d;
end $patch$;
commit;

