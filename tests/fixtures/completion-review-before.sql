CREATE OR REPLACE FUNCTION public.icash_review_learning_operations()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a jsonb;b jsonb;begin a:=public.icash_review_operations_before_cohorts();b:=public.icash_review_policy_cohorts();if (b->>'errors')::integer>0 then update icash_learning_private.components set last_error_at=now(),last_error_code='P0001' where component='review';end if;return a||jsonb_build_object('policyCohorts',b);end $function$
