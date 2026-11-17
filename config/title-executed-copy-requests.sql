-- Runner-owned transaction. Install disabled; original messages are never replayed.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);

do $pins$
declare target record;actual text;metadata jsonb;
begin
 for target in select * from (values
  ('public.icash_claim_title_update(uuid,uuid,jsonb)','d94aecc25f32e0af51cb9325637e2d2b','v'),
  ('public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)','0f5dd97500fd3b3b096e166bd4096928','v'),
  ('public.icash_signing_action_allowed(uuid,uuid)','0c8dd6053164498e0f2e400d8e55d3b7','s'),
  ('public.icash_title_contact_matches(uuid,uuid,text)','4ca2faa138c0770ffeb5dcda10586020','s')
 ) p(signature,source_hash,volatility) loop
  select md5(pg_get_functiondef(oid)),jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatility',provolatile,'parallel',proparallel,'config',proconfig,'acl',proacl::text)
  into actual,metadata from pg_proc where oid=target.signature::regprocedure;
  if actual is distinct from target.source_hash or metadata is distinct from jsonb_build_object('owner','postgres','definer',false,'volatility',target.volatility,'parallel','u','config',array['search_path=""'],'acl','{postgres=X/postgres,service_role=X/postgres}') then raise exception 'Title copy predecessor changed: %',target.signature;end if;
 end loop;
end $pins$;

create schema icash_title_copy_private;
revoke all on schema icash_title_copy_private from public,anon,authenticated,service_role;
grant usage on schema icash_title_copy_private to service_role;
create table icash_title_copy_private.policy (
 id integer primary key check(id=1),enabled boolean not null default false,
 activated_at timestamptz,release_sha text,
 check(not enabled or (activated_at is not null and release_sha is not null and release_sha ~ '^[0-9a-f]{40}$'))
);
insert into icash_title_copy_private.policy(id) values(1);
alter table icash_title_copy_private.policy enable row level security;
revoke all on icash_title_copy_private.policy from public,anon,authenticated,service_role;

-- Every verified intake, including an old application calling the legacy RPC,
-- must serialize before its insertion can run closing/task triggers.
create function icash_title_copy_private.lock_incoming_request() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.sender_verified and new.request_id is not null then
  perform 1 from public.icash_operating_budget where id=1 for update;
  perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||new.request_id::text,0));
 end if;
 return new;
end $$;
create trigger icash_title_copy_source_lock before insert on public.icash_title_replies for each row execute function icash_title_copy_private.lock_incoming_request();
revoke all on function icash_title_copy_private.lock_incoming_request() from public,anon,authenticated,service_role;

-- Closed whole-current-message request grammar. Additional recipients, terms,
-- conditions, negations or unknown text do not become document-send authority.
create function icash_title_copy_private.requested_documents(p_text text) returns text[]
language plpgsql immutable set search_path='' as $function$
declare line text;body text:='';noun text;item text;kind text;items text[];result text[]:='{}';
begin
 if p_text is null or length(p_text)>5000 then return null;end if;
 for line in select regexp_split_to_table(replace(p_text,E'\r',''),E'\n') loop
  line:=btrim(line);
  continue when line='' or line ~* '^(hello|hi|good morning|good afternoon|good evening|thanks|thank you|regards|best regards)[,.!]?$';
  body:=body||' '||line;
 end loop;
 body:=lower(regexp_replace(btrim(body),'\s+',' ','g'));
 body:=regexp_replace(body,'[.!?]+$','');
 noun:=regexp_replace(body,'^((please )?(send|resend|provide|email)( (me|us))? |(can|could|would) you( please)? (send|resend|provide|email)( (me|us))? )','');
 if noun=body then return null;end if;
 noun:=regexp_replace(noun,'^(a copy of |copies of |the copies of )','');
 noun:=regexp_replace(noun,'^(the )?(fully )?(signed |executed )?(purchase and assignment|assignment and purchase) (agreements|contracts)$','purchase agreement and assignment agreement');
 items:=regexp_split_to_array(noun,' (and|&) |, *');
 if cardinality(items) not between 1 and 5 then return null;end if;
 foreach item in array items loop
  item:=regexp_replace(btrim(item),'^(the |a |an )','');
  item:=regexp_replace(item,'^(fully )?(executed |signed )','');
  kind:=case
   when item in ('purchase agreement','purchase contract') then 'purchase'
   when item in ('assignment agreement','assignment contract') then 'assignment'
   when item in ('payoff','payoff statement','payoff statements') then 'payoff'
   when item in ('id','identification','photo id','government id') then 'identification'
   when item in ('entity documents','company documents','company formation documents') then 'entity'
   when item in ('insurance','proof of insurance','insurance documents') then 'insurance'
   else null end;
  if kind is null or kind=any(result) then return null;end if;
  result:=array_append(result,kind);
 end loop;
 return result;
