-- Customer invitations reuse Webinar 1 content without entering the ad funnel.
-- Keep immutable purchase/session evidence and ordinary ad measurement intact.
create function public.icash_legacy_meta_excluded(p_payment text,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_webinar_sessions s where s.id=p_session and nullif(s.config->>'legacyCampaignId','') is not null)
 or exists(select 1 from public.icash_membership_invoices i join public.icash_legacy_checkouts b on b.membership_id=i.membership_id and b.created_at<=i.recorded_at where i.stripe_payment_id=p_payment)
 or exists(select 1 from public.icash_plan_changes c join public.icash_legacy_checkouts b on b.membership_id=c.membership_id and b.created_at<=c.applied_at where c.payment_id=p_payment);
$$;
revoke all on function public.icash_legacy_meta_excluded(text,uuid) from public,anon,authenticated;
grant execute on function public.icash_legacy_meta_excluded(text,uuid) to service_role;

-- Filter after the existing last-session decision. Never fall back to an older
-- ad session when the actual purchase belongs to the private customer journey.
do $$ declare signature text;definition text;source text;begin
 foreach signature in array array['public.icash_webinar_attributed_purchases()','public.icash_webinar_meta_purchases()'] loop
  select pg_get_functiondef(p.oid),p.prosrc into definition,source from pg_proc p where p.oid=signature::regprocedure;
  if position('icash_legacy_meta_excluded' in source)>0 or position('select' in source)=0 then raise exception 'Unexpected purchase definition: %',signature;end if;
  definition:=replace(definition,source,'select original.* from ('||rtrim(source,E' \n\r;')||') original(payment_id,value_cents,occurred_at,session_id,visitor_id) where not public.icash_legacy_meta_excluded(original.payment_id,original.session_id)');
  execute definition;
 end loop;
 select pg_get_functiondef('public.icash_webinar_sync_purchases(uuid)'::regprocedure) into definition;
 if position('e.purchase_kind is null' in definition)=0 then raise exception 'Unexpected purchase sync definition';end if;
 execute replace(definition,'e.purchase_kind is null','public.icash_legacy_meta_excluded(e.payment_id,e.session_id) or e.purchase_kind is null');
 select pg_get_functiondef('public.icash_webinar_claim_meta()'::regprocedure) into definition;
 if position('and e.purchase_kind in' in definition)=0 then raise exception 'Unexpected Meta claim definition';end if;
 execute replace(definition,'and e.purchase_kind in','and not public.icash_legacy_meta_excluded(e.payment_id,e.session_id) and e.purchase_kind in');
end $$;

-- Only unresolved customer-campaign events are canceled. Sent history stays.
update public.icash_webinar_meta_events e set state='canceled',payload=null
where e.state in ('pending','sending','failed') and public.icash_legacy_meta_excluded(e.payment_id,e.session_id);
