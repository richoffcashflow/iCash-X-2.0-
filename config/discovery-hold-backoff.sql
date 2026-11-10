-- Bounded waiting for known discovery holds; no provider receipts or money are changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare source text:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
begin
 if md5(source)='1d56b57c8804415e5bf161ea887a18ef' then return;end if;
 if md5(source)<>'1107b9e656c00a17111d195b64c58386' then raise exception 'Unexpected icash_next_acquisition predecessor';end if;
 source:=replace(source,$before$ delete from icash_work_private.acquisition_export_waits where account_id=c.account_id;
 update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;
 insert into public.icash_automation_tickets(account_id,kind) values(c.account_id,'discovery') returning * into t;$before$,$after$ -- A known inventory hold is not a new acquisition opportunity. Do not invoke
 -- the provider-facing discovery route repeatedly while its evidence is unchanged.
 -- Existing eligible contacts were selected above; retain their five-second cadence.
 -- Bound history by the indexed kind/created_at window and ignore future evidence.
 if exists(select 1 from public.icash_automation_tickets held
  where held.account_id=c.account_id and held.kind='discovery'
   and held.state='held' and held.outcome='inventory_held'
   and held.created_at between now()-interval '5 minutes' and now()
   and held.completed_at>now()-interval '60 seconds' and held.completed_at<=now()) then
  update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;
  continue;
 end if;
 delete from icash_work_private.acquisition_export_waits where account_id=c.account_id;
 update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;
 insert into public.icash_automation_tickets(account_id,kind) values(c.account_id,'discovery') returning * into t;$after$);
 if md5(source)<>'1d56b57c8804415e5bf161ea887a18ef' then raise exception 'Unexpected icash_next_acquisition replacement';end if;
 execute source;
end $patch$;
do $patch$
declare source text:=pg_get_functiondef('public.icash_claim_discovery_estimate(uuid,jsonb,jsonb,jsonb,jsonb)'::regprocedure);
begin
 if md5(source)='da303ff6d69e242a92d7b84e0a4bdf54' then return;end if;
 if md5(source)<>'760292449e06f417895203534592aacd' then raise exception 'Unexpected icash_claim_discovery_estimate predecessor';end if;
 source:=replace(source,$before$lease_until=now()+interval '1 minute',retry_at=null$before$,$after$lease_until=now()+interval '90 seconds',retry_at=null$after$);
 if md5(source)<>'da303ff6d69e242a92d7b84e0a4bdf54' then raise exception 'Unexpected icash_claim_discovery_estimate replacement';end if;
 execute source;
end $patch$;
commit;
