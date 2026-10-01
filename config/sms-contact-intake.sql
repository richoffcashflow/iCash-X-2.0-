begin;
-- Apply after sms-inbound-campaign.sql. No contacts, approvals, rates or releases seeded.
alter table public.icash_authority_market_reviews drop constraint icash_authority_market_reviews_channel_check;
alter table public.icash_authority_market_reviews add constraint icash_authority_market_reviews_channel_check check(channel in ('voice','sms','offer','buyer_marketing'));
alter table public.icash_text_threads add column sms_review_request_id uuid references public.icash_authority_review_requests(id),add column sms_intake_pending boolean not null default false;

-- A read-only quote check; never reserves funds or manufactures supplier costs.
create function public.icash_sms_intake_rate_current(p_rate uuid) returns boolean language plpgsql set search_path='' as $$
declare r public.icash_operation_rates;b public.icash_operating_budget;price bigint;cat text;n numeric;total numeric:=0;required numeric;
begin
 select * into r from public.icash_operation_rates where id=p_rate and operation='sms_send' and enabled and verified_at<=now() and expires_at>now() and charge_cents>0;
 if not found then return false;end if;
 select * into b from public.icash_operating_budget where id=1;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment';
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then return false;end if;
  n:=(r.costs_micros->>cat)::numeric;if n<0 or n<>trunc(n) or n>9007199254740991 then return false;end if;total:=total+n;
 end loop;
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/10000);
 return coalesce(price>=required and r.charge_cents>=ceil(price::numeric/10000),false);
end $$;

-- Caller holds budget -> recipient -> account locks. Lock evidence through the final claim.
create function public.icash_sms_thread_review_current(p_account uuid,p_thread uuid,p_check_hour boolean default true) returns boolean language plpgsql set search_path='' as $$
declare t public.icash_text_threads;r public.icash_authority_review_requests;p jsonb;v jsonb;h integer;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.sms_review_request_id is null or t.party<>'seller' then return false;end if;
 select req.* into r from public.icash_authority_review_requests req
 join public.icash_accounts a on a.id=req.account_id and a.owner_user_id=req.submitted_by
 join public.icash_customer_identities i on i.account_id=req.account_id and i.principal=req.payload->>'sendingPrincipal'
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=req.account_id and d.screening_id=req.screening_id and d.id::text=req.payload->>'dealId' and d.terms->>'state'=req.payload->>'stateCode' and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
 join public.icash_authority_market_reviews m on m.id::text=req.verification->>'marketReviewId' and m.account_id=req.account_id and m.screening_id=req.screening_id and m.kind='contact_permission' and m.channel='sms' and m.state_code=req.payload->>'stateCode' and m.revoked_at is null and m.reviewed_at<=now() and m.expires_at>now()
 join public.icash_dnc_verification_receipts dr on dr.id::text=req.verification->>'dncReceiptId' and dr.phone=t.recipient and dr.checked_at=t.dnc_checked_at and dr.clear and dr.revoked_at is null and dr.checked_at between now()-interval '30 days' and now() and dr.expires_at>now()
 join public.icash_dnc_verification_sources src on src.id=dr.source_id and src.enabled and src.expires_at>now()
 join public.icash_text_senders sender on sender.phone=t.sender and sender.enabled
 join public.icash_operation_rates rate on rate.id=t.sms_rate_id and rate.id::text=req.verification->>'smsRateId' and encode(sha256(convert_to(to_jsonb(rate)::text,'UTF8')),'hex')=req.verification->>'smsRateHash'
 join public.icash_communication_prices price on price.operation='sms_segment' and price.customer_micros::text=req.verification->>'smsPriceMicros'
 where req.id=t.sms_review_request_id and req.account_id=p_account and req.kind='contact_permission' and req.payload->>'channel'='sms' and req.state='approved' and req.expires_at>now()
 for share of req,a,i,d,m,dr,src,sender,rate,price;
 if not found then return false;end if;
 p:=r.payload;v:=r.verification;
 if t.recipient is distinct from p->>'phone' or t.sender is distinct from v->>'smsSender' or t.timezone is distinct from p->>'timezone'
 or t.permission_until is distinct from r.expires_at or t.permission_evidence is distinct from v->>'consentReference'
 or v->'smsConsentConfirmed' is distinct from 'true'::jsonb or v->>'smsConsentBusiness' is distinct from p->>'sendingPrincipal'
 or not t.dnc_clear or t.dnc_checked_at is null or t.dnc_checked_at not between now()-interval '30 days' and now()
 or not public.icash_sms_intake_rate_current(t.sms_rate_id)
 or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
 or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')) then return false;end if;
 h:=extract(hour from now() at time zone t.timezone);
 return not p_check_hour or (h>=(p->>'localStartHour')::integer and h<(p->>'localEndHour')::integer);
