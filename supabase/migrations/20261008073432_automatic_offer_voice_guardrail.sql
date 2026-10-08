begin;
-- The provider rejects full-response-only validation for audio output. Keep
-- blocking execution and retry, with the supported voice configuration.
do $voice$
declare definition text;name text;
begin
 if exists(select 1 from icash_recorded_reception_private.configs where context_policy='automatic_offer_v5') then raise exception 'No automatic-offer branch may be active or staged before this revision';end if;
 foreach name in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into definition from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=name;
  if position('eed5471f6b56ff9314e6a1e5cd6a6a82e5dc22064785cc0c287c54d949754610' in definition)=0 then raise exception 'Expected automatic offer policy required';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',name);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check (%s)',name,replace(definition,'eed5471f6b56ff9314e6a1e5cd6a6a82e5dc22064785cc0c287c54d949754610','c6656551528f673077f158654bcce3b0b7bdd7b5a49e90150c90d91695c303e4'));
 end loop;
 foreach name in array array['icash_reception_context_before_agreement(uuid,text)','icash_stage_automatic_offer_rollout(uuid,text,text,text,text,jsonb)'] loop
  definition:=pg_get_functiondef(('public.'||name)::regprocedure);
  if position('eed5471f6b56ff9314e6a1e5cd6a6a82e5dc22064785cc0c287c54d949754610' in definition)=0 then raise exception 'Expected automatic offer function required';end if;
  execute replace(definition,'eed5471f6b56ff9314e6a1e5cd6a6a82e5dc22064785cc0c287c54d949754610','c6656551528f673077f158654bcce3b0b7bdd7b5a49e90150c90d91695c303e4');
 end loop;
end $voice$;
commit;
