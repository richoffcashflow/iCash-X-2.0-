-- LOCAL REVIEW ONLY. Apply after the complete current release and before operational-sms-eligibility.sql.
-- New operational routing records are NOT recipient permission, legal review, or consent evidence.
-- Existing permission and review records are preserved unchanged. No data/approval is seeded.
begin;
alter table public.icash_dnc_verification_receipts
 add column contact_timezone text,
 add column timezone_source_reference text;
comment on column public.icash_dnc_verification_receipts.contact_timezone is 'Optional source-record time zone. Without it, supported NANP numbers use a separately labeled conservative operating window; no recipient location is claimed.';
create table public.icash_operational_contacts (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null references public.icash_owner_contacts(screening_id),
 channel text not null check(channel in ('voice','sms')),
 phone text not null check(phone ~ '^\+1[2-9][0-9]{9}$'),contact_key text not null,
 timezone text not null,timezone_basis text not null check(timezone_basis in ('source_record','conservative_nanp_window')),local_start_hour integer not null default 9 check(local_start_hour between 9 and 19),
 local_end_hour integer not null default 20 check(local_end_hour between 10 and 20),
 owner_user_id uuid not null references auth.users(id),sending_principal text not null,
 source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
 dnc_receipt_id uuid not null references public.icash_dnc_verification_receipts(id),
 eligibility_until timestamptz not null,created_at timestamptz not null default now(),revoked_at timestamptz,
 provenance text not null default 'owned_contact_data_and_dnc' check(provenance='owned_contact_data_and_dnc'),
 consent_verification text not null default 'not_performed' check(consent_verification='not_performed'),
 unique(account_id,screening_id,channel,phone,source_hash,dnc_receipt_id),
 check(contact_key=encode(sha256(convert_to(phone,'UTF8')),'hex')),check(local_start_hour<local_end_hour)
);
alter table public.icash_operational_contacts enable row level security;
revoke all on public.icash_operational_contacts from public,anon,authenticated;
grant select,insert,update on public.icash_operational_contacts to service_role;
create function public.icash_operational_contact_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if to_jsonb(new)-'revoked_at' is distinct from to_jsonb(old)-'revoked_at'
 or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at)
 then raise exception 'Operational contact provenance is immutable';end if;return new;
end $$;
create trigger icash_operational_contact_immutable before update on public.icash_operational_contacts for each row execute function public.icash_operational_contact_immutable();
create function public.icash_operational_phone(p_phone text) returns text language sql immutable set search_path='' as $$
 select case when regexp_replace(p_phone,'[^0-9]','','g') ~ '^[2-9][0-9]{9}$' then '+1'||regexp_replace(p_phone,'[^0-9]','','g')
 when regexp_replace(p_phone,'[^0-9]','','g') ~ '^1[2-9][0-9]{9}$' then '+'||regexp_replace(p_phone,'[^0-9]','','g') end
$$;
-- Versioned official geographic-NPA classification. Unknown/non-geographic NPAs
-- never receive a default operating clock. Dataset provenance is in the companion JSON.
create function public.icash_conservative_nanp_window_supported(p_phone text) returns boolean
language sql immutable set search_path='' as $$
 select p_phone ~ '^\+1[2-9][0-9]{9}$' and substring(p_phone from 3 for 3)=any(array['201','202','203','204','205','206','207','208','209','210','212','213','214','215','216','217','218','219','220','223','224','225','226','227','228','229','231','234','235','236','239','240','242','246','248','249','250','251','252','253','254','256','257','260','262','263','264','267','268','269','270','272','274','276','279','281','283','284','289','301','302','303','304','305','306','307','308','309','310','312','313','314','315','316','317','318','319','320','321','323','324','325','326','327','329','330','331','332','334','336','337','339','340','341','343','345','346','347','350','351','352','353','354','357','360','361','363','364','365','367','368','369','380','382','385','386','401','402','403','404','405','406','407','408','409','410','412','413','414','415','416','417','418','419','423','424','425','428','430','431','432','434','435','436','437','438','440','441','442','443','445','447','448','450','457','458','463','464','465','468','469','470','471','472','473','474','475','478','479','480','483','484','501','502','503','504','505','506','507','508','509','510','512','513','514','515','516','517','518','519','520','530','531','534','539','540','541','548','551','557','559','561','562','563','564','567','570','571','572','573','574','575','579','580','581','582','584','585','586','587','601','602','603','604','605','606','607','608','609','610','612','613','614','615','616','617','618','619','620','621','623','624','626','628','629','630','631','636','639','640','641','645','646','647','649','650','651','656','657','658','659','660','661','662','664','667','669','672','678','679','680','681','682','683','684','686','689','701','702','703','704','705','706','707','708','709','712','713','714','715','716','717','718','719','720','721','724','725','726','727','728','729','730','731','732','734','737','738','740','742','743','747','748','753','754','757','758','760','762','763','765','767','769','770','771','772','773','774','775','778','779','780','781','782','784','785','786','787','801','802','803','804','805','806','807','808','809','810','812','813','814','815','816','817','818','819','820','821','825','826','828','829','830','831','832','835','837','838','839','840','843','845','847','848','849','850','854','856','857','858','859','860','861','862','863','864','865','867','868','869','870','872','873','876','878','879','901','902','903','904','905','906','907','908','909','910','912','913','914','915','916','917','918','919','920','924','925','928','929','930','931','934','936','937','938','939','940','941','942','943','945','947','948','949','951','952','954','956','959','970','971','972','973','975','978','979','980','983','984','985','986','989']::text[])