end $function$;
revoke all on function icash_title_copy_private.requested_documents(text) from public,anon,authenticated,service_role;

create function icash_title_copy_private.envelope_source(p_envelope public.icash_signing_envelopes) returns jsonb
language sql immutable set search_path='' as $function$
 select jsonb_build_object('kind',p_envelope.kind,'envelopeId',p_envelope.id,'sourceHash',
  encode(sha256(convert_to(jsonb_build_object('id',p_envelope.id,'account',p_envelope.account_id,'deal',p_envelope.deal_id,
   'kind',p_envelope.kind,'state',p_envelope.state,'testMode',p_envelope.test_mode,'provider',p_envelope.provider_id,
   'template',p_envelope.template_id,'termsHash',p_envelope.terms_hash,'terms',p_envelope.terms,'recipients',p_envelope.recipients,'createdAt',p_envelope.created_at)::text,'UTF8')),'hex'),
  'pdfSource',jsonb_build_object('id',p_envelope.id,'accountId',p_envelope.account_id,'dealId',p_envelope.deal_id,'kind',p_envelope.kind,
   'state',p_envelope.state,'testMode',p_envelope.test_mode,'providerId',p_envelope.provider_id,'templateId',p_envelope.template_id,
   'termsHash',p_envelope.terms_hash,'terms',p_envelope.terms,'recipients',p_envelope.recipients,'createdAt',p_envelope.created_at));
$function$;

-- Recomputed after PDF loading. Poll timestamps are not source revisions;
-- provider identity, frozen terms/recipients, original reply and closer are.
create function icash_title_copy_private.current_request(p_reply uuid) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare cfg icash_title_copy_private.policy;r public.icash_title_replies;j public.icash_title_requests;
 d public.icash_deal_files;c public.icash_title_contacts;e public.icash_signing_envelopes;
