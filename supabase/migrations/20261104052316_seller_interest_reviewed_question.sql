-- Treat the exact reviewed timing opener like the cash opener, and derive
-- seller interest only from affirmative transcript evidence. No saved result,
-- transcript, assignment, receipt or derived outcome row is rewritten here.
-- Existing readers adopt the corrected helper during their ordinary refresh.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Inspect both definitions before replacing either. Exact after hashes permit
-- safe replay while any unreviewed function drift fails the whole transaction.
do $guard$
declare expected record;definition text;
begin
 for expected in select * from (values
  ('public.icash_seller_interest_quote(jsonb)','54b4d07db92082f856fe148a0a0890b6','100b79d54c2f094f32672cf5979bd689'),
  ('public.icash_call_selling_interest(jsonb)','d2cc7e5da9ca74ed46687e47ac4be794','36ae5b81b3282f5f98d931f0082a751b')
 ) v(signature,before_hash,after_hash) loop
  definition:=pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(expected.signature));
  if definition is null or pg_catalog.md5(definition) not in (expected.before_hash,expected.after_hash) then
   raise exception 'seller interest function drift: %',expected.signature;
  end if;
 end loop;
end $guard$;

-- CREATE OR REPLACE preserves the existing service-only execute grants.
-- Both functions remain immutable security invoker functions with empty paths.
-- Answer regexes include a literal end anchor before their dollar delimiter.
-- This rejects conditional or hypothetical continuations after an affirmation.
CREATE OR REPLACE FUNCTION public.icash_seller_interest_quote(p_result jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare turn jsonb;body text;question text:='';evidence text;
begin
 if jsonb_typeof(p_result->'transcript') is distinct from 'array'
  or p_result->>'contactEvidence' in ('automated_answer','no_response')
  or public.icash_seller_call_disposition(p_result) is not null then return null;end if;
 for turn in select value from jsonb_array_elements(p_result->'transcript') loop
  if jsonb_typeof(turn->'message') is distinct from 'string' then continue;end if;
  body:=lower(trim(regexp_replace(translate(turn->>'message','’‘',$quote$''$quote$),'\s+',' ','g')));
  if turn->>'role'='agent' then question:=body;continue;end if;
  if turn->>'role' is distinct from 'user' then question:='';continue;end if;
  if public.icash_call_has_seller_response(jsonb_build_object('transcript',jsonb_build_array(turn))) and (
   body ~ $pattern$^((i am|i'm|we are|we're) (interested in|open to) selling|(i|we) (want|would like) to sell)( (my|our|the) (house|home|property))?[.! ]*$$pattern$
   or (body ~ $pattern$^(yes|yeah|yep|sure|interested|i am interested|i'm interested|yes i am|yes,? i am interested|yes,? interested)[.! ,]*$$pattern$
    and (question='would you be open to a cash offer if the price and timing worked for you?'
     or (question ~ $pattern$(would you (be (interested in|open to)|consider)|are you (interested in|open to)|do you want to) (sell(ing)?|a cash offer)$pattern$
    and right(question,1)='?' and length(question)-length(replace(question,'?',''))=1
    and question !~ '\y(owner|own|hearing|hear|discuss|talk|information|send|permission|not|never|if|unless|maybe|learn|learning)\y')))
  ) then evidence:=turn->>'message';end if;
  question:='';
 end loop;
 return evidence;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_call_selling_interest(p_result jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select public.icash_call_has_seller_response(p_result)
  and p_result->'optedOut' is distinct from 'true'::jsonb
  and public.icash_seller_call_disposition(p_result) is null
  and public.icash_seller_interest_quote(p_result) is not null;
$function$;

do $verified$
declare expected record;
begin
 for expected in select * from (values
  ('public.icash_seller_interest_quote(jsonb)','100b79d54c2f094f32672cf5979bd689'),
  ('public.icash_call_selling_interest(jsonb)','36ae5b81b3282f5f98d931f0082a751b')
 ) v(signature,after_hash) loop
  if pg_catalog.md5(pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(expected.signature))) is distinct from expected.after_hash then
   raise exception 'seller interest definition verification failed: %',expected.signature;
  end if;
 end loop;
end $verified$;
commit;

