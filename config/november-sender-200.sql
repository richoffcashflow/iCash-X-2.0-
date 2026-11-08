-- Owner-requested 200/day for these four connected numbers, November 8, 2026.
-- Preserve existing uses, physical-number locks, recipient gates and receipts.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';

do $pacing$
declare pacing text; volume text;
begin
 pacing:=pg_get_functiondef('icash_sender_private.november_room(text,boolean,timestamptz)'::regprocedure);
 volume:=pg_get_functiondef('icash_sender_private.room(text,boolean,uuid,text)'::regprocedure);
 if md5(pacing)<>'8d2c7e3d75e8df11059c07ac736c03dc'
  or md5(volume)<>'b63ec1263c72487d9b81b088e299dabe' then
  raise exception 'November sender pacing predecessor changed';
 end if;
 execute replace(replace(replace(pacing,
  'count(*)<100','count(*)<200'),
  $old$interval '1 hour')<10$old$,$new$interval '1 hour')<20$new$),
  $old$interval '5 minutes'$old$,$new$interval '3 minutes'$new$);
 -- The shared baseline must agree with the exact-number ceiling above.
 -- Other numbers retain the 100 baseline and evidence-based 300 ceiling.
 execute replace(volume,'if not p_cold or cold_used<100 then return true;end if;',
  'if not p_cold or cold_used<(case when p_sender in (''+16462959838'',''+18623812530'',''+17866727869'',''+16462494809'') then 200 else 100 end) then return true;end if;');
end $pacing$;
commit;
