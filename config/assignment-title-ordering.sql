begin;
-- STAGED: apply after ordered_contract_signing and current signing patches.
-- Preserve existing function definitions/guards; fail closed on unknown source.
-- No data, permission, review, template, rate or signing grant is inserted.
do $patch$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_lock_sent_terms()'::regprocedure);
 needle:='old.stage<>''under_contract''';
 replacement:='old.stage not in (''under_contract'',''title_open'',''closing'')';
 if position(replacement in definition)=0 then
  if position(needle in definition)=0 then raise exception 'Unexpected sent-terms guard; review before patching';end if;
  execute replace(definition,needle,replacement);
 end if;

 definition:=pg_get_functiondef('public.icash_prepare_deal(uuid,uuid,jsonb)'::regprocedure);
 needle:='icash_deal_files.stage=''under_contract'' and icash_deal_files.terms-array';
 replacement:='icash_deal_files.stage in (''under_contract'',''title_open'',''closing'') and icash_deal_files.terms-array';
 if position(replacement in definition)=0 then
  if position(needle in definition)=0 then raise exception 'Unexpected deal preparation guard; review before patching';end if;
  execute replace(definition,needle,replacement);
 end if;

 definition:=pg_get_functiondef('public.icash_begin_signing(uuid,uuid,uuid,text,uuid,text,jsonb)'::regprocedure);
 needle:='d.stage not in (''under_contract'',''buyer_selected'')';
 replacement:='d.stage not in (''under_contract'',''buyer_selected'',''title_open'',''closing'')';
 if position(replacement in definition)=0 then
  if position(needle in definition)=0 then raise exception 'Unexpected assignment signing guard; review before patching';end if;
  execute replace(definition,needle,replacement);
 end if;

 definition:=pg_get_functiondef('public.icash_save_signing_status(uuid,text,jsonb)'::regprocedure);
 needle:='set stage=''buyer_selected'',assignment_signed_at=now(),updated_at=now() where id=e.deal_id and account_id=e.account_id and stage=''under_contract'' and terms=e.terms;';
 replacement:='set stage=case when stage=''under_contract'' then ''buyer_selected'' else stage end,assignment_signed_at=now(),updated_at=now() where id=e.deal_id and account_id=e.account_id and stage in (''under_contract'',''buyer_selected'',''title_open'',''closing'') and terms=e.terms;';
 if position(replacement in definition)=0 then
  if position(needle in definition)=0 then raise exception 'Unexpected assignment completion guard; review before patching';end if;
  execute replace(definition,needle,replacement);
 end if;
end $patch$;
commit;