$$;
-- Voice uses the narrower 09:00-18:00 policy. Unknown-location fallback excludes
-- American Samoa as well as Guam/CNMI so 19:00-20:00 UTC is inside that window
-- across the supported standard geographic regions, including DST transitions.
create function public.icash_conservative_voice_window_supported(p_phone text) returns boolean
language sql immutable set search_path='' as $$
 select public.icash_conservative_nanp_window_supported(p_phone) and substring(p_phone from 3 for 3)<>'684'
$$;
-- Pure source validation: data matching is not permission or verified ownership.
create function public.icash_operational_source_phone(p_result jsonb,p_phone text) returns boolean language sql immutable set search_path='' as $$
 select exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'contacts')='array' then p_result->'contacts' else '[]'::jsonb end) c
 cross join lateral jsonb_array_elements(case when jsonb_typeof(c->'phones')='array' then c->'phones' else '[]'::jsonb end) ph
 where c->'likelyOwner'='true'::jsonb and p_result->'requestedPersonIds' ? (c->>'personId')
 and public.icash_operational_phone(ph->>'number')=p_phone and ph->'doNotCall' is distinct from 'true'::jsonb)
 and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(p_result->'contacts')='array' then p_result->'contacts' else '[]'::jsonb end) c
 cross join lateral jsonb_array_elements(case when jsonb_typeof(c->'phones')='array' then c->'phones' else '[]'::jsonb end) ph
 where public.icash_operational_phone(ph->>'number')=p_phone and ph->'doNotCall'='true'::jsonb)
