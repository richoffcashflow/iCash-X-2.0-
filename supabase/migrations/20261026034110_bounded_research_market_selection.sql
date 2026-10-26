-- Rank a bounded diverse set of eligible markets instead of scoring thousands
-- of ZIPs while the acquisition scheduler holds its shared financial lock.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare name text;d text;needle text;
begin
 foreach name in array array['icash_continue_stalled_research','icash_rotate_inventory_market'] loop
  d:=pg_get_functiondef(('public.'||name||'(uuid)')::regprocedure);
  needle:='select * into m from public.icash_inventory_markets where';
  if strpos(d,needle)=0 then raise exception 'Market selection changed: %',name;end if;
  d:=replace(d,needle,'select icash_inventory_markets.* into m from (select account_id,zip from public.icash_inventory_markets where');
  needle:='order by (select count(*) from public.icash_discovery_configs other';
  if strpos(d,needle)=0 then raise exception 'Market ranking changed: %',name;end if;
  d:=replace(d,needle,'order by priority,md5(zip||p_account::text) limit 64) candidates
   join public.icash_inventory_markets using(account_id,zip) '||needle);
  needle:='for update skip locked limit 1;';
  if strpos(d,needle)=0 then raise exception 'Market lease changed: %',name;end if;
  d:=replace(d,needle,'for update of icash_inventory_markets skip locked limit 1;');
  execute d;
 end loop;
end $patch$;
commit;