original_at timestamptz;signed_at timestamptz;assignment_cutoff timestamptz;revision bigint;kinds text[];requested_kind text;documents jsonb:='[]';missing text[]:='{}';source jsonb;
begin
 select * into cfg from icash_title_copy_private.policy where id=1 for share;
 if cfg.enabled is distinct from true or cfg.activated_at is null or cfg.release_sha is null then return null;end if;
 select * into r from public.icash_title_replies where id=p_reply;
 if not found or r.sender_verified is distinct from true or r.account_id is null or r.deal_id is null or r.request_id is null
  or r.original_source->>'version' is distinct from '1' or r.original_source->'bodyComplete' is distinct from 'true'::jsonb
  or r.original_source->>'bodySha256' is distinct from encode(sha256(convert_to(r.body_text,'UTF8')),'hex')
  or r.original_source->>'subjectSha256' is distinct from encode(sha256(convert_to(r.subject,'UTF8')),'hex')
  or r.original_source->>'providerEmailId' is distinct from r.provider_email_id::text
  or r.original_source->>'accountId' is distinct from r.account_id::text or r.original_source->>'dealId' is distinct from r.deal_id::text
  or r.original_source->>'requestId' is distinct from r.request_id::text or r.original_source->>'sender' is distinct from r.sender
  or coalesce(length(r.original_source->>'webhookEventId'),0) not between 1 and 200 then return null;end if;
 begin
  original_at:=(r.original_source->>'providerReceivedAt')::timestamptz;
  revision:=(r.original_source->>'revision')::bigint;
 exception when others then return null;end;
 if original_at is null or not isfinite(original_at) or revision is null or revision<=0 or r.received_at<cfg.activated_at
  or original_at<greatest(cfg.activated_at,clock_timestamp()-interval '24 hours') or original_at>clock_timestamp() then return null;end if;
 -- Every newer verified source supersedes the old request, including an
 -- incomplete/unsupported reply. Legacy messages during cutover cannot assert
 -- a trustworthy original ordering, so they require ordinary review.
 if exists(select 1 from public.icash_title_replies newer where newer.request_id=r.request_id and newer.account_id=r.account_id and newer.deal_id=r.deal_id
  and newer.sender_verified and newer.id<>r.id and (
   (newer.original_source->>'revision' ~ '^[0-9]{1,18}$' and (newer.original_source->>'revision')::bigint>revision)
   or (newer.original_source->>'providerReceivedAt')::timestamptz>=original_at
   or (not coalesce(newer.original_source->>'revision' ~ '^[0-9]{1,18}$',false) and newer.received_at>=cfg.activated_at))) then return null;end if;
 select * into j from public.icash_title_requests where id=r.request_id and account_id=r.account_id and deal_id=r.deal_id;
 if not found or j.state<>'sent' or coalesce(length(btrim(j.provider_id)),0)=0 or lower(j.recipient) is distinct from lower(r.sender) then return null;end if;
 select * into d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id;
 if not found or d.stage not in ('under_contract','buyer_selected','title_open','closing') or not public.icash_title_contact_matches(j.account_id,j.deal_id,j.recipient) then return null;end if;
 select max(completed_at) into assignment_cutoff from public.icash_agreement_cancellations
  where account_id=j.account_id and deal_id=j.deal_id and kind='assignment' and state='completed';
 if assignment_cutoff is not null and (not isfinite(assignment_cutoff) or original_at<=assignment_cutoff) then return null;end if;
 if coalesce(d.terms->>'practice','false')='true' or not exists(select 1 from public.icash_screening_jobs where id=d.screening_id and account_id=d.account_id
  and coalesce(snapshot->>'practice','false')<>'true' and coalesce(snapshot->>'propertyId','')<>'' and snapshot->>'propertyId' not like 'practice_%') then return null;end if;
 select * into c from public.icash_title_contacts where account_id=j.account_id and deal_id=j.deal_id and email=j.recipient and enabled and verified_until>now();
 if not found then return null;end if;
 if not exists(select 1 from public.icash_operation_spend where operation_key='title:'||j.id and account_id=j.account_id
  and rate_id=j.rate_id and state in ('dispatched','settled') and dispatched_at is not null
  and isfinite(dispatched_at) and dispatched_at>=j.created_at and dispatched_at<=original_at) then return null;end if;
 if not exists(select 1 from public.icash_signing_envelopes where id=j.purchase_envelope_id and account_id=j.account_id and deal_id=j.deal_id and kind='purchase' and state='completed' and not test_mode)
  or not public.icash_signing_action_allowed(j.account_id,j.purchase_envelope_id) then return null;end if;
 kinds:=icash_title_copy_private.requested_documents(r.body_text);
 if kinds is null then return null;end if;
 foreach requested_kind in array kinds loop
  if requested_kind not in ('purchase','assignment') then missing:=array_append(missing,requested_kind);continue;end if;
  if (select count(*) from public.icash_signing_envelopes where account_id=j.account_id and deal_id=j.deal_id and icash_signing_envelopes.kind=requested_kind and state='completed' and not test_mode)<>1 then missing:=array_append(missing,requested_kind);continue;end if;
  select * into e from public.icash_signing_envelopes where account_id=j.account_id and deal_id=j.deal_id and icash_signing_envelopes.kind=requested_kind and state='completed' and not test_mode;
  if coalesce(length(btrim(e.provider_id)),0)=0 or not public.icash_signing_action_allowed(j.account_id,e.id) or (requested_kind='purchase' and e.id<>j.purchase_envelope_id) then missing:=array_append(missing,requested_kind);continue;end if;
  -- A delayed old message cannot authorize a later replacement agreement. The
  -- existing verified signature observation must bind this envelope's lifetime.
  signed_at:=case when requested_kind='purchase' then d.seller_signed_at else d.assignment_signed_at end;
  if e.created_at is null or not isfinite(e.created_at) or signed_at is null or not isfinite(signed_at)
   or signed_at<e.created_at or original_at<signed_at
   or (requested_kind='assignment' and (e.terms is distinct from d.terms or (assignment_cutoff is not null and signed_at<=assignment_cutoff))) then missing:=array_append(missing,requested_kind);continue;end if;
  documents:=documents||jsonb_build_array(icash_title_copy_private.envelope_source(e)||jsonb_build_object('signedAt',signed_at));
 end loop;
 source:=jsonb_build_object('reply',r.id,'providerEmail',r.provider_email_id,'account',r.account_id,'deal',r.deal_id,'request',r.request_id,
  'sender',r.sender,'subject',r.subject,'body',r.body_text,'verified',r.sender_verified,'original',r.original_source,
  'requestSource',jsonb_build_object('id',j.id,'purchase',j.purchase_envelope_id,'recipient',j.recipient,'address',j.property_address,'provider',j.provider_id),
  'contact',to_jsonb(c),'documents',documents);
 return jsonb_build_object('replyId',r.id,'accountId',r.account_id,'dealId',r.deal_id,'requestId',r.request_id,
  'recipient',j.recipient,'providerReceivedAt',original_at,'revision',revision,'documents',documents,'missing',to_jsonb(missing),
  'sourceHash',encode(sha256(convert_to(source::text,'UTF8')),'hex'));
