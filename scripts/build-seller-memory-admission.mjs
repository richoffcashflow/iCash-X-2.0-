import {readFileSync,writeFileSync} from 'node:fs';
const rows=[...JSON.parse(readFileSync(new URL('../tests/fixtures/seller-atomic-predecessors.json',import.meta.url))),...JSON.parse(readFileSync(new URL('../tests/fixtures/seller-atomic-extra-predecessors.json',import.meta.url)))];
const byName=new Map(rows.map(x=>[x.name,x]));
const changed=[];
function patch(name,edits){let s=byName.get(name).source;for(const [a,b] of edits){if(s.split(a).length!==2)throw Error(name+' anchor '+a);s=s.replace(a,b)}changed.push({name,source:s});return s+';\n'}
let sql=`-- Runner-owned transaction: exact sources, bounded locks, and ledger commit together.\nset local lock_timeout='3s';\nset local statement_timeout='15s';\nselect pg_advisory_xact_lock(726341927);\ndo $predecessors$\ndeclare e record;p record;\nbegin\n for e in select * from (values\n${rows.map(r=>` ('public.${r.signature}','${r.name==='icash_seller_memory_context'?'7a680dae86359988c3f70c705a3369b0':r.source_hash}',${r.prosecdef},'${r.provolatile}')`).join(',\n')}\n ) expected(signature,source_hash,definer,volatility) loop\n select md5(pg_get_functiondef(oid)) source_hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl into p from pg_proc where oid=to_regprocedure(e.signature);\n if p.source_hash is distinct from e.source_hash or p.owner is distinct from 'postgres' or p.prosecdef is distinct from e.definer or p.provolatile::text is distinct from e.volatility\n  or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""'] or p.acl is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Seller memory admission prerequisite changed: %',e.signature;end if;\n end loop;\nend $predecessors$;\n`;
sql+=readFileSync(new URL('../config/seller-agreement-memory-admission-body.sql',import.meta.url),'utf8');
sql+='\n'+patch('icash_defer_seller_agreement',[
 ['p_expected_terms jsonb, p_terms jsonb)','p_expected_terms jsonb, p_terms jsonb, p_memory_fingerprint text, p_call_prefix jsonb)'],
 ['claim:=public.icash_claim_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms);','claim:=public.icash_claim_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,p_memory_fingerprint,p_call_prefix);']
]);
sql+=`\ncreate or replace function public.icash_defer_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb) returns jsonb language sql security definer set search_path='' as $$ select public.icash_defer_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,null,null) $$;\ncreate function public.icash_defer_seller_agreement(p_hash text,p_conversation text,p_confirmation jsonb,p_expected_terms jsonb,p_terms jsonb,p_memory_fingerprint text) returns jsonb language sql security definer set search_path='' as $$ select public.icash_defer_seller_agreement(p_hash,p_conversation,p_confirmation,p_expected_terms,p_terms,p_memory_fingerprint,null) $$;\n`;
sql+='\n'+patch('icash_begin_signing',[
 [" select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;",` if p_kind='purchase' and icash_seller_agreement_memory_private.admit_purchase(p_account,p_deal,p_template,p_recipients) is distinct from true then raise exception 'Seller memory source changed';end if;
 select * into strict d from public.icash_deal_files where id=p_deal and account_id=p_account for update;`]
]);
sql+='\n'+patch('icash_claim_seller_text_agreement',[
 ['confirmation jsonb;new_id uuid;','confirmation jsonb;new_id uuid;memory_phone text;memory_source jsonb;'],
 [" select df.* into d from public.icash_deal_files df join public.icash_text_threads t",` select t.recipient into memory_phone from public.icash_text_threads t where t.id=j.thread_id and t.account_id=p_account;
 if public.icash_seller_memory_enabled(p_account) then
  if memory_phone is null then return null;end if;
  perform pg_advisory_xact_lock(hashtextextended(memory_phone,74));
 end if;
 select df.* into d from public.icash_deal_files df join public.icash_text_threads t`],
 [" update public.icash_deal_files df set terms=p->'terms'",` if public.icash_seller_memory_enabled(p_account) then
  memory_source:=icash_seller_agreement_memory_private.current_source(p_account,d.screening_id,memory_phone);
  if memory_source is null or memory_source->>'fingerprint' is distinct from c->>'memoryFingerprint'
   or memory_source->'binding'->>'dealId' is distinct from d.id::text then return null;end if;
 end if;
 update public.icash_deal_files df set terms=p->'terms'`],
 [" update public.icash_text_ai_jobs set state='handoff'",` if public.icash_seller_memory_enabled(p_account) and not icash_seller_agreement_memory_private.remember(new_id,
   jsonb_build_object('accountId',p_account,'dealId',d.id,'screeningId',d.screening_id,'phone',memory_phone,'callKey','sms:'||j.message_id),null,memory_source,null)
  then raise exception 'Original seller text admission changed';end if;
 update public.icash_text_ai_jobs set state='handoff'`]
]);
sql+='\n'+patch('icash_confirmed_seller_contract_text_current',[
 [' STABLE SECURITY DEFINER',' VOLATILE SECURITY DEFINER'],
 ["   and c.state='ready' and c.created_at<=now()",`   and c.state='ready' and c.created_at<=now()
   and (not public.icash_seller_memory_enabled(p_account) or icash_seller_agreement_memory_private.current(c.id))`]
]);
sql+='\n'+patch('icash_ingest_text_event_before_operational',[
 [" perform 1 from public.icash_operating_budget where id=1 for update;",` perform 1 from public.icash_operating_budget where id=1 for update;
 if typ in ('text.incoming.sms','text.incoming.mms','text.delivery.confirmed','text.delivery.failed','text.cancelled') then
  perform pg_advisory_xact_lock(hashtextextended(case when typ in ('text.incoming.sms','text.incoming.mms') then v->>'from' else v->>'to' end,74));
 end if;`]
]);
sql+='\n'+patch('icash_save_live_result',[
 ['zone text;','zone text;memory_binding jsonb;memory_phone text;'],
 [' select * into strict c from public.icash_live_conversations where id=p_call for update;',` select * into strict c from public.icash_live_conversations where id=p_call;
 if c.party='seller' and public.icash_seller_memory_enabled(c.account_id) then
  memory_binding:=jsonb_build_array(c.account_id,c.screening_id,c.contact_key);
  select min(phone) into memory_phone from (
   select t.recipient phone from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where t.account_id=c.account_id and d.screening_id=c.screening_id and t.party='seller' and t.retired_at is null and encode(sha256(convert_to(t.recipient,'UTF8')),'hex')=c.contact_key
   union select p.phone from public.icash_contact_permissions p where p.account_id=c.account_id and p.screening_id=c.screening_id and p.party='seller' and encode(sha256(convert_to(p.phone,'UTF8')),'hex')=c.contact_key
  ) phones having count(distinct phone)=1;
  if memory_phone is not null then perform pg_advisory_xact_lock(hashtextextended(memory_phone,74));end if;
 end if;
 select * into strict c from public.icash_live_conversations where id=p_call for update;
 if memory_binding is not null and memory_binding is distinct from jsonb_build_array(c.account_id,c.screening_id,c.contact_key) then raise exception 'Seller call source binding changed';end if;`]
]);
sql+='\n'+patch('icash_save_seller_history_before_viewings',[
 [" select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation and call_ended_at between now()-interval '30 days' and now();",` select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation;
 if found and public.icash_seller_memory_enabled(s.account_id) then perform pg_advisory_xact_lock(hashtextextended(s.from_phone,74));end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation and call_ended_at between now()-interval '30 days' and now();`],
 [" delete from icash_seller_agreement_private.call_history where completed_at<now()-interval '30 days';",` delete from icash_seller_agreement_private.call_history h where h.completed_at<now()-interval '30 days'
  and (not public.icash_seller_memory_enabled(h.account_id) or (public.icash_seller_memory_enabled(s.account_id)
   and h.account_id=s.account_id and h.screening_id=screen and h.contact_key=encode(sha256(convert_to(s.from_phone,'UTF8')),'hex')));`]
]);
sql+='\n'+patch('icash_save_seller_memory',[
 [' source:=public.icash_seller_memory_context(p_account,p_screening,p_phone);',` if public.icash_seller_memory_enabled(p_account) then perform pg_advisory_xact_lock(hashtextextended(p_phone,74));end if;
 source:=public.icash_seller_memory_context(p_account,p_screening,p_phone);`]
]);
sql+='\n'+patch('icash_save_seller_memory_inbound_history',[
 ['clipped jsonb;','clipped jsonb;memory_phone text;'],
 [' select * into h from icash_seller_agreement_private.call_history where session_id=p_session and conversation_id=p_conversation;',` select s.from_phone into memory_phone from icash_recorded_reception_private.sessions s where s.id=p_session and s.conversation_id=p_conversation and public.icash_seller_memory_enabled(s.account_id);
 if memory_phone is not null then perform pg_advisory_xact_lock(hashtextextended(memory_phone,74));end if;
 select * into h from icash_seller_agreement_private.call_history where session_id=p_session and conversation_id=p_conversation;`]
]);
for(const [name,condition] of [['icash_transition_recorded_reception',"p_action='call_ended'"],['icash_finish_recorded_reception_work',"p_kind='reconcile' and p_outcome='call_ended'"]]){
 sql+='\n'+patch(name,[['\nbegin\n',`\nbegin\n if ${condition} then
  perform pg_advisory_xact_lock(hashtextextended(s.from_phone,74)) from icash_recorded_reception_private.sessions s
  where s.id=p_id and s.account_id=p_account and s.operation_key=p_operation and public.icash_seller_memory_enabled(s.account_id);
 end if;\n`]]);
}
sql+='\n'+patch('icash_claim_agreement_delivery_recovery',[
 [" order by j.created_at for update of j,d skip locked limit 1;",` and (not public.icash_seller_memory_enabled(j.account_id) or j.request_key not like 'seller-confirmed:%'
  or exists(select 1 from icash_seller_agreement_private.confirmations c where c.account_id=j.account_id and c.deal_id=j.deal_id
   and j.request_key='seller-confirmed:'||c.id::text and icash_seller_agreement_memory_private.review_ready(c.id)))
 order by j.created_at for update of j,d skip locked limit 1;`],
 ["'expectedTerms',current_terms);","'expectedTerms',current_terms,'memoryReviewRequired',public.icash_seller_memory_enabled(r.account_id) and r.request_key like 'seller-confirmed:%');"]
]);
sql+=`\nrevoke all on all functions in schema icash_seller_agreement_memory_private from public,anon,authenticated,service_role;\ngrant execute on function icash_seller_agreement_memory_private.current(uuid),icash_seller_agreement_memory_private.admit_purchase(uuid,uuid,uuid,jsonb) to service_role;\nrevoke all on function public.icash_claim_seller_agreement_before_memory(text,text,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;\n`;
for(const name of ['icash_claim_seller_agreement','icash_defer_seller_agreement'])for(const suffix of ['',',text',',text,jsonb'])sql+=`revoke all on function public.${name}(text,text,jsonb,jsonb,jsonb${suffix}) from public,anon,authenticated;\ngrant execute on function public.${name}(text,text,jsonb,jsonb,jsonb${suffix}) to service_role;\n`;
for(const signature of ['icash_seller_agreement_memory_context(uuid,uuid)','icash_refresh_seller_agreement_memory(uuid,uuid,text,text,jsonb)'])sql+=`revoke all on function public.${signature} from public,anon,authenticated;\ngrant execute on function public.${signature} to service_role;\n`;
sql+=`do $unchanged$ begin if md5(pg_get_functiondef('public.icash_signing_action_allowed(uuid,uuid)'::regprocedure))<>'0c8dd6053164498e0f2e400d8e55d3b7' or md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure))<>'7a680dae86359988c3f70c705a3369b0' then raise exception 'Seller memory unrelated authority changed';end if;end $unchanged$;\n`;
const root=new URL('../',import.meta.url);writeFileSync(new URL('config/seller-agreement-memory-admission.sql',root),sql);writeFileSync(new URL('supabase/migrations/20261117032255_seller_agreement_memory_admission.sql',root),sql);
writeFileSync(new URL('tests/fixtures/seller-atomic-expected-functions.json',root),JSON.stringify(changed.map(x=>({name:x.name,source:x.source})),null,2)+'\n');
console.log(JSON.stringify({bytes:Buffer.byteLength(sql),changed:changed.map(x=>x.name)}));
