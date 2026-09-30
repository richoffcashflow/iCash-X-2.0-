create or replace function public.icash_deal_email_contacts(p_account uuid,p_deal uuid)
returns table(contact_key text,email text,display_name text,party text,verified_until timestamptz)
language sql stable set search_path='' as $$
 select 'title',lower(c.email),coalesce(nullif(d.terms->>'escrowAgent',''),'Closing office'),'title',c.verified_until
 from public.icash_title_contacts c join public.icash_deal_files d on d.id=c.deal_id and d.account_id=c.account_id
 where c.account_id=p_account and c.deal_id=p_deal and c.enabled and c.verified_until>now()
 union all
 select 'signer:'||e.id||':'||r.n,lower(r.value->>'email'),r.value->>'name',case e.kind when 'purchase' then 'seller' else 'buyer' end,e.updated_at+interval '90 days'
 from public.icash_signing_envelopes e join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id
 cross join lateral jsonb_array_elements(e.recipients) with ordinality r(value,n)
 where e.account_id=p_account and e.deal_id=p_deal and e.state='completed' and not e.test_mode
 and e.updated_at>now()-interval '90 days' and e.kind in ('purchase','assignment')
 and r.n<jsonb_array_length(e.recipients) and length(r.value->>'email') between 3 and 320
 union all
 select 'buyer-request:'||m.id,lower((regexp_match(m.body,'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]),'Cash buyer','buyer',m.created_at+interval '30 days'
 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
 where t.account_id=p_account and t.deal_id=p_deal and t.party='buyer' and not t.paused
 and m.direction='incoming' and m.created_at>now()-interval '30 days'
 and m.body ~* '\m(email|send|forward)\M' and m.body ~* '\m(details|info|information|package)\M'
 and m.body !~* '\m(stop|unsubscribe|not|never|cancel)\M|don.t'
 and (select count(*) from regexp_matches(m.body,'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}','g'))=1
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=t.recipient);
$$;
revoke all on function public.icash_deal_email_contacts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_deal_email_contacts(uuid,uuid) to service_role;


-- Re-check automatic buyer packages immediately before the existing atomic spend claim.
alter function public.icash_claim_deal_email(uuid,uuid) rename to icash_claim_deal_email_before_buyer_packages;
create function public.icash_claim_deal_email(p_account uuid,p_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare m public.icash_deal_emails;d public.icash_deal_files;
begin
 select * into m from public.icash_deal_emails where id=p_id and account_id=p_account;
 if m.contact_key like 'buyer-request:%' then
 select * into d from public.icash_deal_files where id=m.deal_id and account_id=p_account;
 if d.id is null or d.stage not in ('under_contract','buyer_selected') then return null;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=d.screening_id and pc.account_id=p_account and pc.manual) then return null;end if;
 if not exists(select 1 from public.icash_disposition_authorities a join public.icash_signing_envelopes e on e.id=a.purchase_envelope_id and e.account_id=a.account_id and e.deal_id=a.deal_id where a.account_id=p_account and a.deal_id=d.id and a.expires_at>now() and e.kind='purchase' and e.state='completed' and not e.test_mode and a.asking_price_cents=(d.terms->>'priceCents')::bigint+(d.terms->>'assignmentFeeCents')::bigint) then return null;end if;
 end if;
 return public.icash_claim_deal_email_before_buyer_packages(p_account,p_id);
end $$;
revoke all on function public.icash_claim_deal_email(uuid,uuid),public.icash_claim_deal_email_before_buyer_packages(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_claim_deal_email(uuid,uuid),public.icash_claim_deal_email_before_buyer_packages(uuid,uuid) to service_role;