end $function$;

create table icash_title_copy_private.requests (
 reply_id uuid primary key references public.icash_title_replies(id),
 task_id uuid not null unique references public.icash_title_tasks(id),
 account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 request_id uuid not null references public.icash_title_requests(id),
 source jsonb not null check(jsonb_typeof(source)='object'),
 task_snapshot jsonb not null check(jsonb_typeof(task_snapshot)='object'),created_at timestamptz not null default now()
);
create index title_copy_request_original on icash_title_copy_private.requests(request_id,created_at,task_id);
alter table icash_title_copy_private.requests enable row level security;
revoke all on icash_title_copy_private.requests from public,anon,authenticated,service_role;
create function icash_title_copy_private.immutable_request() returns trigger language plpgsql set search_path='' as $function$
begin raise exception 'Original title copy source is immutable';end $function$;
create trigger title_copy_source_immutable before update or delete on icash_title_copy_private.requests for each row execute function icash_title_copy_private.immutable_request();
create trigger title_copy_source_no_truncate before truncate on icash_title_copy_private.requests for each statement execute function icash_title_copy_private.immutable_request();
revoke all on function icash_title_copy_private.envelope_source(public.icash_signing_envelopes),icash_title_copy_private.current_request(uuid),icash_title_copy_private.immutable_request() from public,anon,authenticated,service_role;

-- A known original provider receipt survives a later manual task edit. It is
-- evidence of that one dispatch, never authority to complete the edited work.
create table icash_title_copy_private.receipts (
 task_id uuid primary key references icash_title_copy_private.requests(task_id),
 account_id uuid not null references public.icash_accounts(id),
 provider_id text not null check(length(btrim(provider_id)) between 1 and 200),
 recorded_at timestamptz not null default clock_timestamp()
);
alter table icash_title_copy_private.receipts enable row level security;
revoke all on icash_title_copy_private.receipts from public,anon,authenticated,service_role;
create trigger title_copy_receipt_immutable before update or delete on icash_title_copy_private.receipts for each row execute function icash_title_copy_private.immutable_request();
create trigger title_copy_receipt_no_truncate before truncate on icash_title_copy_private.receipts for each statement execute function icash_title_copy_private.immutable_request();

