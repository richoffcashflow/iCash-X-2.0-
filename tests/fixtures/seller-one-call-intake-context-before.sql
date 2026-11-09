CREATE OR REPLACE FUNCTION public.icash_seller_context_before_viewings(p_account uuid, p_thread uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;s public.icash_screening_jobs;principal text;assistant text;address text;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.party<>'seller' or t.seller_intake_id is null or t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null then return null;end if;
 select a.assistant_name into assistant from public.icash_accounts a where a.id=p_account and not a.bot_paused;
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete';
 -- Financial holds keep their existing limited-contact policy; this is no exception.
 if not found or s.result->'financialCheck'->>'status' is distinct from 'eligible'
  or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours'
  or s.snapshot->'sellerRequest'->>'id' is distinct from t.seller_intake_id::text then return null;end if;
 if public.icash_seller_sms_permission_current(p_account,t.id,false) is distinct from true
  or public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient) is null then return null;end if;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 -- Same number-pair CAS as final dispatch; never infer another property's context.
 if not exists(select 1 from public.icash_sms_routes where sender=t.sender and recipient=t.recipient and account_id=p_account and not needs_review) then return null;end if;
 select trim(i.principal) into principal from public.icash_customer_identities i where i.account_id=p_account;
 assistant:=trim(assistant);address:=trim(d.terms->>'address');
 if length(coalesce(principal,'')) not between 1 and 100 or length(coalesce(assistant,'')) not between 1 and 60
  or length(coalesce(address,'')) not between 1 and 300 or address ~ '[[:cntrl:]]'
  or principal ~ '[[:cntrl:]]' or assistant ~ '[[:cntrl:]]' then return null;end if;
 return jsonb_build_object('sellerConversation',true,'principal',principal,'assistantName',assistant,'formContactVerified',true,
  'address',address,'timezone',t.timezone,'offerAuthorized',false);
end $function$;
