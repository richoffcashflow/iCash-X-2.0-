-- The runner owns this transaction and its migration ledger. Existing requests,
-- provider receipts, agreements and payout preferences are never rewritten.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $pins$
declare f record;p record;
begin
 for f in select * from (values
  ('public.icash_claim_title_request_snapshot(uuid,jsonb)','2d913f4e2de09e1c9804681126e0e493','v'),
  ('public.icash_claim_title_request_before_snapshot(uuid)','91a3775344ab741fcc1ba9395cc861d0','v'),
  ('public.icash_save_closing_setup_before_profile(uuid,uuid,uuid,text,jsonb)','c80380bdeaf4baa684850ec5425d6ff6','v'),
  ('public.icash_signing_action_allowed(uuid,uuid)','0c8dd6053164498e0f2e400d8e55d3b7','s')
 ) expected(signature,source_hash,volatility) loop
  select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl
   into p from pg_proc where oid=to_regprocedure(f.signature);
  if p.source_hash is distinct from f.source_hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from false
   or p.provolatile::text is distinct from f.volatility or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
   or p.acl is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Title delivery prerequisite changed: %',f.signature;end if;
 end loop;
end $pins$;

create function public.icash_title_request_delivery_snapshot(p_account uuid,p_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with request as (
  select j.*,d.terms as current_terms from public.icash_title_requests j join public.icash_deal_files d on d.id=j.deal_id and d.account_id=j.account_id
  where j.id=p_id and j.account_id=p_account and j.state='ready' and j.provider_id is null
   and d.stage in ('under_contract','buyer_selected','title_open','closing') and j.property_address=d.terms->>'address'
   and not exists(select 1 from public.icash_agreement_cancellations c where c.account_id=j.account_id and c.deal_id=j.deal_id and (c.state='pending' or c.late_activity))
 ), agreements as (
  select e.id,e.kind,jsonb_build_object('id',e.id,'accountId',e.account_id,'dealId',e.deal_id,'kind',e.kind,
   'state',e.state,'testMode',e.test_mode,'providerId',e.provider_id,'terms',e.terms,'termsHash',e.terms_hash,
   'templateId',e.template_id,'recipients',e.recipients,'createdAt',e.created_at) source
  from public.icash_signing_envelopes e join request j on e.account_id=j.account_id and e.deal_id=j.deal_id
  where e.state='completed' and not e.test_mode and nullif(btrim(e.provider_id),'') is not null
   and (e.kind='purchase' and e.id=j.purchase_envelope_id and e.terms->>'address'=j.property_address or e.kind='assignment' and e.terms=j.current_terms)
   and public.icash_signing_action_allowed(e.account_id,e.id)
 ), assignments as (
  select coalesce(jsonb_agg(source order by id),'[]'::jsonb) sources from agreements where kind='assignment'
 )
 select jsonb_build_object('version','title-delivery-v1','request',jsonb_build_object('id',j.id,'accountId',j.account_id,'dealId',j.deal_id,
  'purchaseEnvelopeId',j.purchase_envelope_id,'recipient',j.recipient,'propertyAddress',j.property_address,'rateId',j.rate_id,'verifiedUntil',j.verified_until),
  'dealTerms',j.current_terms,'purchase',p.source,'assignments',a.sources,'payout',s.payout)
 from request j join agreements p on p.kind='purchase' cross join assignments a
 left join public.icash_closing_setup s on s.account_id=j.account_id and s.deal_id=j.deal_id
 where jsonb_array_length(a.sources)<=1 and jsonb_array_length(a.sources)=(select count(*) from public.icash_signing_envelopes e
  where e.account_id=j.account_id and e.deal_id=j.deal_id and e.kind='assignment' and e.state='completed' and not e.test_mode);
$$;
revoke all on function public.icash_title_request_delivery_snapshot(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_title_request_delivery_snapshot(uuid,uuid) to service_role;

alter function public.icash_claim_title_request_snapshot(uuid,jsonb) rename to icash_claim_title_request_before_delivery_snapshot;
create function public.icash_claim_title_request_snapshot(p_id uuid,p_expected jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare j public.icash_title_requests;current_source jsonb;
begin
 -- Old workers have no bound attachment/payout source and cannot dispatch.
 if jsonb_typeof(p_expected) is distinct from 'object' or p_expected->>'version' is distinct from 'title-delivery-v1' then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_title_requests where id=p_id;
 if not found or j.account_id::text is distinct from p_expected->'request'->>'accountId'
  or j.state<>'ready' or j.provider_id is not null then return false;end if;
 -- Follow the shared cancellation/setup order before current-source row locks.
 perform 1 from public.icash_accounts where id=j.account_id for update;
 perform 1 from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for update;
 perform 1 from public.icash_signing_envelopes where account_id=j.account_id and deal_id=j.deal_id and not test_mode and state<>'cancelled' order by id for share;
 perform 1 from public.icash_closing_setup where account_id=j.account_id and deal_id=j.deal_id for share;
 perform 1 from public.icash_title_contacts where account_id=j.account_id and deal_id=j.deal_id for share;
 perform 1 from public.icash_title_requests where id=j.id for update;
 select public.icash_title_request_delivery_snapshot(j.account_id,j.id) into current_source;
 if current_source is null or current_source is distinct from p_expected then return false;end if;
 -- Preserve the entire existing reservation and final claim authority.
 return public.icash_claim_title_request_before_delivery_snapshot(j.id,p_expected->'request');
end $$;
revoke all on function public.icash_claim_title_request_snapshot(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_title_request_snapshot(uuid,jsonb) to service_role;

do $result$
declare f record;p record;
begin
 for f in select * from (values
  ('public.icash_title_request_delivery_snapshot(uuid,uuid)','177676c00defda782d4dd1004c397d10','s'),
  ('public.icash_claim_title_request_snapshot(uuid,jsonb)','7177660cb0bfb790182637f7069842ac','v'),
  ('public.icash_claim_title_request_before_delivery_snapshot(uuid,jsonb)','cd5514a18bbc37f56a24bada45c0f1d9','v'),
  ('public.icash_claim_title_request_before_snapshot(uuid)','91a3775344ab741fcc1ba9395cc861d0','v'),
  ('public.icash_save_closing_setup_before_profile(uuid,uuid,uuid,text,jsonb)','c80380bdeaf4baa684850ec5425d6ff6','v'),
  ('public.icash_signing_action_allowed(uuid,uuid)','0c8dd6053164498e0f2e400d8e55d3b7','s')
 ) expected(signature,source_hash,volatility) loop
  select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl
   into p from pg_proc where oid=to_regprocedure(f.signature);
  if p.source_hash is distinct from f.source_hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from false
   or p.provolatile::text is distinct from f.volatility or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
   or p.acl is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Title delivery result changed: %',f.signature;end if;
 end loop;
end $result$;