-- Only a newly inserted reply's untouched generic review task may become work.
create function icash_title_copy_private.capture_request() returns trigger
language plpgsql security definer set search_path='' as $$
declare current_source jsonb;task public.icash_title_tasks;doc jsonb;prior public.icash_title_tasks;
 send_docs jsonb:='[]';links jsonb:='[]';
begin
 if not new.sender_verified or new.request_id is null then return new;end if;
 update public.icash_title_tasks t set state='cancelled',updated_at=now()
 where t.request_id=new.request_id and t.payload->>'type'='executed_copy' and t.state='scheduled'
  and t.email_state in ('waiting','issued') and not exists(select 1 from public.icash_operation_spend where operation_key='title-followup:'||t.id);
 current_source:=icash_title_copy_private.current_request(new.id);
 if current_source is null then return new;end if;
 select * into task from public.icash_title_tasks where reply_id=new.id and source_key='review:'||new.id
  and kind='reply_review' and state='needs_review' and email_state='waiting' and email_provider_id is null and payload='{}'::jsonb for update;
 if not found then return new;end if;
 if jsonb_array_length(current_source->'missing')>0 then
  update public.icash_title_tasks set label='Obtain requested title evidence: '||(select string_agg(value,', ') from jsonb_array_elements_text(current_source->'missing')) where id=task.id;
  return new;
 end if;
 for doc in select value from jsonb_array_elements(current_source->'documents') loop
  prior:=null;
  if doc->>'kind'='assignment' then
   select t.* into prior from public.icash_title_tasks t
   where t.request_id=new.request_id and t.account_id=new.account_id and t.deal_id=new.deal_id and t.kind='document_update' and t.payload=jsonb_build_object('type','assignment','envelopeId',doc->>'envelopeId')
    and (t.state in ('scheduled','needs_review') and t.email_state<>'sent'
     or exists(select 1 from public.icash_operation_spend o where o.operation_key='title-followup:'||t.id and o.account_id=new.account_id and o.dispatched_at is not null
      and (coalesce(length(btrim(t.email_provider_id)),0)=0 or t.email_state<>'sent' or o.dispatched_at>=(current_source->>'providerReceivedAt')::timestamptz)))
   order by t.created_at,t.id limit 1;
  end if;
  if prior.id is not null then
   links:=links||jsonb_build_array(jsonb_build_object('taskId',prior.id,'requestId',prior.request_id,'payload',prior.payload));
  else send_docs:=send_docs||jsonb_build_array(doc);end if;
 end loop;
 update public.icash_title_tasks set kind='document_update',state='scheduled',due_date=current_date,label='Provide requested executed agreements to title',
  payload=jsonb_build_object('type','executed_copy','replyId',new.id,'sourceHash',current_source->>'sourceHash','documents',send_docs,'linkedTasks',links),updated_at=now() where id=task.id returning * into task;
 insert into icash_title_copy_private.requests(reply_id,task_id,account_id,deal_id,request_id,source,task_snapshot)
 values(new.id,task.id,new.account_id,new.deal_id,new.request_id,current_source||jsonb_build_object('sendDocuments',send_docs,'linkedTasks',links),
  to_jsonb(task)-array['email_state','email_provider_id','email_retry_at','updated_at']);
 return new;
end $$;
create trigger zz_icash_title_copy_request after insert on public.icash_title_replies for each row execute function icash_title_copy_private.capture_request();
revoke all on function icash_title_copy_private.capture_request() from public,anon,authenticated,service_role;

