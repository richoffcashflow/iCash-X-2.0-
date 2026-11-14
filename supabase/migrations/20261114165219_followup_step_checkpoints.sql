-- Install inactive before the matching handler. No primary operation is retried.
begin;
set local lock_timeout='5s';set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.icash_account_followup_context(uuid,uuid)'::regprocedure))<>'5f044b75e88239265c1d5fb3381c1c9c' then
  raise exception 'Follow-up context prerequisite changed';end if;
end$$;
create table icash_work_private.followup_step_policy(id integer primary key check(id=1),enabled boolean not null default false,release_sha text,activated_at timestamptz);
insert into icash_work_private.followup_step_policy(id) values(1);
create table icash_work_private.followup_step_attempts(
 id uuid primary key default gen_random_uuid(),account_id uuid not null,
 source_version bigint not null,step text not null check(step in ('estimates','voice_receipts','customer_updates','attention')),
 ticket_id uuid not null references public.icash_automation_tickets(id),
 started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 completed boolean,evidence jsonb,
 unique(ticket_id,step),check((finished_at is null)=(completed is null)),
 check((finished_at is null)=(evidence is null)),check(evidence is null or (jsonb_typeof(evidence)='object' and octet_length(evidence::text)<=2048))
);
create index followup_step_completed on icash_work_private.followup_step_attempts(account_id,source_version,step) where completed;
alter table icash_work_private.followup_step_policy enable row level security;
alter table icash_work_private.followup_step_attempts enable row level security;
revoke all on icash_work_private.followup_step_policy,icash_work_private.followup_step_attempts from public,anon,authenticated,service_role;
grant select on icash_work_private.followup_step_policy to service_role;
create function icash_work_private.keep_followup_step() returns trigger language plpgsql set search_path='' as $$begin
 if tg_op<>'UPDATE' or old.finished_at is not null or new.finished_at is null
  or to_jsonb(new)-array['finished_at','completed','evidence'] is distinct from to_jsonb(old)-array['finished_at','completed','evidence']
 then raise exception 'Original follow-up step evidence is immutable';end if;return new;
end$$;
create trigger keep_followup_step before update or delete on icash_work_private.followup_step_attempts for each row execute function icash_work_private.keep_followup_step();
create function icash_work_private.reject_followup_step_truncate() returns trigger language plpgsql set search_path='' as $$begin
 raise exception 'Original follow-up step evidence is immutable';end$$;