$$;
-- Lock existing evidence without granting application writers permission to alter it.
-- Narrow definer boundary: no mutations, only the receipt/source already referenced by
-- one exact operational contact. All unrelated evidence remains inaccessible to callers
-- lacking the existing service role; public/authenticated execution is revoked below.
create function public.icash_lock_operational_dnc(p_account uuid,p_contact uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.icash_operational_contacts c
 join public.icash_dnc_verification_receipts d on d.id=c.dnc_receipt_id
 join public.icash_dnc_verification_sources src on src.id=d.source_id
 where c.account_id=p_account and c.id=p_contact for share of d,src;
 return found;
end $$;
revoke all on function public.icash_lock_operational_dnc(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_lock_operational_dnc(uuid,uuid) to service_role;
create function public.icash_operational_contact_current(p_account uuid,p_contact uuid,p_channel text,p_check_hour boolean default true) returns boolean
language plpgsql security invoker set search_path='' as $$
declare c public.icash_operational_contacts;oc public.icash_owner_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;stamp timestamptz;h integer;
begin
 if p_channel not in ('voice','sms') or p_check_hour is null then return false;end if;
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account and channel=p_channel;
 if not found then return false;end if;
 -- Same order as dispatch/STOP; locks protect real rows, never a UNION view.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(c.phone,74));
 perform pg_advisory_xact_lock(hashtextextended(c.contact_key,17));
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=c.owner_user_id for share;if not found then return false;end if;
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account and channel=p_channel for share;
 select * into oc from public.icash_owner_contacts where screening_id=c.screening_id and account_id=c.account_id for share;
 if not public.icash_lock_operational_dnc(p_account,p_contact) then return false;end if;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id;
 stamp:=clock_timestamp();
 if c.revoked_at is not null or c.eligibility_until<=stamp or oc.screening_id is null
 or c.source_hash is distinct from encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
 or not public.icash_operational_source_phone(oc.result,c.phone)
 or not exists(select 1 from public.icash_operation_spend o where o.operation_key=oc.operation_key and o.account_id=p_account and o.state in ('dispatched','settled'))
 or not exists(select 1 from public.icash_screening_jobs s where s.id=c.screening_id and s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true')
 or not exists(select 1 from public.icash_customer_identities where account_id=p_account and principal=c.sending_principal)
 or not exists(select 1 from public.icash_discovery_configs where account_id=p_account and contacts_enabled and data_rights_until>stamp)
 or d.id is null or d.phone is distinct from c.phone or d.contact_key is distinct from c.contact_key or d.clear is distinct from true or d.revoked_at is not null
 or d.checked_at>stamp or d.checked_at<stamp-interval '30 days' or d.expires_at<=stamp
 or (c.timezone_basis='source_record' and (d.contact_timezone is distinct from c.timezone or length(trim(coalesce(d.timezone_source_reference,'')))<12))
 or (c.timezone_basis='conservative_nanp_window' and (c.timezone<>'Pacific/Honolulu'
  or (c.channel='voice' and (c.local_start_hour<>9 or c.local_end_hour<>10 or not public.icash_conservative_voice_window_supported(c.phone)))
  or (c.channel='sms' and (c.local_start_hour<>10 or c.local_end_hour<>12 or not public.icash_conservative_nanp_window_supported(c.phone)))))
 or src.id is null or not src.enabled or src.expires_at<=stamp
 or not exists(select 1 from pg_timezone_names where name=c.timezone)
 or exists(select 1 from public.icash_text_suppressions where phone=c.phone)
 or exists(select 1 from public.icash_contact_suppressions where contact_key=c.contact_key)
 or exists(select 1 from public.icash_contact_permissions where account_id=p_account and screening_id=c.screening_id and phone=c.phone and revoked_at is not null)
 then return false;end if;
 h:=extract(hour from stamp at time zone c.timezone);
 return not p_check_hour or (h>=greatest(9,c.local_start_hour) and h<least(case when c.channel='voice' then 18 else 20 end,c.local_end_hour));
end $$;
-- SMS fallback uses 20:00-22:00 UTC inside its existing 09:00-20:00 policy.
-- Voice fallback uses 19:00-20:00 UTC and also excludes American Samoa; all
-- voice initiation is capped at 18:00. Unsupported regional codes require
-- source-record location. Pacific/Honolulu is an OPERATING CLOCK here,
-- not a claim about the recipient's location. This is not legal clearance.
-- Bounded service-only preparation from existing real purchased records and independent DNC/location evidence.
-- Does not modify permissions, approvals, receipts, customer acknowledgment, pause or spending state.
create function public.icash_prepare_operational_contacts(p_account uuid default null) returns integer language plpgsql security invoker set search_path='' as $$
declare item record;ch text;n integer:=0;inserted integer;
begin
 for item in
 select distinct oc.account_id,oc.screening_id,a.owner_user_id,i.principal,public.icash_operational_phone(ph->>'number') phone,
 encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') source_hash,
 receipt.id dnc_id,case when zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12 then zone.name else 'Pacific/Honolulu' end timezone,
 case when zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12 then 'source_record' else 'conservative_nanp_window' end timezone_basis,least(receipt.expires_at,receipt.checked_at+interval '30 days',src.expires_at,cfg.data_rights_until) until
 from public.icash_owner_contacts oc
 join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused
 join public.icash_customer_identities i on i.account_id=a.id and length(trim(i.principal))>0
 join public.icash_discovery_configs cfg on cfg.account_id=a.id and cfg.contacts_enabled and cfg.data_rights_until>now()
 join public.icash_screening_jobs s on s.id=oc.screening_id and s.account_id=a.id and s.state='complete' and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true'
 join public.icash_operation_spend spend on spend.operation_key=oc.operation_key and spend.account_id=a.id and spend.state in ('dispatched','settled')
 cross join lateral jsonb_array_elements(case when jsonb_typeof(oc.result->'contacts')='array' then oc.result->'contacts' else '[]'::jsonb end) person
 cross join lateral jsonb_array_elements(case when jsonb_typeof(person->'phones')='array' then person->'phones' else '[]'::jsonb end) ph
 join public.icash_dnc_verification_receipts receipt on receipt.phone=public.icash_operational_phone(ph->>'number') and receipt.contact_key=encode(sha256(convert_to(receipt.phone,'UTF8')),'hex') and receipt.clear and receipt.revoked_at is null and receipt.checked_at between now()-interval '30 days' and now() and receipt.expires_at>now()
 join public.icash_dnc_verification_sources src on src.id=receipt.source_id and src.enabled and src.expires_at>now()
 left join pg_timezone_names zone on zone.name=receipt.contact_timezone
 where (p_account is null or oc.account_id=p_account)
 and (public.icash_conservative_nanp_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12))
 and public.icash_operational_source_phone(oc.result,receipt.phone)
 and not exists(select 1 from public.icash_text_suppressions where phone=receipt.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=receipt.contact_key)
 and not exists(select 1 from public.icash_operational_contacts old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and not exists(select 1 from public.icash_contact_permissions old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and ((not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='voice')
   and (public.icash_conservative_voice_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12)))
  or not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='sms'))
 order by oc.account_id,oc.screening_id,receipt.id limit 100
 loop
  foreach ch in array array['voice','sms'] loop
   if ch='voice' and item.timezone_basis='conservative_nanp_window' and not public.icash_conservative_voice_window_supported(item.phone) then continue;end if;
   insert into public.icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until)
   values(item.account_id,item.screening_id,ch,item.phone,encode(sha256(convert_to(item.phone,'UTF8')),'hex'),item.timezone,item.timezone_basis,case when ch='voice' or item.timezone_basis='source_record' then 9 else 10 end,case when item.timezone_basis='source_record' then case when ch='voice' then 18 else 20 end else case when ch='voice' then 10 else 12 end end,item.owner_user_id,item.principal,item.source_hash,item.dnc_id,item.until)
   on conflict do nothing;get diagnostics inserted=row_count;n:=n+inserted;
  end loop;
 end loop;
 return n;
