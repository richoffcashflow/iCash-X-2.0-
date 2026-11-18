-- Give sender priority only to automatic operational seller messages that can
-- still use their contact permission. A renewed permission can use the same wait.
set local lock_timeout='3s';
set local statement_timeout='10s';
set local search_path='';

do $migration$
declare
  target record;
  source text;
  anchor text;
  replacement text;
  current_permission text := $predicate$(w.claim_kind<>'automatic' or t.party is distinct from 'seller'
    or t.operational_contact_id is null or coalesce(t.eligibility_until>now(),false)
    or coalesce(icash_sender_private.transactional(m,t),false))$predicate$;
begin
  for target in
    select p.*,expected.digest,expected.is_turn
    from (values
      ('icash_sender_private.waiting_turn(text)'::regprocedure,'65c91d315ba5b232d86cfe748368a849',true),
      ('public.icash_next_sender_volume_retry()'::regprocedure,'019ca6f6bf5d3461f1d940ffc481a3ef',false)
    ) expected(id,digest,is_turn)
    join pg_catalog.pg_proc p on p.oid=expected.id
  loop
    source:=pg_catalog.pg_get_functiondef(target.oid);
    if pg_catalog.md5(source)<>target.digest or target.prosecdef
      or target.proowner<>'postgres'::regrole or target.provolatile<>'v'
      or target.proconfig is distinct from array['search_path=""']
      or target.proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' then
      raise exception 'Seller sender wait prerequisite changed';
    end if;
    if target.is_turn then
      anchor:='   and w.binding=icash_sender_private.message_binding(m,t.recipient)';
      replacement:=anchor||chr(10)||'   and '||current_permission;
    else
      anchor:=$anchor$   or (w.claim_kind<>'manual' and (t.paused or t.ai_mode<>'auto'))$anchor$;
      replacement:=anchor||chr(10)||'   or not '||current_permission;
    end if;
    if (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 then
      raise exception 'Seller sender wait boundary changed';
    end if;
    execute replace(source,anchor,replacement);
  end loop;
end $migration$;
