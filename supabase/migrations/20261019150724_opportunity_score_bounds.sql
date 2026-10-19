-- Keep learned market influence bounded, including seller-initiated responses.
create or replace function public.icash_opportunity_market_score(p_account uuid,p_zip text) returns numeric
language sql stable security invoker set search_path='' as $$
 select case when count(*)<20 then 0 else greatest(-0.5,least(1,
  0.25*(count(*) filter(where eligible)+2.0)/(count(*)+4.0)
  +0.25*(count(*) filter(where responded and not opted_out)+1.0)/(count(*) filter(where attempted or responded or purchase_signed)+5.0)
  +0.35*(count(*) filter(where interested and not opted_out)+0.5)/(count(*) filter(where attempted or responded or purchase_signed)+5.0)
  +0.15*(count(*) filter(where purchase_signed)+0.25)/(count(*) filter(where attempted or responded or purchase_signed)+5.0)
  -least(0.5,count(*) filter(where opted_out)::numeric/greatest(1,count(*) filter(where attempted or responded or purchase_signed))))) end
 from public.icash_opportunity_outcomes where account_id=p_account and zip=p_zip and research_source and discovered_at between now()-interval '90 days' and now()-interval '1 day';
$$;
