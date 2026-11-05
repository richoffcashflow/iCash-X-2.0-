begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- The original screening can require payoff clarification. A later confirmed
-- agreement has its own exact, source-bound authority; never rewrite that screen.
create function public.icash_confirmed_seller_contract_text_current(p_account uuid,p_message uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from public.icash_contract_text_deliveries x
  join public.icash_text_messages m on m.id=x.message_id and m.account_id=x.account_id and m.thread_id=x.thread_id
  join public.icash_text_threads t on t.id=x.thread_id and t.account_id=x.account_id
  join public.icash_signing_envelopes e on e.id=x.envelope_id and e.account_id=x.account_id and e.deal_id=t.deal_id
  join public.icash_deal_files d on d.id=e.deal_id and d.account_id=e.account_id and d.terms=e.terms and d.stage='draft'
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id and s.state='complete'
  join icash_seller_agreement_private.confirmations c on c.envelope_id=e.id and c.account_id=e.account_id and c.deal_id=e.deal_id
  join icash_call_offer_private.offers o on o.account_id=d.account_id and o.deal_id=d.id and o.snapshot=s.snapshot
  where x.account_id=p_account and x.message_id=p_message
   and m.direction='outgoing' and m.state='ready' and m.provider_id is null and m.customer_author_id is null
   and cardinality(m.asset_ids)=0 and m.attachments='[]'::jsonb
   and m.body ~ '^Review your contract: https://docuseal[.]com/s/[A-Za-z0-9_-]+$'
   and t.party='seller' and t.retired_at is null and not t.paused and not t.manual_only and t.ai_mode='auto'
   and e.kind='purchase' and not e.test_mode and e.state='awaiting_counterparty' and nullif(e.provider_id,'') is not null
   and public.icash_signing_action_allowed(p_account,e.id)
   and jsonb_array_length(e.recipients)=2 and e.recipients->0->>'id'=x.signer_id
   and e.recipients->0->>'phone'=t.recipient and e.recipients->0->>'name'=e.terms->>'seller'
   and e.terms->>'closingDate' ~ '^\d{4}-\d{2}-\d{2}$'
   and e.terms->>'closingDate'>to_char(now() at time zone 'Pacific/Kiritimati','YYYY-MM-DD')
   and c.state='ready' and c.created_at<=now()
   and (c.terms-array['assignmentFeeCents','assignmentDepositCents'])=(e.terms-array['assignmentFeeCents','assignmentDepositCents'])
   and c.confirmation @> '{"sendTextRequested":true,"termsConfirmed":true,"priceAndDateConfirmed":true,"allDecisionMakersAgree":true,"soleOwner":true,"materialFactsChanged":false}'::jsonb
   and c.confirmation->'agreedPriceCents'=e.terms->'priceCents'
   and c.confirmation->>'sellerLegalName'=e.terms->>'seller' and c.confirmation->>'closingDate'=e.terms->>'closingDate'
   and coalesce(o.state->>'acceptedPriceCents','') ~ '^[1-9][0-9]*$'
   and o.state->'acceptedPriceCents'=e.terms->'priceCents' and o.state->'quotedPriceCents'=e.terms->'priceCents'
   and not exists(select 1 from jsonb_each(o.state) flag where flag.key in
    ('factsPending','conditionPending','agreementRevisionRequired','contractBlocked','acceptanceConditional','payoffPending') and flag.value<>'false'::jsonb)
 );
$$;
revoke all on function public.icash_confirmed_seller_contract_text_current(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_confirmed_seller_contract_text_current(uuid,uuid) to service_role;

-- Guard the installed function bodies, preserving all other current send gates,
-- locks, recipient/source checks, billing, and immutable provider operations.
do $patch$
declare original text;patched text;needle text;
begin
 select pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure) into original;
 if md5(original)<>'27d4028436b7dce126ec0482b86036dc' then raise exception 'Contract send predecessor changed';end if;
 needle:='else if not public.icash_customer_authored_text(p_account,p_message)';
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'Contract send patch target changed';end if;
 patched:=replace(original,needle,'else if not public.icash_confirmed_seller_contract_text_current(p_account,p_message) and not public.icash_customer_authored_text(p_account,p_message)');
 -- A withdrawn automatic agreement must stay blocked even when its original
 -- financial screen happens to be eligible.
 needle:=' if t.party=''buyer'' then';
 if length(patched)-length(replace(patched,needle,''))<>length(needle) then raise exception 'Contract authority patch target changed';end if;
 patched:=replace(patched,needle,$guard$
 if exists(select 1 from public.icash_contract_text_deliveries x
  join icash_seller_agreement_private.confirmations c on c.envelope_id=x.envelope_id and c.account_id=x.account_id
  join icash_call_offer_private.offers o on o.account_id=c.account_id and o.deal_id=c.deal_id
  where x.account_id=p_account and x.message_id=p_message)
  and not public.icash_confirmed_seller_contract_text_current(p_account,p_message) then return null;end if;
 if t.party='buyer' then$guard$);
 execute patched;

 select pg_get_functiondef('public.icash_claim_agreement_delivery_recovery()'::regprocedure) into original;
 if md5(original)<>'262becceba9c28a268cdfb98a098bee3' then raise exception 'Contract recovery predecessor changed';end if;
 needle:='where j.state=''queued'' and j.expires_at>now()';
 if length(original)-length(replace(original,needle,''))<>length(needle) then raise exception 'Contract recovery patch target changed';end if;
 patched:=replace(original,needle,$recovery$where (j.state='queued' or (
  j.state='needs_review' and j.result='{"sent":false,"status":"held"}'::jsonb
  and j.claimed_at<now()-interval '1 minute' and j.request_key like 'seller-confirmed:%'
  and exists(select 1 from public.icash_contract_text_deliveries x
   join public.icash_text_messages m on m.id=x.message_id and m.account_id=x.account_id and m.thread_id=x.thread_id
   join icash_seller_agreement_private.confirmations c on c.envelope_id=x.envelope_id and c.account_id=x.account_id and c.deal_id=j.deal_id
   where x.account_id=j.account_id and x.envelope_id=j.envelope_id and j.request_key='seller-confirmed:'||c.id::text
    and public.icash_confirmed_seller_contract_text_current(j.account_id,m.id)
    and not exists(select 1 from public.icash_operation_spend spend where spend.operation_key='text:'||m.id)
  ))) and j.expires_at>now()$recovery$);
 execute patched;
end $patch$;
commit;