end $$;
-- Keep separate real foreign keys. A new operational record is never stored as a legacy permission.
alter table public.icash_voice_jobs alter column permission_id drop not null,
 add column operational_contact_id uuid references public.icash_operational_contacts(id),
 add constraint icash_voice_job_contact_source check((permission_id is null)<>(operational_contact_id is null));
create unique index icash_voice_operational_first_once on public.icash_voice_jobs(operational_contact_id) where callback_id is null;
-- Compatibility projection for read-only context, pacing and spend plumbing. The legacy
-- permission_until alias means only technical eligibility for operational rows; no consent record is created.
create view public.icash_voice_contact_targets as
 select id,account_id,screening_id,party,phone,contact_key,timezone,local_start_hour,local_end_hour,permission_evidence,permission_until,dnc_checked_at,dnc_clear,revoked_at,buyer_id,review_request_id,'operator_record'::text as eligibility_source
 from public.icash_contact_permissions
 union all
 select c.id,c.account_id,c.screening_id,'seller'::text,c.phone,c.contact_key,c.timezone,c.local_start_hour,c.local_end_hour,
 null::text,c.eligibility_until,d.checked_at,d.clear,c.revoked_at,null::uuid,null::uuid,'operational_checks_only'::text
 from public.icash_operational_contacts c join public.icash_dnc_verification_receipts d on d.id=c.dnc_receipt_id where c.channel='voice';
