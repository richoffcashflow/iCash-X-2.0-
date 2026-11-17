-- The runner owns the transaction and migration receipt. No historical reply,
-- milestone, agreement, deposit or manual control is rewritten.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $predecessors$
declare f record;p record;
begin
 for f in select * from (values
  ('public.icash_auto_title_confirmation()','c047ed3e8eca8091be628e6de5bf7508','v',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text)','2e15ff5ca09613f4db076c26d6a576ae','v',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_confirm_closing_before_cancellation(uuid,uuid,uuid,uuid,text,date,bigint,text)','37914a566ab9f442469e4e075922285d','v',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_confirm_closing_before_disbursement(uuid,uuid,uuid,uuid,text,date,bigint,text)','09b608e1b1e42639cc305d06f5ce1dfb','v',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_reserve_from_closing_deposit()','7ef81f77b8ede26fdca7bd89562f50d7','v',true,'{postgres=X/postgres}'),
  ('public.icash_learning_signature_verified(public.icash_signing_envelopes)','1305c4ed007f2fe60cb0b35a26fd1c1d','i',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_buyer_is_reserved(uuid,uuid)','5d65d8a537b4bcf62432253e4f7467dc','s',false,'{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)','0f5dd97500fd3b3b096e166bd4096928','v',false,'{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,source_hash,volatility,definer,acl) loop
  select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl into p
   from pg_proc where oid=to_regprocedure(f.signature);
  if p.source_hash is distinct from f.source_hash then raise exception 'Closing source predecessor changed: %',f.signature;end if;
  if p.owner is distinct from 'postgres' or p.prosecdef is distinct from f.definer or p.provolatile::text is distinct from f.volatility
   or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""'] or p.acl is distinct from f.acl then
   raise exception 'Closing source metadata changed: %',f.signature;
  end if;
 end loop;
 if not exists(select 1 from pg_attribute where attrelid='public.icash_title_replies'::regclass and attname='original_source' and atttypid='jsonb'::regtype and not attisdropped)
  or to_regprocedure('public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)') is null then raise exception 'Original title source foundation required';end if;
end $predecessors$;

-- Null means historical/unbound, never an inferred current-buyer association.
alter table public.icash_closing_updates add column agreement_envelope_id uuid references public.icash_signing_envelopes(id);
grant update(agreement_envelope_id) on public.icash_closing_updates to service_role;
create schema icash_closing_source_private;
revoke all on schema icash_closing_source_private from public,anon,authenticated;
grant usage on schema icash_closing_source_private to service_role;

create function icash_closing_source_private.parse_confirmation(p_body text) returns text[]
language plpgsql immutable security invoker set search_path='' as $$
declare fields text[];body text:=replace(btrim(p_body),E'\r','');
begin
 -- The entire complete current message must match. No quoted-history extraction,
 -- ignored suffix, duplicate line or optional free-form agreement identifier.
 fields:=regexp_match(body,E'^ICASH CONFIRMATION\nStatus: (title_opened|deposit_received|closing_scheduled|closed|funds_disbursed)\nDate: ([0-9]{4}-[0-9]{2}-[0-9]{2}|none)\nAmount cents: ([0-9]{1,15}|none)\nFile: ([^\n]{1,120})\nAgreement: ([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\nEND ICASH CONFIRMATION$');
 if fields is null then
  fields:=regexp_match(body,E'^ICASH CONFIRMATION\nStatus: (title_opened|deposit_received|closing_scheduled|closed|funds_disbursed)\nDate: ([0-9]{4}-[0-9]{2}-[0-9]{2}|none)\nAmount cents: ([0-9]{1,15}|none)\nFile: ([^\n]{1,120})\nEND ICASH CONFIRMATION$');
 end if;
 return fields;
end $$;

create function icash_closing_source_private.lock_confirmation_insert() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 -- BEFORE insertion must acquire the shared budget before FK checks take a deal
 -- key-share lock. Otherwise cancellation's budget -> deal ordering can invert
 -- with the AFTER confirmation trigger's deal FK -> budget ordering.
 if new.sender_verified and new.deal_id is not null
  and icash_closing_source_private.parse_confirmation(new.body_text) is not null then
  perform 1 from public.icash_operating_budget where id=1 for update;
 end if;
 return new;
end $$;
create trigger icash_closing_source_insert_lock before insert on public.icash_title_replies
 for each row execute function icash_closing_source_private.lock_confirmation_insert();

create function icash_closing_source_private.check_confirmation(p_account uuid,p_deal uuid,p_reply uuid,p_kind text,p_date date,p_agreement uuid,p_automatic boolean) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare d public.icash_deal_files;r public.icash_title_replies;purchase public.icash_signing_envelopes;assignment public.icash_signing_envelopes;
 source jsonb;source_at timestamptz;cutoff timestamptz;bound uuid;bound_at timestamptz;replacement boolean;source_valid boolean:=false;total_assignments bigint;completed_assignments bigint;
begin
 -- Same order as cancellation and final closing admission. A replacement cannot
 -- change between source validation and the delegate's milestone write.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found or d.stage in ('draft','cancellation_pending','cancelled') or exists(select 1 from public.icash_agreement_cancellations
  where account_id=p_account and deal_id=p_deal and (state='pending' or late_activity)) then return jsonb_build_object('ok',false,'reason','current_deal_required');end if;
 select * into r from public.icash_title_replies where id=p_reply and account_id=p_account and deal_id=p_deal and sender_verified for share;
 if not found then return jsonb_build_object('ok',false,'reason','verified_original_reply_required');end if;
 if not exists(select 1 from public.icash_title_contacts where account_id=p_account and deal_id=p_deal and enabled and verified_until>now() and lower(email)=lower(r.sender)) then
  return jsonb_build_object('ok',false,'reason','current_closer_required');end if;
 select * into purchase from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode for share;
 if not found or (select count(*) from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='purchase' and state='completed' and not test_mode)<>1
  or not public.icash_learning_signature_verified(purchase) then return jsonb_build_object('ok',false,'reason','verified_current_purchase_required');end if;
 select count(*),count(*) filter(where state='completed') into total_assignments,completed_assignments from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='assignment' and not test_mode;
 select max(completed_at) into cutoff from public.icash_agreement_cancellations where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed';
 replacement:=total_assignments>1 or cutoff is not null;
 if completed_assignments=1 then
  select * into assignment from public.icash_signing_envelopes where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed' and not test_mode for share;
  if assignment.terms is distinct from d.terms or not public.icash_learning_signature_verified(assignment) then
   return jsonb_build_object('ok',false,'reason','verified_current_assignment_required');end if;
 elsif completed_assignments>1 or p_kind in ('deposit_received','closed','funds_disbursed') or replacement then
  return jsonb_build_object('ok',false,'reason','verified_current_assignment_required');
 end if;
 bound:=case when assignment.id is not null and p_kind<>'title_opened' then assignment.id else purchase.id end;
 -- Provider evidence proves signature identity/state, but the current stored
 -- projection has no authoritative provider completion timestamp. Use the
 -- verified-signing observation, never draft creation, as the conservative
 -- chronology boundary. A missing/old observation requires explicit review.
 if d.seller_signed_at is null or not isfinite(d.seller_signed_at) or d.seller_signed_at<purchase.created_at or d.seller_signed_at>now() then
  return jsonb_build_object('ok',false,'reason','purchase_signature_time_required');end if;
 if assignment.id is not null and (d.assignment_signed_at is null or not isfinite(d.assignment_signed_at)
  or d.assignment_signed_at<assignment.created_at or d.assignment_signed_at>now() or (cutoff is not null and d.assignment_signed_at<=cutoff)) then
  return jsonb_build_object('ok',false,'reason','assignment_signature_time_required');end if;
 bound_at:=case when bound=assignment.id then d.assignment_signed_at else d.seller_signed_at end;
 if p_agreement is not null then
  -- Instructions identify the attached assignment when present, otherwise purchase.
  if p_agreement is distinct from coalesce(assignment.id,purchase.id) then return jsonb_build_object('ok',false,'reason','agreement_reference_mismatch');end if;
 end if;
 if replacement and p_automatic and p_agreement is distinct from assignment.id then return jsonb_build_object('ok',false,'reason','current_assignment_reference_required');end if;
 source:=r.original_source;
 if source->'version'='1'::jsonb and source->'bodyComplete'='true'::jsonb and source->>'revision' ~ '^[1-9][0-9]*$'
  and source->>'providerEmailId'=r.provider_email_id::text and source->>'accountId'=r.account_id::text and source->>'dealId'=r.deal_id::text
  and source->'requestId' is not distinct from coalesce(to_jsonb(r.request_id),'null'::jsonb) and source->>'sender'=r.sender
  and source->>'subjectSha256'=encode(sha256(convert_to(r.subject,'UTF8')),'hex')
  and source->>'bodySha256'=encode(sha256(convert_to(r.body_text,'UTF8')),'hex')
  and length(source->>'webhookEventId') between 1 and 200
  and source->>'providerReceivedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.[0-9]{1,9})?(Z|[+-]\d{2}:\d{2})$' then
  begin source_at:=(source->>'providerReceivedAt')::timestamptz;source_valid:=isfinite(source_at) and source_at<=r.received_at and source_at<=clock_timestamp();
  exception when others then source_valid:=false;end;
 end if;
 if not source_valid and (p_automatic or replacement or source<>'{}'::jsonb) then return jsonb_build_object('ok',false,'reason','complete_original_source_required');end if;
 if p_automatic and not exists(select 1 from public.icash_title_requests t join public.icash_operation_spend o
  on o.operation_key='title:'||t.id and o.account_id=t.account_id and o.rate_id=t.rate_id
  where t.id=r.request_id and t.account_id=p_account and t.deal_id=p_deal and lower(t.recipient)=lower(r.sender)
  and t.purchase_envelope_id=purchase.id and t.state='sent' and nullif(btrim(t.provider_id),'') is not null
  and o.dispatched_at is not null and isfinite(o.dispatched_at) and o.dispatched_at>=t.created_at and o.dispatched_at<=source_at) then
  return jsonb_build_object('ok',false,'reason','original_title_delivery_required');end if;
 if source_valid and (source_at<bound_at or source_at<d.seller_signed_at or (p_agreement=assignment.id and source_at<d.assignment_signed_at) or (cutoff is not null and source_at<=cutoff)) then
  return jsonb_build_object('ok',false,'reason','original_source_precedes_current_agreement');end if;
 if bound_at is null or bound_at>now() or (p_date is not null and p_date<(bound_at at time zone 'America/Chicago')::date) then
  return jsonb_build_object('ok',false,'reason','milestone_date_precedes_current_agreement');end if;
 if source_valid and p_kind in ('deposit_received','closed','funds_disbursed') and p_date>(source_at at time zone 'America/Chicago')::date then
  return jsonb_build_object('ok',false,'reason','milestone_after_original_source');end if;
 if p_kind='closed' and replacement and not public.icash_buyer_is_reserved(p_account,p_deal) then return jsonb_build_object('ok',false,'reason','current_buyer_deposit_required');end if;
 if p_kind='funds_disbursed' and not exists(select 1 from public.icash_closing_updates u where u.account_id=p_account and u.deal_id=p_deal and u.kind='closed'
  and (u.agreement_envelope_id=assignment.id or (not replacement and u.agreement_envelope_id is null)) and u.effective_date<=p_date) then
  return jsonb_build_object('ok',false,'reason','current_agreement_closing_required');end if;
 return jsonb_build_object('ok',true,'agreementId',bound);