end $$;

-- Preserve existing voice/offer/marketing implementations, adding only the SMS branch.
do $patch$
declare def text;needle text;replacement text;
begin
 def:=pg_get_functiondef('public.icash_submit_authority_review(uuid,uuid,uuid,jsonb)'::regprocedure);
 needle:=' h:=encode(sha256(convert_to(p_payload::text,''UTF8'')),''hex'');';
 if position(needle in def)=0 then raise exception 'Authority submit definition changed';end if;
 replacement:=$n$
 if p_payload->>'kind'='contact_permission' and p_payload->>'channel'='sms' then
  if p_payload->>'party' is distinct from 'seller' or p_payload->>'buyerId' is not null then raise exception 'Seller SMS scope required';end if;
  if not exists(select 1 from public.icash_customer_identities where account_id=p_account and length(trim(principal))>0) then raise exception 'Sending business identity required';end if;
  if (select count(*) from public.icash_deal_files where account_id=p_account and screening_id=(p_payload->>'screeningId')::uuid and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true')<>1 then raise exception 'One owned real property deal required';end if;
  p_payload:=p_payload||jsonb_build_object('sendingPrincipal',(select principal from public.icash_customer_identities where account_id=p_account),'dealId',(select id from public.icash_deal_files where account_id=p_account and screening_id=(p_payload->>'screeningId')::uuid and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true'));
 end if;
$n$;
 def:=replace(def,needle,replacement||needle);
 needle:=$n$p_payload->>'channel' is distinct from 'voice'$n$;
 if position(needle in def)=0 then raise exception 'Authority channel definition changed';end if;
 def:=replace(def,needle,$n$coalesce(p_payload->>'channel','') not in ('voice','sms')$n$);execute def;

 def:=pg_get_functiondef('public.icash_decide_authority_review(uuid,uuid,text,text,jsonb)'::regprocedure);
 needle:='expiry timestamptz;checked timestamptz;contact text;old_review uuid;amount bigint;sig jsonb;expected jsonb;n integer;';
 if position(needle in def)=0 then raise exception 'Authority decision declaration changed';end if;
 def:=replace(def,needle,needle||' sms_thread public.icash_text_threads;sms_rate public.icash_operation_rates;sms_price bigint;');
 needle:=' select * into strict r from public.icash_authority_review_requests where id=p_request for update;';
 replacement:=$n$
 select * into strict r from public.icash_authority_review_requests where id=p_request;
 if r.payload->>'channel'='sms' then
  perform 1 from public.icash_operating_budget where id=1 for update;
  perform pg_advisory_xact_lock(hashtextextended(r.payload->>'phone',74));
  perform 1 from public.icash_accounts where id=r.account_id for update;
 end if;
$n$;
 if position(needle in def)=0 then raise exception 'Authority decision lock changed';end if;
 def:=replace(def,needle,replacement||needle);
 needle:=' if r.state=p_decision then return r;end if;';
 if position(needle in def)=0 then raise exception 'Authority decision retry changed';end if;
 def:=replace(def,needle,$n$ if r.state=p_decision then
  if r.payload->>'channel'='sms' and (r.decision_note is distinct from p_note or (p_decision='approved' and r.verification-array['smsRateId','smsRateHash','smsPriceMicros'] is distinct from v)) then raise exception 'Conflicting SMS review retry';end if;
  return r;end if;$n$);
 needle:=$n$  if exists(select 1 from public.icash_contact_permissions where account_id=r.account_id and screening_id=r.screening_id and party=p->>'party' and contact_key=contact and revoked_at is not null)$n$;
 if position(needle in def)=0 then raise exception 'Voice permission branch changed';end if;
 replacement:=$n$
  if p->>'channel'='sms' then
   if v->'smsConsentConfirmed' is distinct from 'true'::jsonb or not public.icash_authority_text(v,'smsPriorContactReference') or v->>'smsConsentBusiness' is distinct from p->>'sendingPrincipal'
    or not exists(select 1 from public.icash_customer_identities where account_id=r.account_id and principal=p->>'sendingPrincipal') then raise exception 'Actual sending-business SMS consent and prior-contact evidence required';end if;
   select * into d from public.icash_deal_files where id=(p->>'dealId')::uuid and account_id=r.account_id and screening_id=r.screening_id and terms->>'state'=p->>'stateCode' and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
   if not found then raise exception 'Owned real SMS property binding changed';end if;
   perform 1 from public.icash_text_senders where phone=v->>'smsSender' and enabled for share;if not found then raise exception 'Configured SMS sender required';end if;
   select * into sms_rate from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id) order by verified_at desc,id limit 1 for share;
   if not found then raise exception 'Current fully priced SMS rate required';end if;
   select customer_micros into sms_price from public.icash_communication_prices where operation='sms_segment' for share;
   expiry:=least(expiry,sms_rate.expires_at);
   select * into sms_thread from public.icash_text_threads where sender=v->>'smsSender' and recipient=p->>'phone' for update;
   if found and (sms_thread.account_id<>r.account_id or sms_thread.deal_id<>d.id or sms_thread.party<>'seller' or sms_thread.sms_review_request_id is null) then raise exception 'SMS recipient binding conflict';end if;
   if sms_thread.sms_review_request_id is not null then perform public.icash_revoke_authority_review(sms_thread.sms_review_request_id,p_reviewer,'Superseded by a new explicit SMS review');end if;
   v:=v||jsonb_build_object('smsRateId',sms_rate.id,'smsRateHash',encode(sha256(convert_to(to_jsonb(sms_rate)::text,'UTF8')),'hex'),'smsPriceMicros',sms_price);
   insert into public.icash_text_threads(account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused,party,ai_mode,sms_review_request_id,sms_intake_pending)
   values(r.account_id,d.id,v->>'smsSender',p->>'phone',expiry,v->>'consentReference',p->>'timezone',dnc.checked_at,true,sms_rate.id,true,'seller','auto',r.id,true)
   on conflict(sender,recipient) do update set permission_until=excluded.permission_until,permission_evidence=excluded.permission_evidence,timezone=excluded.timezone,dnc_checked_at=excluded.dnc_checked_at,dnc_clear=true,sms_rate_id=excluded.sms_rate_id,paused=true,sms_review_request_id=excluded.sms_review_request_id,sms_intake_pending=true;
  else
$n$;
 def:=replace(def,needle,replacement||needle);
 needle:=$n$ elsif r.kind='offer_ceiling' then$n$;
 if position(needle in def)=0 then raise exception 'Authority branch boundary changed';end if;
 def:=replace(def,needle,' end if;'||E'\n'||needle);execute def;

 def:=pg_get_functiondef('public.icash_revoke_authority_review(uuid,uuid,text)'::regprocedure);
 needle:=' select * into strict r from public.icash_authority_review_requests where id=p_request for update;';
 if position(needle in def)=0 then raise exception 'Authority revoke lock changed';end if;
 replacement:=$n$
 select * into strict r from public.icash_authority_review_requests where id=p_request;
 if r.payload->>'channel'='sms' then
  perform 1 from public.icash_operating_budget where id=1 for update;
  perform pg_advisory_xact_lock(hashtextextended(r.payload->>'phone',74));
  perform 1 from public.icash_accounts where id=r.account_id for update;
 end if;
$n$;
 def:=replace(def,needle,replacement||needle);
 needle:=' if r.state=''revoked'' then return;end if;';
 if position(needle in def)=0 then raise exception 'Authority revoke definition changed';end if;
 def:=replace(def,needle,needle||$n$
 update public.icash_text_threads set paused=true,sms_intake_pending=false,permission_until=least(permission_until,now()) where sms_review_request_id=r.id;
 update public.icash_text_messages msg set state='cancelled',updated_at=now() from public.icash_text_threads th where msg.thread_id=th.id and th.sms_review_request_id=r.id and msg.direction='outgoing' and msg.state='ready';
$n$);execute def;
end $patch$;

-- Recheck the exact SMS revision inside existing atomic dispatch and incoming routing.
do $patch$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_claim_text(uuid,uuid,text)'::regprocedure);
 needle:=' if t.dnc_checked_at>now() then return null;end if;';
 if position(needle in def)=0 then raise exception 'Campaign final text boundary changed';end if;
 execute replace(def,needle,needle||E'\n if not public.icash_sms_thread_review_current(p_account,t.id,true) then return null;end if;');
 def:=pg_get_functiondef('public.icash_begin_inbound_voice(text,text,text,text,text,text,text,text)'::regprocedure);
 needle:=$n$ select * into t from public.icash_text_threads where id=i.thread_id and account_id=i.account_id and deal_id=i.deal_id and sender=i.sender and recipient=i.recipient and party='seller' and not paused for share;if not found then return null;end if;$n$;
 if position(needle in def)=0 then raise exception 'Campaign incoming boundary changed';end if;
 execute replace(def,needle,needle||E'\n if not public.icash_sms_thread_review_current(i.account_id,t.id,false) then return null;end if;');
end $patch$;

alter function public.icash_set_work_control(uuid,uuid,text,uuid) rename to icash_set_work_control_before_sms_intake;
create function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void language plpgsql security invoker set search_path='' as $$
declare t public.icash_text_threads;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform public.icash_set_work_control_before_sms_intake(p_user,p_account,p_action,p_screening);
 -- Run may release only the initial intake hold, never a STOP, human handoff or manual pause.
 if p_action='resume' and public.icash_sms_inbound_campaign_current(p_account) then
  for t in select th.* from public.icash_text_threads th join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
   where th.account_id=p_account and th.sms_intake_pending and th.paused and th.ai_mode='auto' and d.stage='draft' and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at between now()-interval '24 hours' and now()
   and not exists(select 1 from public.icash_property_controls pc where pc.account_id=p_account and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   and not exists(select 1 from public.icash_text_messages msg where msg.thread_id=th.id)
   order by th.recipient for update of th
  loop
   if public.icash_sms_thread_review_current(p_account,t.id,false) then update public.icash_text_threads set paused=false,sms_intake_pending=false where id=t.id and sms_review_request_id=t.sms_review_request_id;end if;
  end loop;
 end if;
end $$;
revoke all on function public.icash_sms_intake_rate_current(uuid),public.icash_sms_thread_review_current(uuid,uuid,boolean),public.icash_set_work_control_before_sms_intake(uuid,uuid,text,uuid),public.icash_set_work_control(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_sms_intake_rate_current(uuid),public.icash_sms_thread_review_current(uuid,uuid,boolean),public.icash_set_work_control_before_sms_intake(uuid,uuid,text,uuid),public.icash_set_work_control(uuid,uuid,text,uuid) to service_role;
commit;
