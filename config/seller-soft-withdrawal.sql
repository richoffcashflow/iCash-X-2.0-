-- A direct withdrawal ends this conversation without inventing a global opt-out.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old text:=' decline_body:=case when b ~';
begin
 d:=pg_get_functiondef('public.icash_seller_response_disposition(text)'::regprocedure);
 if (length(d)-length(replace(d,old,'')))<>length(old) or strpos(d,'never mind')>0 then raise exception 'Seller withdrawal prerequisite changed';end if;
 execute replace(d,old,$new$ if public.icash_seller_direct_response_match(b,$pattern$(?:^|[.!?;] +)(?:please )?stop[.!;](?: +|$)$pattern$) then return 'opt_out';end if;
 if public.icash_seller_direct_response_match(b,$pattern$(?:^|[.!?;] +)(?:(?:ok(?:ay)?|yes)[, ]+)?(?:never mind|nevermind|forget it|go away|go to hell)(?: please)?[.! ,]*$$pattern$) then return 'declined';end if;
 decline_body:=case when b ~$new$);
end $patch$;
commit;