revoke all on public.icash_voice_contact_targets from public,anon,authenticated;
grant select on public.icash_voice_contact_targets to service_role;
-- Update read/plumbing consumers only. Keep existing wrapper call order, inventory claims,
-- budgets, provider checks, offer ceilings and buyer-marketing snapshots unchanged.
do $patch$
declare r record;def text;needle text;
begin
 for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in (
  'icash_claim_voice_job','icash_claim_reviewed_voice_job','icash_claim_reviewed_voice_before_campaign',
  'icash_voice_sms_context',
  'icash_launch_checks','icash_inbound_property_context','icash_reception_property_context')
 loop
  def:=pg_get_functiondef(r.oid);
  if position('public.icash_contact_permissions' in def)=0 then continue;end if;
  if r.proname='icash_claim_voice_job' then
   needle:=' select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;';
   if position(needle in def)=0 then raise exception 'Final voice contact lock changed';end if;
   def:=replace(def,needle,$n$
 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(j.account_id,j.operational_contact_id,'voice',true) then return false;end if;
 else
  perform 1 from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;
 end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=j.account_id;
$n$);
  end if;
  if r.proname='icash_claim_voice_job' then
   needle:='if h<p.local_start_hour or h>=p.local_end_hour then return false;end if;';
   if position(needle in def)=0 then raise exception 'Voice quiet-hours final boundary changed';end if;
   def:=replace(def,needle,'if h<greatest(9,p.local_start_hour) or h>=least(18,p.local_end_hour) then return false;end if;');
  end if;
  -- No consumer in this allowlist writes contact evidence.
  def:=replace(def,'p public.icash_contact_permissions','p public.icash_voice_contact_targets');
  def:=replace(def,'from public.icash_contact_permissions','from public.icash_voice_contact_targets');
  def:=replace(def,'join public.icash_contact_permissions','join public.icash_voice_contact_targets');
  def:=replace(def,'id=j.permission_id','id=coalesce(j.permission_id,j.operational_contact_id)');
  def:=replace(def,'id=v.permission_id','id=coalesce(v.permission_id,v.operational_contact_id)');
  -- Restore the explicit legacy lock: a UNION view cannot be row-locked.
  def:=replace(def,'perform 1 from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=j.account_id for share;',
                    'perform 1 from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;');
  execute def;
 end loop;
 -- Inbound paths retain their routing rules; only uncertain-call exclusion sees both sources.
 for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname in ('icash_begin_inbound_voice','icash_begin_inbound_before_invitations')
 loop
  def:=pg_get_functiondef(r.oid);
  def:=replace(def,'join public.icash_contact_permissions cp on cp.id=j.permission_id','join public.icash_voice_contact_targets cp on cp.id=coalesce(j.permission_id,j.operational_contact_id)');
  execute def;
 end loop;
