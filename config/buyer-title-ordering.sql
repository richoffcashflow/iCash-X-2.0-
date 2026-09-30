begin;
-- Apply after buyer-qualification, reviewed-action-authority, buyer-discovery,
-- buyer-voice and requested-buyer-package-email. No data or authority is seeded.
-- Only equivalent active-stage allowlists change; unknown function bodies fail closed.
do $patch$
declare target text;definition text;needle text;replacement text;occurrences integer;
begin
 for target,needle,replacement in values
  ('public.icash_claim_buyer_search(uuid,uuid,uuid,text)',
   'd.stage not in (''under_contract'',''buyer_selected'')',
   'd.stage not in (''under_contract'',''buyer_selected'',''title_open'',''closing'')'),
  ('public.icash_buyer_voice_context(uuid)',
   'd.stage in (''under_contract'',''buyer_selected'')',
   'd.stage in (''under_contract'',''buyer_selected'',''title_open'',''closing'')'),
  ('public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)',
   'stage in (''under_contract'',''buyer_selected'') and seller_signed_at is not null',
   'stage in (''under_contract'',''buyer_selected'',''title_open'',''closing'') and seller_signed_at is not null'),
  ('public.icash_claim_deal_email(uuid,uuid)',
   'd.stage not in (''under_contract'',''buyer_selected'')',
   'd.stage not in (''under_contract'',''buyer_selected'',''title_open'',''closing'')')
 loop
  definition:=pg_get_functiondef(target::regprocedure);
  occurrences:=(length(definition)-length(replace(definition,needle,'')))/length(needle);
  if occurrences=0 and position(replacement in definition)>0 then continue;end if;
  if occurrences<>1 then raise exception 'Unexpected buyer stage guard in %; review before patching',target;end if;
  execute replace(definition,needle,replacement);
 end loop;
end $patch$;
commit;
