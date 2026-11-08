-- Additional pacing for the new leases; existing total and recipient limits stay.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

create function icash_sender_private.november_room(p_sender text,p_cold boolean,p_at timestamptz)
returns boolean language sql stable security invoker set search_path='' as $$
 select case when p_sender in ('+16462959838','+18623812530','+17866727869','+16462494809') and p_cold then
  p_at is not null and extract(hour from p_at at time zone 'America/New_York')>=9
  and extract(hour from p_at at time zone 'America/New_York')<21
  and (select count(*)<100 and count(*) filter(where admitted_at>p_at-interval '1 hour')<10
    and count(*) filter(where admitted_at>p_at-interval '5 minutes')=0
   from icash_sender_private.uses where sender=p_sender and cold and admitted_at>p_at-interval '24 hours')
 else true end
$$;
revoke all on function icash_sender_private.november_room(text,boolean,timestamptz) from public,anon,authenticated;
grant execute on function icash_sender_private.november_room(text,boolean,timestamptz) to service_role;

-- take() holds the physical-number row lock before calling room(). Every
-- channel therefore observes the same spacing and rolling counts atomically.
do $pacing$
declare definition text;needle text:='if total>=1000 then return false;end if;';
begin
 definition:=pg_get_functiondef('icash_sender_private.room(text,boolean,uuid,text)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Sender volume boundary changed';end if;
 execute replace(definition,needle,
  'if not icash_sender_private.november_room(p_sender,p_cold,at_time) then return false;end if;'||chr(10)||needle);
end $pacing$;
commit;
