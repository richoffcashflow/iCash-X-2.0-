-- An already attached exclusion list is a hard search prerequisite. Let an
-- eligible starter synchronize that exact list once from its own allowance.
-- Accountless maintenance and list creation/recovery remain ordinary work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table icash_research_private.request_reserve_exclusion_claims(
 token uuid primary key,account_id uuid not null references public.icash_accounts(id),
 list_id text not null,created_at timestamptz not null default clock_timestamp()
);
alter table icash_research_private.request_reserve_exclusion_claims enable row level security;
revoke all on icash_research_private.request_reserve_exclusion_claims from public,anon,authenticated,service_role;

create function icash_research_private.starter_exclusion_request_allowed(p_account uuid,p_operation text,p_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_research_private.request_reserve_exclusion_claims claim
  join icash_research_private.exclusions s on s.id=1 and s.token=claim.token and s.list_id=claim.list_id
  join public.icash_discovery_configs c on c.account_id=claim.account_id and c.research_list_id=claim.list_id
  where claim.account_id=p_account and p_operation='starter-exclusion:'||claim.token
   and claim.created_at<=p_at and s.lease_until>p_at and s.state='ready' and cardinality(s.batch)>0
   and c.enabled and c.auto_enabled and not c.exhausted and c.data_rights_until>p_at and c.research_version in (1,2)
   and exists(select 1 from icash_research_private.settings where id=1 and enabled and exclusions_enabled)
   and not exists(select 1 from icash_research_private.requests r where r.account_id=p_account
    and r.kind='exclusion_sync' and r.operation_key=p_operation and r.admitted));
$$;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure);
 if md5(d)<>'2acad0140b2f0491097e81f8686851cf' then raise exception 'Starter exclusion claim prerequisite changed';end if;
 d:=replace(d,'public.icash_claim_research_exclusions()','public.icash_claim_starter_research_exclusions(p_account uuid)');
 d:=replace(d,E'begin\n',E'begin\n if public.icash_dealmachine_capacity_available(1) then return public.icash_claim_research_exclusions();end if;\n if not public.icash_new_user_request_reserve_eligible(p_account) then return null;end if;\n');
 d:=replace(d,'not public.icash_dealmachine_capacity_available(1) then','not public.icash_dealmachine_capacity_available(1,p_account) then');
 needle:=' if s.list_id is null then action:=';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter exclusion list boundary changed';end if;
 d:=replace(d,needle,$insert$
 if s.list_id is null or s.state<>'ready' or not exists(select 1 from public.icash_discovery_configs c
  where c.account_id=p_account and c.research_list_id=s.list_id and c.research_version in (1,2)
   and c.enabled and c.auto_enabled and not c.exhausted and c.data_rights_until>clock_timestamp()) then return null;end if;
$insert$||needle);
 needle:=' return jsonb_build_object(''action'',action,''token'',t,''name'',s.name,''listId'',s.list_id,''ids'',ids);';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter exclusion result changed';end if;
 execute replace(d,needle,$replacement$
 insert into icash_research_private.request_reserve_exclusion_claims(token,account_id,list_id) values(t,p_account,s.list_id);
 return jsonb_build_object('action',action,'token',t,'name',s.name,'listId',s.list_id,'ids',ids,'accountId',p_account);
$replacement$);
 d:=pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure);
 needle:='and p_kind in (''search_estimate'',''property_search'',''owner_preview'',''owner_lookup'',''geography'',''property_lookup'')';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter exclusion limiter boundary changed';end if;
 execute replace(d,needle,'and (p_kind in (''search_estimate'',''property_search'',''owner_preview'',''owner_lookup'',''geography'',''property_lookup'')
    or (p_kind=''exclusion_sync'' and icash_research_private.starter_exclusion_request_allowed(p_account,p_operation,stamp)))');
end $patch$;
revoke all on function icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz),
 public.icash_claim_starter_research_exclusions(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_claim_starter_research_exclusions(uuid) to service_role;
commit;
