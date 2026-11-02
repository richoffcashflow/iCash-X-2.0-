-- Keep every original evidence fence while making exact/prefix absence checks
-- indexable with generic PostgreSQL plans. No receipt or work row is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_cost_observation_event_prefix on public.icash_cost_observations(event_key collate "C");
create index icash_cost_observation_source_prefix on public.icash_cost_observations(source_ref collate "C");
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_owner_enrichment_unstarted(uuid,uuid,text)'::regprocedure);
 if md5(d)<>'e75d652640835436b45d55e145567fdf' then raise exception 'Unstarted-owner evidence prerequisite changed';end if;
 needle:=$old$ and not exists(select 1 from public.icash_cost_observations where event_key=p_operation or starts_with(event_key,p_operation||':')
  or source_ref='dealmachine:owners:'||p_operation or starts_with(source_ref,'dealmachine:owners:'||p_operation||':'))$old$;
 -- ':' and ';' are adjacent bytes in C collation. The half-open range covers
 -- exactly every colon suffix, including empty, Unicode and punctuation suffixes.
 replacement:=$new$ and not exists(select 1 from public.icash_cost_observations where event_key collate "C"=p_operation collate "C")
 and not exists(select 1 from public.icash_cost_observations where event_key collate "C">=(p_operation||':') collate "C" and event_key collate "C"<(p_operation||';') collate "C")
 and not exists(select 1 from public.icash_cost_observations where source_ref collate "C"=('dealmachine:owners:'||p_operation) collate "C")
 and not exists(select 1 from public.icash_cost_observations where source_ref collate "C">=('dealmachine:owners:'||p_operation||':') collate "C" and source_ref collate "C"<('dealmachine:owners:'||p_operation||';') collate "C")$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Unstarted-owner cost predicate changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