create trigger keep_followup_step_history before truncate on icash_work_private.followup_step_attempts for each statement execute function icash_work_private.reject_followup_step_truncate();
revoke all on function icash_work_private.reject_followup_step_truncate() from public,anon,authenticated,service_role;
revoke all on function icash_work_private.keep_followup_step() from public,anon,authenticated,service_role;
create function public.icash_claim_followup_step(p_account uuid,p_ticket uuid,p_step text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare q icash_work_private.account_followups;prior icash_work_private.followup_step_attempts;attempt uuid;
begin
 if p_step is null or p_step not in ('estimates','voice_receipts','customer_updates','attention')
  or not exists(select 1 from icash_work_private.followup_step_policy where id=1 and enabled) then return null;end if;
 select * into q from icash_work_private.account_followups where account_id=p_account and ticket_id=p_ticket
  and lease_until>clock_timestamp() for update;
 if not found or not exists(select 1 from public.icash_automation_tickets where id=p_ticket and account_id=p_account and kind='account_reconcile' and state='consumed')
  or (p_step in ('customer_updates','attention') and q.claimed_notify_version<=q.notified_version) then return null;end if;
 select * into prior from icash_work_private.followup_step_attempts
  where account_id=p_account and source_version=q.claimed_version and step=p_step and completed
  order by finished_at,id limit 1;
 if found then return jsonb_build_object('status','completed','evidence',prior.evidence);end if;
 insert into icash_work_private.followup_step_attempts(account_id,source_version,step,ticket_id)
  values(p_account,q.claimed_version,p_step,p_ticket) on conflict(ticket_id,step) do nothing returning id into attempt;
 if attempt is null then return '{"status":"busy"}';end if;
 return jsonb_build_object('status','claimed','id',attempt);
end$$;
create function public.icash_finish_followup_step(p_account uuid,p_ticket uuid,p_step text,p_attempt uuid,p_complete boolean,p_evidence jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare q icash_work_private.account_followups;
begin
 if p_complete is null or p_evidence is null or jsonb_typeof(p_evidence)<>'object' or octet_length(p_evidence::text)>2048 then return false;end if;
 select * into q from icash_work_private.account_followups where account_id=p_account and ticket_id=p_ticket
  and lease_until>clock_timestamp() for update;
 if not found or not exists(select 1 from public.icash_automation_tickets where id=p_ticket and account_id=p_account and kind='account_reconcile' and state='consumed') then return false;end if;
 update icash_work_private.followup_step_attempts set finished_at=clock_timestamp(),completed=p_complete,evidence=p_evidence
  where id=p_attempt and ticket_id=p_ticket and account_id=p_account and step=p_step and source_version=q.claimed_version and finished_at is null;
 if found then return true;end if;
 -- An acknowledgment may be retried only with the identical original evidence.
 return exists(select 1 from icash_work_private.followup_step_attempts where id=p_attempt and ticket_id=p_ticket and account_id=p_account
  and step=p_step and source_version=q.claimed_version and completed=p_complete and evidence=p_evidence);
end$$;
do $$declare source text;needle text:='select jsonb_build_object(''notify'',q.claimed_notify_version>q.notified_version)';begin
 source:=pg_get_functiondef('public.icash_account_followup_context(uuid,uuid)'::regprocedure);
 if (length(source)-length(replace(source,needle,'')))<>length(needle) then raise exception 'Follow-up context shape changed';end if;
 execute replace(source,needle,needle||' || case when exists(select 1 from icash_work_private.followup_step_policy where id=1 and enabled) then ''{"stepCheckpoints":true}''::jsonb else ''{}''::jsonb end');
end$$;
revoke all on function public.icash_claim_followup_step(uuid,uuid,text),public.icash_finish_followup_step(uuid,uuid,text,uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_followup_step(uuid,uuid,text),public.icash_finish_followup_step(uuid,uuid,text,uuid,boolean,jsonb) to service_role;
alter table icash_work_private.followup_step_policy add column context_hash text,add column claim_hash text,add column finish_hash text;
update icash_work_private.followup_step_policy set context_hash=md5(pg_get_functiondef('public.icash_account_followup_context(uuid,uuid)'::regprocedure)),
 claim_hash=md5(pg_get_functiondef('public.icash_claim_followup_step(uuid,uuid,text)'::regprocedure)),
 finish_hash=md5(pg_get_functiondef('public.icash_finish_followup_step(uuid,uuid,text,uuid,boolean,jsonb)'::regprocedure));
create function icash_work_private.activate_followup_steps(p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$declare p icash_work_private.followup_step_policy;begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 select * into p from icash_work_private.followup_step_policy where id=1 for update;
 if not found or p.context_hash<>md5(pg_get_functiondef('public.icash_account_followup_context(uuid,uuid)'::regprocedure))
  or p.claim_hash<>md5(pg_get_functiondef('public.icash_claim_followup_step(uuid,uuid,text)'::regprocedure))
  or p.finish_hash<>md5(pg_get_functiondef('public.icash_finish_followup_step(uuid,uuid,text,uuid,boolean,jsonb)'::regprocedure)) then return false;end if;
 if p.enabled then return p.release_sha=p_release;end if;
 if p.activated_at is not null then return false;end if;
 update icash_work_private.followup_step_policy set enabled=true,release_sha=p_release,activated_at=clock_timestamp() where id=1;return true;
end$$;
revoke all on function icash_work_private.activate_followup_steps(text) from public,anon,authenticated,service_role;
commit;