create function icash_title_copy_private.dispatch_source(p_account uuid,p_task uuid,p_payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare saved icash_title_copy_private.requests;task public.icash_title_tasks;current_source jsonb;link jsonb;
begin
 select * into saved from icash_title_copy_private.requests where task_id=p_task and account_id=p_account;
 if not found then return null;end if;
 select * into task from public.icash_title_tasks where id=p_task and account_id=p_account and deal_id=saved.deal_id and request_id=saved.request_id and reply_id=saved.reply_id;
 if not found or task.kind<>'document_update' or task.state<>'scheduled' or task.email_state<>'issued' or task.email_provider_id is not null
  or to_jsonb(task)-array['email_state','email_provider_id','email_retry_at','updated_at'] is distinct from saved.task_snapshot
  or task.payload is distinct from p_payload or p_payload is distinct from jsonb_build_object('type','executed_copy','replyId',saved.reply_id,'sourceHash',saved.source->>'sourceHash','documents',saved.source->'sendDocuments','linkedTasks',saved.source->'linkedTasks') then return null;end if;
 current_source:=icash_title_copy_private.current_request(saved.reply_id);
 if current_source is null or saved.source-array['sendDocuments','linkedTasks'] is distinct from current_source then return null;end if;
 -- Preserve every uncertain earlier copy operation, even if its task was dismissed.
 if exists(select 1 from icash_title_copy_private.requests older join public.icash_title_tasks ot on ot.id=older.task_id
  join public.icash_operation_spend o on o.operation_key='title-followup:'||ot.id and o.account_id=p_account
  where older.request_id=saved.request_id and older.task_id<>task.id and o.dispatched_at is not null
   and (ot.email_state<>'sent' or coalesce(length(btrim(ot.email_provider_id)),0)=0)) then return null;end if;
 for link in select value from jsonb_array_elements(saved.source->'linkedTasks') loop
  if not exists(select 1 from public.icash_title_tasks original join public.icash_operation_spend o on o.operation_key='title-followup:'||original.id and o.account_id=p_account
   where original.id=(link->>'taskId')::uuid and original.account_id=p_account and original.deal_id=saved.deal_id and original.request_id=saved.request_id
    and original.payload=link->'payload' and original.email_state='sent' and coalesce(length(btrim(original.email_provider_id)),0)>0
    and o.dispatched_at is not null and o.state in ('dispatched','settled')) then return null;end if;
 end loop;
 return current_source||jsonb_build_object('documents',saved.source->'sendDocuments');
end $$;
revoke all on function icash_title_copy_private.dispatch_source(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function icash_title_copy_private.dispatch_source(uuid,uuid,jsonb) to service_role;

-- Before loading PDFs, settle only a request fully covered by known original
-- document receipts. It never retries the original document operation.
create function public.icash_prepare_title_copy(p_account uuid,p_task uuid,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare saved icash_title_copy_private.requests;current_source jsonb;
begin
 select * into saved from icash_title_copy_private.requests where task_id=p_task and account_id=p_account;
 if not found then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||saved.request_id::text,0));
 perform 1 from public.icash_title_tasks where id=p_task and account_id=p_account for update;
 current_source:=icash_title_copy_private.dispatch_source(p_account,p_task,p_payload);
 if current_source is null then return null;end if;
 if jsonb_array_length(current_source->'documents')=0 then
  update public.icash_title_tasks set state='done',label='Requested copies sent through original title update',updated_at=now() where id=p_task;
  update public.icash_title_replies set needs_review=false where id=saved.reply_id and account_id=p_account;
  return jsonb_build_object('status','covered_by_original_receipt');
 end if;
 return current_source||jsonb_build_object('status','ready');
end $$;

-- Preserve the entire original common claim and both existing update branches.
do $claim$
declare definition text;anchor text;
begin
 definition:=pg_get_functiondef('public.icash_claim_title_update(uuid,uuid,jsonb)'::regprocedure);
 anchor:=E' perform 1 from public.icash_operating_budget where id=1 for update;\n select * into t';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Title copy common claim changed';end if;
 definition:=replace(definition,anchor,E' perform 1 from public.icash_operating_budget where id=1 for update;\n if p_payload->>''type''=''executed_copy'' then\n  perform pg_advisory_xact_lock(hashtextextended(''icash-title-copy:''||request_id::text,0)) from public.icash_title_tasks where id=p_task and account_id=p_account;\n end if;\n select * into t');
 anchor:=' else return null;end if;';
 if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'Title copy branch changed';end if;
 definition:=replace(definition,anchor,E' elsif t.payload->>''type''=''executed_copy'' then\n  if icash_title_copy_private.dispatch_source(p_account,p_task,p_payload) is null or jsonb_array_length(p_payload->''documents'')=0 then return null;end if;\n else return null;end if;');
 execute definition;
end $claim$;

-- Store the accepted provider receipt and task completion atomically. A newer
-- source may keep its review, but cannot make this original send disappear.
create function public.icash_finish_title_copy(p_account uuid,p_task uuid,p_provider text) returns boolean
language plpgsql security definer set search_path='' as $$
declare saved icash_title_copy_private.requests;t public.icash_title_tasks;current_source jsonb;
 original_receipt icash_title_copy_private.receipts;bound boolean;unchanged boolean;
begin
 if coalesce(length(btrim(p_provider)),0) not between 1 and 200 then return false;end if;
 select * into saved from icash_title_copy_private.requests where task_id=p_task and account_id=p_account;
 if not found then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended('icash-title-copy:'||saved.request_id::text,0));
 select * into t from public.icash_title_tasks where id=p_task for update;
 if not found or not exists(select 1 from public.icash_operation_spend where operation_key='title-followup:'||p_task and account_id=p_account and dispatched_at is not null and state in ('dispatched','settled')) then return false;end if;
 select * into original_receipt from icash_title_copy_private.receipts where task_id=p_task;
 if found then return original_receipt.account_id=p_account and original_receipt.provider_id=p_provider;end if;
 bound:=t.account_id=saved.account_id and t.deal_id=saved.deal_id and t.request_id=saved.request_id and t.reply_id=saved.reply_id;
 if bound and t.email_provider_id is not null and t.email_provider_id is distinct from p_provider then return false;end if;
 insert into icash_title_copy_private.receipts(task_id,account_id,provider_id) values(p_task,p_account,p_provider);
 -- A changed association or unexpected mail state keeps the evidence private;
 -- never attach the receipt to different work or overwrite its disposition.
 if bound is not true or t.email_state not in ('dispatching','needs_review','sent') then return true;end if;
 unchanged:=to_jsonb(t)-array['email_state','email_provider_id','email_retry_at','updated_at']=saved.task_snapshot;
 update public.icash_title_tasks set email_state='sent',email_provider_id=p_provider,
  state=case when unchanged then 'done' else state end,updated_at=now() where id=t.id;
 current_source:=icash_title_copy_private.current_request(saved.reply_id);
 if unchanged and current_source is not null and saved.source-array['sendDocuments','linkedTasks']=current_source then
  update public.icash_title_replies set needs_review=false where id=saved.reply_id and account_id=p_account;
 end if;
 return true;