end $patch$;
-- SOURCE-DEFINED finance adapters, derived only from the authoritative local
-- released-schema fixture plus config/daytime-pacing.sql. Never inspect protected
-- live reserve/bootstrap definitions. Preserve existing reserve_operation call
-- chain, activation/cost/margin checks and existing ACLs via CREATE OR REPLACE.
CREATE OR REPLACE FUNCTION public.icash_voice_daytime_allowance(p_account uuid, p_permission uuid, p_clock timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare p public.icash_voice_contact_targets;c public.icash_daytime_pacing_settings;local_time timestamp;start_h integer;end_h integer;current_h numeric;daily bigint;spent numeric;total_weight numeric:=0;available_weight numeric:=0;weight numeric;h integer;n integer;positive integer;protected boolean;cap bigint;
begin
 select * into p from public.icash_voice_contact_targets where id=p_permission and account_id=p_account;
 select * into c from public.icash_daytime_pacing_settings where id=1;
 if p.id is null or not exists(select 1 from pg_timezone_names where name=p.timezone) then return jsonb_build_object('allowedCents',0,'reason','timezone_required');end if;
 select daily_limit_cents into daily from public.icash_accounts where id=p_account;
 start_h:=greatest(9,p.local_start_hour);end_h:=least(18,p.local_end_hour);
 local_time:=p_clock at time zone p.timezone;current_h:=extract(hour from local_time)+extract(minute from local_time)/60.0;
 if current_h<start_h or current_h>=end_h or end_h<=start_h then return jsonb_build_object('allowedCents',0,'reason','outside_contact_hours');end if;
 for h in start_h..end_h-1 loop
 select count(*),count(*) filter(where coalesce((v.result->>'interested')::boolean,false)) into n,positive
 from public.icash_live_conversations v join public.icash_voice_jobs j on j.operation_key=v.operation_key and j.account_id=v.account_id join public.icash_voice_contact_targets cp on cp.id=coalesce(j.permission_id,j.operational_contact_id) and cp.account_id=v.account_id
 where v.account_id=p_account and v.party='seller' and v.state='complete' and j.callback_id is null and cp.timezone=p.timezone and v.created_at>=p_clock-interval '90 days' and v.created_at<p_clock
 and extract(hour from v.created_at at time zone cp.timezone)=h
 and (extract(isodow from v.created_at at time zone cp.timezone)<=5)=(extract(isodow from local_time)<=5);
 -- Start evenly. Tilt only after enough account-specific observed outcomes, with bounded smoothing.
 weight:=case when n>=c.min_samples_per_hour then greatest(0.5,least(1.5,((positive+3.0)/(n+10.0))/0.3)) else 1 end;
 total_weight:=total_weight+weight;
 available_weight:=available_weight+weight*greatest(0,least(1,current_h-h+1));
 end loop;
 protected:=exists(select 1 from public.icash_voice_jobs where account_id=p_account and callback_id is not null and state in ('ready','issued','dispatching')) or exists(select 1 from public.icash_deal_files where account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing'));
 cap:=floor(daily*case when protected then (10000-c.active_deal_reserve_bps)/10000.0 else 1 end*available_weight/nullif(total_weight,0));
 select coalesce(sum(case when o.state='settled' then o.charged_cents else o.charge_cap_cents end),0) into spent from public.icash_operation_spend o
 where o.account_id=p_account and ((o.state='settled' and o.settled_at>=date_trunc('day',local_time) at time zone p.timezone) or o.state in ('reserved','dispatched'));
 return jsonb_build_object('allowedCents',greatest(0,cap-spent),'releasedCents',cap,'committedCents',spent,'timezone',p.timezone,'reason','daytime_pacing','protectedForActiveDeals',protected);
end $function$;
CREATE OR REPLACE FUNCTION public.icash_reserve_paced_voice(p_account uuid, p_job uuid, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;r public.icash_operation_rates;a jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return false;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 select * into r from public.icash_operation_rates where id=p_rate;
 if p.id is null or r.id is null then return false;end if;
 if p.party='seller' and j.callback_id is null and exists(select 1 from public.icash_daytime_pacing_settings where id=1 and enabled)
 and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id and account_id=p_account) then
 a:=public.icash_voice_daytime_allowance(p_account,p.id);
 if coalesce((a->>'allowedCents')::bigint,0)<r.charge_cents then
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '30 minutes',outcome='Waiting for daytime budget allocation',updated_at=now() where id=j.id;
 return false;
 end if;end if;

 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',true)
   or not public.icash_claim_inventory(p_account,p.screening_id,p.phone) then return false;end if;
  p_permission_until:=least(p_permission_until,p.permission_until);
 end if;
 perform public.icash_reserve_operation(p_account,'voice:'||j.id,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
 return true;
end $function$;

-- Queue each account/property/number at most once across BOTH source types.
alter function public.icash_queue_voice_jobs() rename to icash_queue_voice_jobs_before_operational;
do $patch$declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_queue_voice_jobs_before_operational()'::regprocedure);
 needle:='and p.party=''seller''';
 if position(needle in def)=0 then raise exception 'Legacy seller queue predicate changed';end if;
 execute replace(def,needle,needle||$n$ and not exists(select 1 from public.icash_voice_jobs prior join public.icash_operational_contacts oc on oc.id=prior.operational_contact_id where prior.account_id=p.account_id and oc.account_id=p.account_id and oc.screening_id=p.screening_id and oc.contact_key=p.contact_key and prior.callback_id is null)$n$);
end $patch$;

create function public.icash_queue_voice_jobs() returns void language plpgsql security invoker set search_path='' as $$
declare c public.icash_operational_contacts;b record;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform public.icash_prepare_operational_contacts();
 perform public.icash_queue_voice_jobs_before_operational();
 for c in select op.* from public.icash_operational_contacts op
 join public.icash_accounts a on a.id=op.account_id and not a.bot_paused
 join public.icash_voice_configs cfg on cfg.account_id=op.account_id and cfg.enabled and cfg.reviewed_until>now()
 join public.icash_screening_jobs s on s.id=op.screening_id and s.account_id=op.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 where op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()
 and not exists(select 1 from public.icash_contact_permissions legacy where legacy.account_id=op.account_id and legacy.screening_id=op.screening_id and legacy.phone=op.phone)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=op.account_id and campaign.mode='sms_inbound')
 and not exists(select 1 from public.icash_voice_jobs prior join public.icash_voice_contact_targets target on target.id=coalesce(prior.permission_id,prior.operational_contact_id)
  where prior.account_id=op.account_id and target.account_id=op.account_id and target.screening_id=op.screening_id and target.contact_key=op.contact_key and prior.callback_id is null)
 order by op.created_at,op.id limit 100
 loop
  if public.icash_operational_contact_current(c.account_id,c.id,'voice',false)
   and not exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
    where j.account_id=c.account_id and target.account_id=c.account_id and target.screening_id=c.screening_id and target.contact_key=c.contact_key and j.callback_id is null)
  then insert into public.icash_voice_jobs(account_id,operational_contact_id) values(c.account_id,c.id) on conflict do nothing;end if;
 end loop;
 for b in select cb.id,cb.account_id,cb.due_at,op.id as target_id from public.icash_live_callbacks cb
 join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id and call.state='complete' and (call.result->>'callbackDueAt')::timestamptz=cb.due_at
 join public.icash_operational_contacts op on op.account_id=cb.account_id and op.screening_id=cb.screening_id and op.contact_key=call.contact_key and op.channel='voice'
 where call.party='seller' and cb.state='pending_dispatch_review' and cb.due_at>now()-interval '15 minutes'
 and not exists(select 1 from public.icash_voice_jobs job where job.callback_id=cb.id)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=cb.account_id and campaign.mode='sms_inbound')
 order by cb.due_at,op.created_at desc limit 100
 loop
  if public.icash_operational_contact_current(b.account_id,b.target_id,'voice',false) then
   insert into public.icash_voice_jobs(account_id,operational_contact_id,callback_id,due_at) values(b.account_id,b.target_id,b.id,b.due_at) on conflict do nothing;
  end if;
 end loop;
