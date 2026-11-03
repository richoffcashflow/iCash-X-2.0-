-- Prevent the contact UNION from joining every held ticket by account before
-- applying the exact job target. Keep every target match and every original gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old_join text:=$old$   join public.icash_voice_contact_targets target on target.id=coalesce(v.permission_id,v.operational_contact_id)
    and target.account_id=v.account_id and target.party='seller' and target.revoked_at is null and target.permission_until>checked
    and ((v.permission_id is not null and v.operational_contact_id is null and target.eligibility_source='operator_record')
     or (v.permission_id is null and v.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))$old$;
 new_join text:=$new$   cross join lateral (
    select target.* from public.icash_voice_contact_targets target
    where target.id=coalesce(v.permission_id,v.operational_contact_id)
     and target.account_id=v.account_id and target.party='seller' and target.revoked_at is null and target.permission_until>checked
     and ((v.permission_id is not null and v.operational_contact_id is null and target.eligibility_source='operator_record')
      or (v.permission_id is null and v.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
    offset 0
   ) target$new$;
begin
 d:=pg_get_functiondef('public.icash_recover_voice_configuration(text,text,text,text,timestamptz)'::regprocedure);
 if md5(d)<>'c4787929d87e8562fb556bfb7e34e8f0' then
  raise exception 'Voice configuration recovery prerequisite changed';
 end if;
 if (length(d)-length(replace(d,old_join,'')))/length(old_join)<>1 then
  raise exception 'Voice configuration recovery target join changed';
 end if;
 execute replace(d,old_join,new_join);
end $patch$;
commit;
