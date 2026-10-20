-- Stop launch follow-ups for receipt-backed checkout phone matches as well as email.
create or replace function public.icash_legacy_sync(p_launch uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Any receipt-backed live purchase stops this acquisition sequence permanently,
 -- including a customer who later cancels or refunds. A pending checkout never counts.
 with purchased as (
  select c.id,min(i.recorded_at) paid_at,(array_agg(m.id order by i.recorded_at))[1] membership_id
  from public.icash_legacy_contacts c join public.icash_memberships m on m.mode='live' and ((c.email is not null and c.email=lower(trim(m.payer_email))) or (c.phone is not null and c.phone=m.payer_phone))
  join public.icash_membership_invoices i on i.membership_id=m.id
  where c.launch_id=p_launch and c.converted_at is null group by c.id
 ) update public.icash_legacy_contacts c set converted_at=p.paid_at,membership_id=p.membership_id,updated_at=now() from purchased p where p.id=c.id;
 update public.icash_legacy_contacts c set suppressed_reason='Refund or dispute in billing history',stopped_at=coalesce(stopped_at,now())
 where c.launch_id=p_launch and c.suppressed_reason is null and exists(
  select 1 from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id
  join public.icash_billing_reviews r on r.payment_id=i.stripe_payment_id where m.mode='live' and ((c.email is not null and lower(trim(m.payer_email))=c.email) or (c.phone is not null and m.payer_phone=c.phone)));
 update public.icash_legacy_outbox o set state='cancelled',updated_at=now() from public.icash_legacy_contacts c
 where o.contact_id=c.id and c.launch_id=p_launch and o.state='queued'
 and (c.converted_at is not null or c.stopped_at is not null or c.suppressed_reason is not null or c.replied_at is not null);
end $$;

create or replace function public.icash_legacy_admit(p_contact uuid,p_channel text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_legacy_contacts c join public.icash_legacy_launches l on l.id=c.launch_id
 where c.id=p_contact and l.state='active' and l.approved_at is not null and l.approved_revision=l.revision and l.history_reviewed_at is not null and l.started_at is not null
 and now()>=greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')
 and now()<greatest(l.started_at,c.created_at,coalesce(c.last_purchase_at,c.created_at)+interval '7 days')+interval '30 days'
 and c.suppressed_reason is null and c.stopped_at is null and c.replied_at is null and c.converted_at is null
 and not exists(select 1 from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id where m.mode='live' and ((c.email is not null and lower(trim(m.payer_email))=c.email) or (c.phone is not null and m.payer_phone=c.phone)))
 and not exists(select 1 from public.icash_legacy_contacts other where other.id<>c.id and ((c.email is not null and other.email=c.email) or (c.phone is not null and other.phone=c.phone)) and (other.stopped_at is not null or other.suppressed_reason is not null or other.converted_at is not null))
 and case when p_channel='email' then c.email is not null and c.email_permission
  and not exists(select 1 from public.icash_email_suppressions s where lower(s.email)=c.email)
  and not exists(select 1 from public.icash_webinar_suppressions s where lower(s.email)=c.email)
 when p_channel='sms' then c.phone is not null and c.sms_permission
  and not exists(select 1 from public.icash_text_suppressions s where s.phone=c.phone)
  and not exists(select 1 from public.icash_webinar_phone_suppressions s where s.phone=c.phone)
  and not exists(select 1 from public.icash_contact_suppressions s where s.contact_key=encode(sha256(convert_to(c.phone,'UTF8')),'hex'))
 else false end);
$$;

create or replace function public.icash_legacy_payment_stop() returns trigger language plpgsql security invoker set search_path='' as $$
declare em text;ph text;l uuid;
begin
 if tg_table_name='icash_membership_invoices' then select lower(trim(payer_email)),payer_phone into em,ph from public.icash_memberships where id=new.membership_id and mode='live';
 else if new.mode='live' then em:=lower(trim(new.payer_email));ph:=new.payer_phone;end if;end if;
 if em is not null or ph is not null then
  for l in select distinct launch_id from public.icash_legacy_contacts where email=em or phone=ph loop perform public.icash_legacy_sync(l);end loop;
 end if;return new;
end $$;

create or replace function public.icash_legacy_report(p_launch uuid,p_query text default '',p_page integer default 1) returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.icash_legacy_launches;result jsonb;
begin
 if p_page<1 or p_page>10000 or length(p_query)>200 then raise exception 'Invalid page';end if;
 perform public.icash_legacy_sync(p_launch);select * into l from public.icash_legacy_launches where id=p_launch;
 with people as materialized (
  select c.*,coalesce(c.last_purchase_at,c.created_at)+interval '7 days' eligible_after,
   exists(select 1 from public.icash_legacy_outbox o where o.contact_id=c.id and o.sent_at is not null) contacted,
   exists(select 1 from public.icash_webinar_sessions s join public.icash_webinar_events e on e.session_id=s.id and e.kind='started' where exists(select 1 from public.icash_legacy_visitors b where b.contact_id=c.id and b.visitor_id=s.visitor_id) and s.config->>'legacyCampaignId'=l.id::text and not s.is_preview) watched,
   (c.converted_at is not null and l.started_at is not null and c.converted_at>=l.started_at and
    (c.first_visit_at<=c.converted_at or exists(select 1 from public.icash_legacy_outbox o where o.contact_id=c.id and o.sent_at<=c.converted_at))) acquired
  from public.icash_legacy_contacts c where c.launch_id=l.id
 ), filtered as materialized (
  select * from people where p_query='' or strpos(lower(coalesce(email,'')||' '||name||' '||coalesce(phone,'')),lower(p_query))>0
 ), paged as (select * from filtered order by created_at,id offset (p_page-1)*100 limit 100)
 select jsonb_build_object('campaign',to_jsonb(l),'counts',jsonb_build_object(
  'customers',(select count(*) from people),'contacted',(select count(*) from people where contacted),
  'visited',(select count(*) from people where first_visit_at is not null),'watched',(select count(*) from people where watched),
  'acquired',(select count(distinct membership_id) from people where acquired),'alreadyPaid',(select count(distinct membership_id) from people where converted_at is not null and not coalesce(acquired,false)),
  'suppressed',(select count(*) from people where suppressed_reason is not null or stopped_at is not null),
  'whop',(select count(*) from people where 'whop'=any(sources)),'highlevel',(select count(*) from people where 'highlevel'=any(sources)),
  'emailPermission',(select count(*) from people where email is not null and email_permission),'smsPermission',(select count(*) from people where phone is not null and sms_permission),
  'emails',(select count(*) from people where email is not null),'phones',(select count(*) from people where phone is not null),
  'cooling',(select count(*) from people where eligible_after>now() and converted_at is null and suppressed_reason is null),
  'sent',(select count(*) from public.icash_legacy_outbox where launch_id=l.id and sent_at is not null),
  'uncertain',(select count(*) from public.icash_legacy_outbox where launch_id=l.id and state='uncertain')),
  'contacts',coalesce((select jsonb_agg(to_jsonb(p)-'token'-'source_ids') from paged p),'[]'),
  'totalMatches',(select count(*) from filtered),'page',p_page,
  'webinarCode',(select public_code from public.icash_webinars where id=l.webinar_id)) into result;
 return result;
end $$;

drop trigger icash_legacy_membership_stop on public.icash_memberships;
create trigger icash_legacy_membership_stop after insert or update of payer_email,payer_phone,paid_through on public.icash_memberships for each row execute function public.icash_legacy_payment_stop();
