CREATE OR REPLACE FUNCTION public.icash_claim_journey_assignment_before_completion(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_deal_journeys;d public.icash_deal_files;t public.icash_text_threads;owner_id uuid;mail text;p jsonb;
begin
 select * into j from public.icash_deal_journeys where id=p_id and state='ready' and expires_at>now() for update;if not found then return null;end if;
 select * into d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for update;
 if not public.icash_journey_allowed(j.account_id,j.deal_id) then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=j.account_id and not paused and not manual_only and retired_at is null;
 if not found or public.icash_sms_thread_review_current(j.account_id,t.id,true) is distinct from true or exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 if exists(select 1 from public.icash_signing_envelopes where account_id=j.account_id and deal_id=j.deal_id and kind='assignment' and not test_mode)
  or exists(select 1 from public.icash_deal_journeys where deal_id=j.deal_id and id<>j.id and state in ('sending','signing','deposit_due','reserved')) then
  update public.icash_deal_journeys set state='needs_review',review_reason='Another buyer assignment is already in progress',updated_at=now() where id=j.id;return null;end if;
 select a.owner_user_id,u.email into owner_id,mail from public.icash_accounts a join auth.users u on u.id=a.owner_user_id where a.id=j.account_id and u.email_confirmed_at is not null;
 p:=public.icash_buyer_package_data(j.account_id,j.deal_id);
 if mail is null or j.buyer_details is null or p is null or j.buyer_details->'askingPriceCents' is distinct from p->'askingPriceCents' or j.buyer_details->'depositCents' is distinct from p->'depositCents' or p->'reserved'='true'::jsonb or (p->>'depositCents')::bigint not between 1 and 500000 then return null;end if;
 update public.icash_deal_files set terms=terms||jsonb_build_object('assignee',j.buyer_details->>'legalName'),updated_at=now() where id=d.id;
 update public.icash_deal_journeys set state='sending',updated_at=now(),next_run_at=now()+interval '10 minutes' where id=j.id;
 return jsonb_build_object('id',j.id,'accountId',j.account_id,'dealId',j.deal_id,'userId',owner_id,'customerEmail',mail,'signerName',j.buyer_details->>'signerName','email',j.buyer_details->>'email','phone',t.recipient);
end $function$
;
