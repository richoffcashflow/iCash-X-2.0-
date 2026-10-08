begin;
-- The first zero-traffic v8 candidate did not pass listing-policy simulation.
-- Replace only that unused candidate's fingerprint; reviewed v7 stays intact.
do $fix$
declare body text;name text;old_hash text:='a8c62cf741cc0124067ba62e104f854fd29f37027ac699a38ec34f222e27a175';new_hash text:='a33e3b4c1cdd1588cb16a6c1f53f804bc3b683dbee7152b23902020237cceff7';
begin
 if exists(select 1 from icash_recorded_reception_private.configs where context_policy='automatic_offer_v8') then raise exception 'Unused candidate required';end if;
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into body from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if position(old_hash in body)=0 then raise exception 'Candidate constraint required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check (%s)',name,replace(body,old_hash,new_hash));
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_reception_context_before_payoff(uuid,text)','icash_stage_offer_continuity_rollout(uuid,text,text,text,text,jsonb)'] loop
  body:=pg_get_functiondef(('public.'||name)::regprocedure);
  if position(old_hash in body)>0 then execute replace(body,old_hash,new_hash);end if;
 end loop;
end $fix$;
commit;
