-- Preserve a fresh original preview's explicitly empty owner audience.
-- No historical backfill, new contact authority, purchase, or settlement.
-- The migration runner owns the transaction and its migration-history write.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('icash_research_private.owner_preview_has_no_phones(jsonb)'::regprocedure);
 if md5(d)<>'a27f5ef6fffa0d27ba8aac07a0bb68e4' then raise exception 'Empty owner audience prerequisite changed';end if;
 needle:=$old$ if jsonb_typeof(p_row->'contacts') is distinct from 'array' then return null;end if;$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Empty owner audience predicate changed';end if;
 execute replace(d,needle,needle||$new$
 -- An empty array alone is insufficient: retain the observed explicit
 -- property-level zero-owner/zero-phone evidence, without treating unknown as zero.
 if jsonb_array_length(p_row->'contacts')=0
  and jsonb_typeof(p_row->'availability')='object'
  and p_row#>'{availability,owners}'='0'::jsonb
  and p_row#>'{availability,phones}'='0'::jsonb then return true;end if;$new$);
end $patch$;
