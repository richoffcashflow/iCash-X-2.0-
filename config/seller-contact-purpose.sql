-- Forward-only copy/routing correction. Existing cutovers, contact/financial
-- admission, original messages, policies and delivery evidence stay unchanged.
set local lock_timeout='2s';
set local statement_timeout='8s';
do $guard$
declare item record;actual jsonb;
begin
 for item in select * from (values
   ('icash_seller_conversion_intent(text)','1f436e2035aa1663882c01c18d14ef99','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_body"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"i","securityDefiner":false,"defaultArguments":0}'::jsonb),
   ('icash_seller_response_disposition(text)','8e47d476f60a9e74fa6f2a6c460efdb8','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_body"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"i","securityDefiner":false,"defaultArguments":0}'::jsonb),
   ('icash_seller_reply_before_viewings(uuid,uuid)','3e16666207f75428a6357ff65c514f46','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_account","p_job"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"v","securityDefiner":false,"defaultArguments":0}'::jsonb),
   ('icash_seller_conversation_reply(uuid,uuid)','1d658835fae37b6accb8fbe7bd1db2be','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_account","p_job"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"v","securityDefiner":false,"defaultArguments":0}'::jsonb)
 ) pins(signature,source_hash,metadata) loop
  if md5(pg_get_functiondef(to_regprocedure('public.'||item.signature))) is distinct from item.source_hash then raise exception 'Seller purpose prerequisite changed: %',item.signature;end if;
  select jsonb_build_object('owner',r.rolname,'acl',p.proacl,'kind',p.prokind,'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'settings',p.proconfig,'argnames',p.proargnames,'argmodes',p.proargmodes,'returns',pg_get_function_result(p.oid),'defaultArguments',p.pronargdefaults) into actual from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('public.'||item.signature);
  if actual is distinct from item.metadata then raise exception 'Seller purpose metadata changed: %',item.signature;end if;
 end loop;
end $guard$;
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_seller_conversion_intent(text)'::regprocedure);
 needle:=$needle$ identity_question:=b ~ $pattern$$needle$;
 replacement:=$replacement$ if length(b)<=300 and b ~ $purpose$^(?:(?:um|uh|hmm|well)[,. -]+)*(?:(?:hi|hello|hey|yes|yeah|yep|sure|okay|ok|correct|right|absolutely)[,! .]+)?(?:how (?:can|may) i help(?: you)?(?: today)?|(?:can|may) i help you(?: today)?|what can i do for you|what (?:is|was) this (?:for|about|regarding)|what(?:'s|s) this (?:for|about|regarding)|what are you (?:calling|texting) (?:for|about)|why (?:are you|did you) (?:calling|texting|call|text)(?: me)?|what do you want)(?: please)?[?! .]*$$purpose$ then return 'purpose';end if;
 identity_question:=b ~ $pattern$$replacement$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller purpose intent boundary changed';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.icash_seller_reply_before_viewings(uuid,uuid)'::regprocedure);
 needle:=$needle$ elsif a='reply_identity' then
$needle$;
 replacement:=$replacement$ elsif a='reply_identity' and public.icash_seller_conversion_source(p_account,m.id) and public.icash_seller_conversion_intent(m.body)='purpose' then
  -- This informational fallback has no document-stage authority. Existing
  -- purchase documents keep their original agreement/signature workflow.
  if exists(select 1 from public.icash_signing_envelopes e where e.account_id=p_account and e.deal_id=t.deal_id and e.kind='purchase' and not e.test_mode)
   or exists(select 1 from public.icash_text_ai_jobs prior where prior.account_id=p_account and prior.thread_id=t.id and prior.message_id<>m.id and prior.analysis->'offerState'->>'acceptedPriceCents' is not null) then return null;end if;
  reply:=case when exists(select 1 from public.icash_text_messages sent
   where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing' and sent.state='delivered' and sent.provider_id is not null and sent.customer_author_id is null and sent.created_at<m.created_at
   and sent.body in ('I am the AI assistant for '||(ctx->>'principal')||'. Would you consider selling the property for all cash?',
    'I am the AI assistant for '||(ctx->>'principal')||'. We are discussing a possible all-cash purchase of the property.',
    'I am the AI assistant for '||(ctx->>'principal')||'. We are confirming the details for the proposed purchase agreement.',
    'I am the AI assistant for '||(ctx->>'principal')||'. I am reaching out about a possible all cash purchase of the property.',
    'I am the AI assistant for '||(ctx->>'principal')||'. Are you the owner of this property?',
    'I''m the AI assistant for '||(ctx->>'principal')||'. Would you consider selling the property for all cash?',
    'I''m the AI assistant for '||(ctx->>'principal')||'. We are discussing a possible all-cash purchase of the property.',
    'I''m the AI assistant for '||(ctx->>'principal')||'. We are confirming the details for the proposed purchase agreement.',
    'I''m the AI assistant for '||(ctx->>'principal')||'. I am reaching out about a possible all cash purchase of the property.',
    'I''m the AI assistant for '||(ctx->>'principal')||'. Are you the owner of this property?'))
   then '' else 'I am the AI assistant for '||(ctx->>'principal')||'. ' end||'I am reaching out about a possible all cash purchase of the property.';
 elsif a='reply_identity' then
$replacement$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Seller purpose reply boundary changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
do $verify$
declare item record;actual jsonb;
begin
 for item in select * from (values
   ('icash_seller_conversion_intent(text)','9b9870aaa1cac692f8458493e0dd6690','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_body"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"i","securityDefiner":false,"defaultArguments":0}'::jsonb),
   ('icash_seller_response_disposition(text)','8e47d476f60a9e74fa6f2a6c460efdb8','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_body"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"i","securityDefiner":false,"defaultArguments":0}'::jsonb),
   ('icash_seller_reply_before_viewings(uuid,uuid)','9418e608d2d0c53c7bc6caa1531067f5','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_account","p_job"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"v","securityDefiner":false,"defaultArguments":0}'::jsonb),
   ('icash_seller_conversation_reply(uuid,uuid)','1d658835fae37b6accb8fbe7bd1db2be','{"acl":["postgres=X/postgres","service_role=X/postgres"],"kind":"f","owner":"postgres","strict":false,"returns":"text","argmodes":null,"argnames":["p_account","p_job"],"language":"plpgsql","parallel":"u","settings":["search_path=\"\""],"leakproof":false,"volatility":"v","securityDefiner":false,"defaultArguments":0}'::jsonb)
 ) pins(signature,source_hash,metadata) loop
  if md5(pg_get_functiondef(to_regprocedure('public.'||item.signature))) is distinct from item.source_hash then raise exception 'Seller purpose result changed: %',item.signature;end if;
  select jsonb_build_object('owner',r.rolname,'acl',p.proacl,'kind',p.prokind,'language',l.lanname,'securityDefiner',p.prosecdef,'volatility',p.provolatile,'parallel',p.proparallel,'strict',p.proisstrict,'leakproof',p.proleakproof,'settings',p.proconfig,'argnames',p.proargnames,'argmodes',p.proargmodes,'returns',pg_get_function_result(p.oid),'defaultArguments',p.pronargdefaults) into actual from pg_proc p join pg_roles r on r.oid=p.proowner join pg_language l on l.oid=p.prolang where p.oid=to_regprocedure('public.'||item.signature);
  if actual is distinct from item.metadata then raise exception 'Seller purpose result metadata changed: %',item.signature;end if;
 end loop;
end $verify$;
