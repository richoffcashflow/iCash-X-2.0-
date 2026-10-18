begin;
set local lock_timeout='3s';
-- Meta's shared completion URL contains no verified lead identity. Save the
-- visitor's candidate privately, then confirm it through the lead's SMS link.
create table public.icash_meta_address_requests(
 id uuid primary key,source_id uuid not null references public.icash_meta_lead_sources(id),phone text not null,
 candidate_address text not null check(length(candidate_address) between 8 and 300),lead_id uuid references public.icash_meta_leads(lead_id),
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 minutes',
 check(phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$')
);
create index icash_meta_address_requests_match on public.icash_meta_address_requests(source_id,phone,created_at desc);
alter table public.icash_meta_address_requests enable row level security;
revoke all on public.icash_meta_address_requests from public,anon,authenticated;
grant all on public.icash_meta_address_requests to service_role;
create function public.icash_meta_request_address_link(p_request uuid,p_slug text,p_phone text,p_address text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare src uuid;lead uuid;existing public.icash_meta_address_requests;
begin
 select id into src from public.icash_meta_lead_sources where slug=p_slug and enabled and reviewed_until>now();
 if src is null then return null;end if;
 delete from public.icash_meta_address_requests where expires_at<now();
 select * into existing from public.icash_meta_address_requests where id=p_request;
 if found then
  if existing.phone is distinct from p_phone or existing.source_id is distinct from src or existing.candidate_address is distinct from p_address then return null;end if;
  return existing.lead_id;
 end if;
 perform pg_advisory_xact_lock(hashtextextended('meta-address:'||p_phone,0));
 if exists(select 1 from public.icash_meta_address_requests where source_id=src and phone=p_phone and created_at>now()-interval '5 minutes') then return null;end if;
 select m.lead_id into lead from public.icash_meta_leads m join public.icash_seller_intakes l on l.id=m.lead_id
 where m.source_id=src and l.phone=p_phone and m.submitted_at>now()-interval '30 minutes' and not m.paused and m.declined_at is null
 and public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is not null order by m.created_at desc limit 1;
 insert into public.icash_meta_address_requests(id,source_id,phone,candidate_address,lead_id) values(p_request,src,p_phone,p_address,lead);
 return lead;
end $$;
create function public.icash_meta_address_session(p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;candidate text;
begin
 select * into m from public.icash_meta_leads where link_hash=p_hash and link_expires_at>now();
 select * into l from public.icash_seller_intakes where id=m.lead_id;
 if m.lead_id is null or public.icash_seller_contact_evidence(m.account_id,m.screening_id,m.lead_id,l.phone) is null then return null;end if;
 select candidate_address into candidate from public.icash_meta_address_requests where source_id=m.source_id and phone=l.phone and expires_at>now() order by created_at desc limit 1;
 return jsonb_build_object('leadId',m.lead_id,'state',l.state,'address',coalesce(l.address,candidate,''));
end $$;
create function public.icash_meta_match_address_request(p_lead uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare m public.icash_meta_leads;l public.icash_seller_intakes;
begin
 select * into m from public.icash_meta_leads where lead_id=p_lead;
 select * into l from public.icash_seller_intakes where id=p_lead;
 update public.icash_meta_address_requests set lead_id=p_lead where source_id=m.source_id and phone=l.phone and lead_id is null and expires_at>now() and created_at>=m.submitted_at-interval '1 minute';
 return exists(select 1 from public.icash_meta_address_requests where lead_id=p_lead and expires_at>now());
end $$;
revoke all on function public.icash_meta_request_address_link(uuid,text,text,text),public.icash_meta_address_session(text),public.icash_meta_match_address_request(uuid) from public,anon,authenticated;
grant execute on function public.icash_meta_request_address_link(uuid,text,text,text),public.icash_meta_address_session(text),public.icash_meta_match_address_request(uuid) to service_role;
commit;
