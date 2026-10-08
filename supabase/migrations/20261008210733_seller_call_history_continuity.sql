begin;
-- Preserve opening ownership answers and later qualifications. Context only;
-- contact permissions, exact quote authority and signing rules do not change.
do $$declare d text;begin
 d:=pg_get_functiondef('public.icash_voice_sms_context(uuid,uuid)'::regprocedure);
 if position('limit 12' in d)=0 then raise exception 'Voice SMS history prerequisite changed';end if;
 execute replace(d,'limit 12','limit 48');
end $$;
create function public.icash_seller_prior_call_context(p_account uuid,p_screening uuid,p_phone text)
returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('completed_at',completed_at,'result',jsonb_build_object('transcript',result->'transcript','summary',left(result->>'summary',1500))) order by completed_at desc),'[]'::jsonb)
 from (select completed_at,result from public.icash_live_conversations
  where account_id=p_account and screening_id=p_screening and contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
  and party='seller' and state='complete' and operation_key like 'voice:%' and completed_at between now()-interval '30 days' and now()
  order by completed_at desc limit 3) calls
$$;
revoke all on function public.icash_seller_prior_call_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_prior_call_context(uuid,uuid,text) to service_role;
-- The existing nonce-bound function establishes a unique property first.
-- Keep its existing ACL and attach only that seller/account/property's history.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_recorded_reception_property_context(uuid,text)'::regprocedure);
 needle:=$n$ return context||jsonb_build_object('companyName',company);$n$;
 if position(needle in d)=0 then raise exception 'Reception context prerequisite changed';end if;
 execute replace(d,needle,$n$
 if context->>'status'='matched' then
  context:=context||coalesce((
   select jsonb_build_object('priorCalls',public.icash_seller_prior_call_context(s.account_id,only_deal.screening_id,s.from_phone))
   from icash_recorded_reception_private.sessions s
   cross join lateral (
    select (array_agg(f.screening_id))[1] screening_id from public.icash_deal_files f
    where f.account_id=s.account_id and f.terms->>'address'=context->>'address' and f.stage not in ('closed','cancelled')
    and coalesce(f.terms->>'practice','false')<>'true' having count(*)=1
   ) only_deal
   where s.id=p_id and s.nonce_hash=p_nonce_hash and only_deal.screening_id is not null
  ),'{}'::jsonb);
 end if;
 return context||jsonb_build_object('companyName',company);$n$);
end $$;
commit;