end $$;
-- STOP must invalidate both source types without deleting original records or retrying work.
create function public.icash_stop_operational_contacts() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_operational_contacts set revoked_at=coalesce(revoked_at,clock_timestamp()) where phone=new.phone;
 update public.icash_voice_jobs j set state='held',outcome='Contact opted out',updated_at=now()
 from public.icash_operational_contacts c where j.operational_contact_id=c.id and c.phone=new.phone and j.state='ready';
 update public.icash_live_callbacks b set state='canceled' from public.icash_live_conversations c
 where b.conversation_id=c.id and b.state in ('pending_dispatch_review','held_for_human','missed')
 and c.contact_key=encode(sha256(convert_to(new.phone,'UTF8')),'hex');
 return new;
end $$;
create trigger icash_stop_operational_contacts after insert on public.icash_text_suppressions for each row execute function public.icash_stop_operational_contacts();
-- Match operational rows to their real tenant and allowed channel even on privileged writes.
create function public.icash_voice_operational_binding() returns trigger language plpgsql set search_path='' as $$
begin
 if new.operational_contact_id is not null and not exists(select 1 from public.icash_operational_contacts where id=new.operational_contact_id and account_id=new.account_id and channel='voice') then raise exception 'Operational voice tenant/channel mismatch';end if;
 if tg_op='UPDATE' and row(new.account_id,new.permission_id,new.operational_contact_id,new.callback_id) is distinct from row(old.account_id,old.permission_id,old.operational_contact_id,old.callback_id) then raise exception 'Voice job contact binding is immutable';end if;
 return new;
end $$;
create trigger icash_voice_operational_binding before insert or update on public.icash_voice_jobs for each row execute function public.icash_voice_operational_binding();
revoke all on function public.icash_operational_contact_immutable(),public.icash_operational_phone(text),public.icash_conservative_nanp_window_supported(text),public.icash_conservative_voice_window_supported(text),public.icash_operational_source_phone(jsonb,text),public.icash_operational_contact_current(uuid,uuid,text,boolean),public.icash_prepare_operational_contacts(uuid),public.icash_queue_voice_jobs(),public.icash_queue_voice_jobs_before_operational(),public.icash_stop_operational_contacts(),public.icash_voice_operational_binding() from public,anon,authenticated;
grant execute on function public.icash_operational_phone(text),public.icash_conservative_nanp_window_supported(text),public.icash_conservative_voice_window_supported(text),public.icash_operational_source_phone(jsonb,text),public.icash_operational_contact_current(uuid,uuid,text,boolean),public.icash_prepare_operational_contacts(uuid),public.icash_queue_voice_jobs(),public.icash_queue_voice_jobs_before_operational() to service_role;
commit;