end $$;
revoke all on function public.icash_prepare_title_copy(uuid,uuid,jsonb),public.icash_finish_title_copy(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_prepare_title_copy(uuid,uuid,jsonb),public.icash_finish_title_copy(uuid,uuid,text) to service_role;

-- The source rewrite must preserve the exact existing claim metadata and neutral
-- recorder. A drift aborts the runner transaction, including its migration row.
do $final$
declare signature text;actual text;metadata jsonb;
begin
 for signature in select unnest(array['public.icash_claim_title_update(uuid,uuid,jsonb)','public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)']) loop
  select md5(pg_get_functiondef(oid)),jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatility',provolatile,'parallel',proparallel,'config',proconfig,'acl',proacl::text)
  into actual,metadata from pg_proc where oid=signature::regprocedure;
  if actual is distinct from (case when signature='public.icash_claim_title_update(uuid,uuid,jsonb)' then 'b5d5f5d7c15f592389db4505aa0ce343' else '0f5dd97500fd3b3b096e166bd4096928' end)
   or metadata is distinct from jsonb_build_object('owner','postgres','definer',false,'volatility','v','parallel','u','config',array['search_path=""'],'acl','{postgres=X/postgres,service_role=X/postgres}') then raise exception 'Title copy final source or metadata changed: %',signature;end if;
 end loop;
end $final$;
