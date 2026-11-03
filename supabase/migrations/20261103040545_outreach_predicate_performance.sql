-- Keep the original owner demonstration proof out of ordinary customer scans.
-- Preserve its identity, ACL, volatility, row locks and every evidence predicate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

do $patch$
declare d text;body text;
begin
 d:=pg_get_functiondef('public.icash_owner_demo_call_current(uuid,uuid)'::regprocedure);
 if md5(d)<>'72f9fa70105ee648427f7704fe8ab662' then
  raise exception 'Owner demonstration evidence prerequisite changed';
 end if;
 body:=split_part(split_part(d,'AS $function$',2),'$function$',1);
 if left(body,16)<>E'\n select exists(' or right(body,4)<>E' );\n' then
  raise exception 'Owner demonstration evidence body changed';
 end if;
 -- A SQL function plans its complete evidence query even for a different
 -- account. PL/pgSQL returns first and plans that query only for the owner.
 d:=replace(d,'LANGUAGE sql','LANGUAGE plpgsql');
 d:=replace(d,body,E'\nbegin\n if p_account is distinct from ''48dfb798-8c1a-404f-88c0-c396cc067062''::uuid or p_job is null then return false;end if;\n return exists('||substring(body from 17)||E'end;\n');
 execute d;

 d:=pg_get_functiondef('public.icash_outreach_window_open(text,text,timestamptz)'::regprocedure);
 if md5(d)<>'b329c0d1455b2895c79c92052d4b3b9b' then
  raise exception 'Outreach hours prerequisite changed';
 end if;
end $patch$;

-- Resolve the same validated timezone once, then extract the local hour once.
-- This is still a fresh caller-supplied clock, never a cached permission.
create or replace function public.icash_outreach_window_open(p_timezone text,p_basis text default null,p_clock timestamptz default now()) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
declare zone text;local_hour numeric;
begin
 if isfinite(p_clock) is distinct from true then return false;end if;
 zone:=public.icash_outreach_timezone(p_timezone,p_basis);
 if zone is null then return false;end if;
 local_hour:=extract(hour from p_clock at time zone zone);
 return local_hour>=9 and local_hour<21;
end $fn$;
commit;
