begin;
create table icash_recorded_reception_private.direct_branch_attempts(source_config_id uuid primary key references icash_recorded_reception_private.configs(id),claimed_at timestamptz not null default now());
alter table icash_recorded_reception_private.direct_branch_attempts enable row level security;
revoke all on icash_recorded_reception_private.direct_branch_attempts from public,anon,authenticated,service_role;
create trigger direct_branch_attempt_immutable before update or delete on icash_recorded_reception_private.direct_branch_attempts for each row execute function icash_recorded_reception_private.immutable();
create trigger direct_branch_attempt_no_truncate before truncate on icash_recorded_reception_private.direct_branch_attempts for each statement execute function icash_recorded_reception_private.immutable();
create function public.icash_claim_direct_reception_branch(p_source uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from icash_recorded_reception_private.configs where id=p_source and enabled and entry_policy='spoken_v1' and call_profile='normal' and called_number='+17816093521' and reviewed_until>now()+interval '15 minutes') then return false;end if;
 insert into icash_recorded_reception_private.direct_branch_attempts(source_config_id) values(p_source) on conflict do nothing;
 return found;
end $$;
revoke all on function public.icash_claim_direct_reception_branch(uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_direct_reception_branch(uuid) to service_role;
-- This deployment hook can only stage a disabled clone of the currently reviewed
-- reception configuration. It cannot enable a call, raise limits or alter routing.
create function public.icash_stage_direct_reception(p_source uuid,p_branch text,p_version text,p_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;n icash_recorded_reception_private.configs;prior icash_recorded_reception_private.configs;
begin
 perform pg_advisory_xact_lock(hashtext('direct-recorded-reception-v1'));
 select * into c from icash_recorded_reception_private.configs where id=p_source and call_profile='normal' for share;
 if not found or not c.enabled or c.entry_policy<>'spoken_v1' or c.reviewed_until<=now()+interval '15 minutes'
  or c.called_number<>'+17816093521' or p_branch=c.branch_id or coalesce(p_branch,'') !~ '^agtbrch_[A-Za-z0-9]+$'
  or coalesce(p_version,'') !~ '^agtvrsn_[A-Za-z0-9]+$' or coalesce(p_hash,'') !~ '^[a-f0-9]{64}$' then return null;end if;
 select * into prior from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number and entry_policy='direct_recorded_v1' order by version desc limit 1;
 if found then
  if row(prior.branch_id,prior.version_id,prior.config_hash) is distinct from row(p_branch,p_version,p_hash) then raise exception 'Direct script candidate changed';end if;
  return icash_recorded_reception_private.config_json(prior);
 end if;
 n:=c;n.id:=gen_random_uuid();n.version:=(select max(version)+1 from icash_recorded_reception_private.configs where account_id=c.account_id and called_number=c.called_number);
 n.enabled:=false;n.entry_policy:='direct_recorded_v1';n.branch_id:=p_branch;n.version_id:=p_version;n.config_hash:=p_hash;
 n.created_at:=now();n.approved_at:=now();n.approval_reference:='Owner instruction confirmed 2026-10-07 10:44 PM America/Chicago: keep recording, skip spoken introduction and recording question on all business calls. Provider script read back by deployment.';
 insert into icash_recorded_reception_private.configs select n.*;
 return icash_recorded_reception_private.config_json(n);
end $$;
revoke all on function public.icash_stage_direct_reception(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_stage_direct_reception(uuid,text,text,text) to service_role;
commit;
