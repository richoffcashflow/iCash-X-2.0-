-- The configured cash-offer formula is the operator's standing pricing policy.
-- A calculated offer is not seller acceptance, a signature, or title clearance.
begin;
create function public.icash_automatic_cash_offer_price(p_snapshot jsonb) returns bigint
language plpgsql stable security invoker set search_path='' as $$
declare d jsonb;fetched timestamptz;arv numeric;repairs numeric;price numeric;
begin
 if p_snapshot->>'propertyType' is distinct from 'house' then return null;end if;
 d:=p_snapshot->'raw'->'data';
 if jsonb_typeof(d) is distinct from 'object' or p_snapshot->>'propertyId' is null
 or p_snapshot->>'propertyId' !~ '^prop_[0-9]{1,20}$'
 or d->>'dm_property_id' is distinct from p_snapshot->>'propertyId'
 or length(btrim(coalesce(d->>'full_address',''))) not between 1 and 300 then return null;end if;
 fetched:=(p_snapshot->>'fetchedAt')::timestamptz;
 if fetched is null or fetched>now() or fetched<now()-interval '24 hours' then return null;end if;
 if jsonb_typeof(d->'estimated_value') is distinct from 'number'
 or jsonb_typeof(d->'estimated_repair_cost') is distinct from 'number' then return null;end if;
 arv:=(d->>'estimated_value')::numeric*100;repairs:=(d->>'estimated_repair_cost')::numeric*100;
 if arv<0 or repairs<0 or arv>9007199254740991 or repairs>9007199254740991
 or arv<>trunc(arv) or repairs<>trunc(repairs) then return null;end if;
 price:=floor(greatest(arv-repairs,0)*7000/10000)-case when arv>=30000000 then 2000000 else 1000000 end;
 if price<=0 then return null;end if;
 return price::bigint;
exception when invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range then return null;
end $$;

create function public.icash_claim_automatic_offer_voice_job(p_job uuid,p_snapshot jsonb,p_offer_price_cents bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;s public.icash_screening_jobs;
begin
 select * into j from public.icash_voice_jobs where id=p_job;
 if not found then return false;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=j.account_id;
 if not found or p.party<>'seller' then return false;end if;
 select * into s from public.icash_screening_jobs where id=p.screening_id and account_id=j.account_id and state='complete' for share;
 if not found or s.snapshot is distinct from p_snapshot or p_offer_price_cents is null
 or public.icash_automatic_cash_offer_price(s.snapshot) is distinct from p_offer_price_cents then return false;end if;
 -- Preserve the existing atomic contact, channel, pause, spending and dispatch checks.
 -- No fabricated manual-review row: this claim uses the standing formula policy.
 return public.icash_claim_reviewed_voice_job(p_job,null,null);
end $$;
revoke all on function public.icash_automatic_cash_offer_price(jsonb),public.icash_claim_automatic_offer_voice_job(uuid,jsonb,bigint) from public,anon,authenticated;
grant execute on function public.icash_automatic_cash_offer_price(jsonb),public.icash_claim_automatic_offer_voice_job(uuid,jsonb,bigint) to service_role;
commit;
