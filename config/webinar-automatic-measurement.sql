begin;
-- Keep a real consent receipt distinct from US automatic ad measurement.
create function public.icash_webinar_measurement_since(p_consent timestamptz,p_measurement jsonb)
returns timestamptz language plpgsql stable security invoker set search_path='' as $$
declare automatic_since timestamptz;
begin
 if nullif(p_measurement->>'opt_out_at','') is not null then return null;end if;
 if p_measurement->>'basis'='automatic_us' and p_measurement->>'country'='US' and p_measurement->>'policy_version'='webinar-meta-2026-10-16' then
  begin automatic_since:=nullif(p_measurement->>'automatic_since','')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then automatic_since:=null;end;
 end if;
 return least(p_consent,automatic_since);
end $$;

-- A row lock prevents a delayed automatic request from undoing an opt-out.
create function public.icash_webinar_measurement_access(p_visitor uuid,p_action text,p_automatic_eligible boolean,p_blocked boolean,p_metadata jsonb default '{}')
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.icash_webinar_visitors; m jsonb; since timestamptz; metadata jsonb;
begin
 if p_action not in ('read','automatic','allow','deny') then raise exception 'Invalid measurement action';end if;
 select * into v from public.icash_webinar_visitors where id=p_visitor for update;
 if not found then raise exception 'Visitor not found';end if;
 m:=coalesce(v.measurement,'{}');
 select coalesce(jsonb_object_agg(key,value),'{}') into metadata from jsonb_each(coalesce(p_metadata,'{}'))
  where key in ('client_user_agent','client_ip_address','fbp','fbc') and jsonb_typeof(value)='string';
 if p_blocked or p_action='deny' then
  v.marketing_consent_at:=null;
  m:=jsonb_build_object('opt_out_at',coalesce(m->>'opt_out_at',now()::text),'policy_version','webinar-meta-2026-10-16');
 elsif p_action='allow' then
  v.marketing_consent_at:=coalesce(v.marketing_consent_at,now());
  m:=(m-'opt_out_at')||jsonb_build_object('version','webinar-meta-2026-10-16');
 elsif p_action='automatic' and p_automatic_eligible and nullif(m->>'opt_out_at','') is null then
  m:=m||jsonb_build_object('basis','automatic_us','country','US','policy_version','webinar-meta-2026-10-16','automatic_since',coalesce(m->>'automatic_since',now()::text));
 end if;
 -- An unrecognized/non-US location never keeps an automatic basis active.
 if not p_automatic_eligible then
  m:=m-'automatic_since'-'basis'-'country';
 end if;
 since:=public.icash_webinar_measurement_since(v.marketing_consent_at,m);
 if since is not null then m:=m||metadata;
 else
  m:=m-'client_user_agent'-'client_ip_address'-'fbp'-'fbc';
  update public.icash_webinar_meta_events set state='canceled',payload=null
   where visitor_id=p_visitor and state in ('pending','sending','failed');
 end if;
 update public.icash_webinar_visitors set marketing_consent_at=v.marketing_consent_at,measurement=m where id=p_visitor
  and (marketing_consent_at is distinct from v.marketing_consent_at or measurement is distinct from m);
 return jsonb_build_object('email',v.email,'marketing_consent_at',v.marketing_consent_at,'measurement',m);
end $$;

create or replace function public.icash_webinar_sync_purchases(p_visitor uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce((select (config->'meta'->>'enabled')::boolean from public.icash_webinar_settings where id=1),false) then return;end if;
 insert into public.icash_webinar_meta_events(event_id,payment_id,visitor_id,session_id,value_cents,occurred_at,purchase_kind)
 select 'webinar:purchase:'||p.payment_id,p.payment_id,p.visitor_id,p.session_id,p.value_cents,p.occurred_at,p.purchase_kind
 from public.icash_webinar_meta_purchases() p join public.icash_webinar_visitors v on v.id=p.visitor_id
 where (p_visitor is null or p.visitor_id=p_visitor)
  and public.icash_webinar_measurement_since(v.marketing_consent_at,v.measurement)<=p.occurred_at
  and p.occurred_at>=now()-interval '6 days'
 on conflict do nothing;
 update public.icash_webinar_meta_events e set state='canceled',payload=null
 where e.state in ('pending','sending','failed') and (p_visitor is null or e.visitor_id=p_visitor)
  and (e.purchase_kind is null or e.occurred_at<now()-interval '6 days'
   or not exists(select 1 from public.icash_webinar_visitors v where v.id=e.visitor_id
    and public.icash_webinar_measurement_since(v.marketing_consent_at,v.measurement)<=e.occurred_at)
   or exists(select 1 from public.icash_billing_reviews r where r.payment_id=e.payment_id));
end $$;

create or replace function public.icash_webinar_claim_meta() returns setof public.icash_webinar_meta_events
language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_webinar_meta_events set state='failed' where state='sending' and claimed_at<now()-interval '5 minutes' and attempts>=5;
 return query with candidates as (
  select e.event_id from public.icash_webinar_meta_events e join public.icash_webinar_visitors v on v.id=e.visitor_id
  where (e.state='pending' or (e.state='sending' and e.claimed_at<now()-interval '5 minutes')) and e.due_at<=now() and e.attempts<5
   and e.purchase_kind in ('membership','vip_upgrade') and e.occurred_at>=now()-interval '6 days'
   and public.icash_webinar_measurement_since(v.marketing_consent_at,v.measurement)<=e.occurred_at
   and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=e.payment_id)
  order by e.due_at for update of e skip locked limit 10
 ) update public.icash_webinar_meta_events e set state='sending',attempts=attempts+1,claimed_at=now()
  from candidates c where e.event_id=c.event_id returning e.*;
end $$;
revoke all on function public.icash_webinar_measurement_since(timestamptz,jsonb),public.icash_webinar_measurement_access(uuid,text,boolean,boolean,jsonb),public.icash_webinar_sync_purchases(uuid),public.icash_webinar_claim_meta() from public,anon,authenticated;
grant execute on function public.icash_webinar_measurement_since(timestamptz,jsonb),public.icash_webinar_measurement_access(uuid,text,boolean,boolean,jsonb),public.icash_webinar_sync_purchases(uuid),public.icash_webinar_claim_meta() to service_role;
commit;
