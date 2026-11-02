begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Routing is not price evidence. Let the shared transcript validator examine
-- ordinary numeric/written amounts too; it still distinguishes repairs, debt,
-- dates, qualified asks and actual acceptance of a delivered supported quote.
do $patch$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_seller_text_offer_context(uuid,uuid)'::regprocedure);
 old:=$r$(\$[0-9]|[0-9][0-9,]* ?k\M|how much|what.*offer|what.*pay|asking price|send.*(contract|agreement))$r$;
 replacement:=$r$([0-9]|\m(hundred|thousand|million|dollars?)\M|how much|what.*offer|what.*pay|asking price|send.*(contract|agreement))$r$;
 if position(old in definition)=0 then raise exception 'Seller offer source routing changed';end if;
 execute replace(definition,old,replacement);
end $patch$;
commit;
