begin;
-- v9 has never been activated: remove the repeated closing questionnaire before rollout.
do $$declare d text;n text;begin
 if exists(select 1 from icash_recorded_reception_private.configs where context_policy='automatic_offer_v9') then raise exception 'Existing v9 configuration requires a new policy version';end if;
 foreach n in array array['configs_context_policy_check','configs_context_binding_check'] loop
  select regexp_replace(pg_get_constraintdef(oid),'^CHECK ','') into d from pg_constraint where conrelid='icash_recorded_reception_private.configs'::regclass and conname=n;
  if position('deaa20ccd8215e0bc11526899663bf048f47c1e67360be247fabaf3547c023c8' in d)=0 then raise exception 'Expected v9 binding missing';end if;
  execute format('alter table icash_recorded_reception_private.configs drop constraint %I',n);
  execute format('alter table icash_recorded_reception_private.configs add constraint %I check %s',n,replace(d,'deaa20ccd8215e0bc11526899663bf048f47c1e67360be247fabaf3547c023c8','24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf'));
 end loop;
 foreach n in array array['icash_reception_context_before_agreement(uuid,text)','icash_reception_context_before_payoff(uuid,text)','icash_seller_agreement_recording(text)','icash_seller_agreement_call_context(text,text)','icash_stage_live_agreement_rollout(uuid,text,text,text,text,jsonb)'] loop
  d:=pg_get_functiondef(('public.'||n)::regprocedure);
  if position('deaa20ccd8215e0bc11526899663bf048f47c1e67360be247fabaf3547c023c8' in d)>0 then execute replace(d,'deaa20ccd8215e0bc11526899663bf048f47c1e67360be247fabaf3547c023c8','24d43197289eb72d06d4d93fb4a1d3e0c0a6ef88f17b57664854e68674e2b3bf');end if;
 end loop;
end $$;
commit;