end $$;

create function icash_closing_source_private.review_reply(p_reply public.icash_title_replies,p_reason text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 insert into public.icash_title_tasks(account_id,deal_id,request_id,reply_id,source_key,kind,label,state,evidence,payload)
 values(p_reply.account_id,p_reply.deal_id,p_reply.request_id,p_reply.id,'closing-source:'||p_reply.id,'reply_review','Verify title update for the current agreement','needs_review',
  'The original email did not establish this milestone for the current agreement. Review its original date and agreement reference; no closing or funds status was changed.',jsonb_build_object('closingSourceReason',p_reason))
 on conflict(source_key) do nothing;
end $$;

create or replace function public.icash_confirm_closing_update(p_account uuid,p_actor uuid,p_deal uuid,p_reply uuid,p_kind text,p_date date default null,p_amount bigint default null,p_file text default '') returns uuid language plpgsql set search_path='' as $$
declare d public.icash_deal_files;cutoff timestamptz;old public.icash_closing_updates;checked jsonb;fields text[];result_id uuid;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then raise exception 'Account owner required';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 -- A true replay observes the same historical fact. It does not rebind that fact
 -- to a replacement buyer or use it to write another milestone.
 select * into old from public.icash_closing_updates where account_id=p_account and deal_id=p_deal and reply_id=p_reply and kind=p_kind;
 if found then
  if row(old.effective_date,old.amount_cents,old.file_reference) is distinct from row(p_date,p_amount,coalesce(p_file,'')) then raise exception 'Conflicting confirmation';end if;
  return old.id;
 end if;
 if d.stage in ('cancellation_pending','cancelled') then raise exception 'Resolve cancellation before closing updates';end if;
 select max(completed_at) into cutoff from public.icash_agreement_cancellations where account_id=p_account and deal_id=p_deal and kind='assignment' and state='completed';
 if cutoff is not null then
  if not exists(select 1 from public.icash_title_replies where id=p_reply and account_id=p_account and deal_id=p_deal and received_at>cutoff) then raise exception 'A new closing confirmation is required for the replacement buyer';end if;
  if p_kind='closed' and not public.icash_buyer_is_reserved(p_account,p_deal) then raise exception 'Confirm the current buyer deposit first';end if;
 end if;
 select icash_closing_source_private.parse_confirmation(body_text) into fields from public.icash_title_replies where id=p_reply and account_id=p_account and deal_id=p_deal;
 checked:=icash_closing_source_private.check_confirmation(p_account,p_deal,p_reply,p_kind,p_date,fields[5]::uuid,false);
 if checked->'ok' is distinct from 'true'::jsonb then raise exception 'Original current-agreement confirmation required: %',checked->>'reason';end if;
 result_id:=public.icash_confirm_closing_before_cancellation(p_account,p_actor,p_deal,p_reply,p_kind,p_date,p_amount,p_file);
 update public.icash_closing_updates set agreement_envelope_id=(checked->>'agreementId')::uuid where id=result_id and account_id=p_account and deal_id=p_deal and agreement_envelope_id is null;
 return result_id;
end $$;

create or replace function public.icash_auto_title_confirmation() returns trigger language plpgsql set search_path='' as $$
declare fields text[];owner_id uuid;result_id uuid;checked jsonb;
begin
 if not new.sender_verified or new.deal_id is null then return new;end if;
 fields:=icash_closing_source_private.parse_confirmation(new.body_text);
 if fields is null then
  if ltrim(new.body_text) like 'ICASH CONFIRMATION%' then perform icash_closing_source_private.review_reply(new,'exact_current_confirmation_format_required');end if;
  return new;
 end if;
 select owner_user_id into owner_id from public.icash_accounts where id=new.account_id;
 begin
  checked:=icash_closing_source_private.check_confirmation(new.account_id,new.deal_id,new.id,fields[1],nullif(fields[2],'none')::date,fields[5]::uuid,true);
  if checked->'ok' is distinct from 'true'::jsonb then perform icash_closing_source_private.review_reply(new,checked->>'reason');return new;end if;
  result_id:=public.icash_confirm_closing_update(new.account_id,owner_id,new.deal_id,new.id,fields[1],nullif(fields[2],'none')::date,nullif(fields[3],'none')::bigint,fields[4]);
  update public.icash_closing_updates set confirmed_by=null,confirmation_source='verified_title_format' where id=result_id;
 exception when others then
  -- Original ingestion succeeds, with a specific review. Never retry the source
  -- or manufacture a missing prerequisite after an out-of-order arrival.
  perform icash_closing_source_private.review_reply(new,'current_milestone_prerequisite_required');
 end;
 return new;
end $$;

revoke all on function icash_closing_source_private.parse_confirmation(text),icash_closing_source_private.check_confirmation(uuid,uuid,uuid,text,date,uuid,boolean),icash_closing_source_private.review_reply(public.icash_title_replies,text) from public,anon,authenticated;
grant execute on function icash_closing_source_private.parse_confirmation(text),icash_closing_source_private.check_confirmation(uuid,uuid,uuid,text,date,uuid,boolean),icash_closing_source_private.review_reply(public.icash_title_replies,text) to service_role;
revoke all on function icash_closing_source_private.lock_confirmation_insert() from public,anon,authenticated,service_role;

do $result$
declare f record;p record;
begin
 for f in select * from (values
  ('public.icash_auto_title_confirmation()','63236507bde755f228f0a444eab2d7ef','v','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text)','428f8db977f64099fd46829983ca2098','v','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)','0f5dd97500fd3b3b096e166bd4096928','v','{postgres=X/postgres,service_role=X/postgres}'),
  ('icash_closing_source_private.check_confirmation(uuid,uuid,uuid,text,date,uuid,boolean)','1778c902d0d17ff78a3034917425e593','v','{postgres=X/postgres,service_role=X/postgres}'),
  ('icash_closing_source_private.lock_confirmation_insert()','8ebc103ac3835db4a458705378b45752','v','{postgres=X/postgres}'),
  ('icash_closing_source_private.parse_confirmation(text)','aeabc2cbf54cb3eb168edaf650658d20','i','{postgres=X/postgres,service_role=X/postgres}'),
  ('icash_closing_source_private.review_reply(public.icash_title_replies,text)','59e2cbc135a25692e0872c800bb1ca15','v','{postgres=X/postgres,service_role=X/postgres}')
 ) expected(signature,source_hash,volatility,acl) loop
  select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl into p
   from pg_proc where oid=to_regprocedure(f.signature);
  if p.source_hash is distinct from f.source_hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from false
   or p.provolatile::text is distinct from f.volatility or p.proparallel is distinct from 'u'
   or p.proconfig is distinct from array['search_path=""'] or p.acl is distinct from f.acl then
   raise exception 'Closing source result or metadata changed: %',f.signature;
  end if;
 end loop;
end $result$;
