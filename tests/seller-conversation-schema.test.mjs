import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../config/seller-conversation-continuation.sql',import.meta.url),'utf8');
test('seller continuation is service-only invoker SQL and applies atomically',()=>{
 assert.match(sql,/^begin;/);assert.match(sql,/commit;\s*$/);assert.doesNotMatch(sql,/security\s+definer/i);
 const signatures=[...sql.matchAll(/create function public\.(\w+)\(([^)]*)\)/g)];assert.equal(signatures.length,12);
 for(const [,name] of signatures){assert.match(sql,new RegExp('revoke all on function[^;]*public\\.'+name+'\\('));assert.match(sql,new RegExp('grant execute on function[^;]*public\\.'+name+'\\([^;]*to service_role'));}
 assert.doesNotMatch(sql,/grant[^;]+to\s+(public|anon|authenticated)\b/i);
});
test('new replies require exact bound intake, tenant, identity and financially eligible context',()=>{
 for(const needle of ["t.seller_intake_id is null","t.party<>'seller'","t.paused or t.manual_only","t.ai_mode<>'auto'","t.retired_at is not null","stage='draft'","terms->>'practice'","s.result->'financialCheck'->>'status' is distinct from 'eligible'","interval '24 hours'","s.snapshot->'sellerRequest'->>'id' is distinct from t.seller_intake_id::text","icash_seller_sms_permission_current(p_account,t.id,false) is distinct from true","icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient)","icash_property_controls","icash_handoffs","icash_text_suppressions","length(coalesce(address,'')) not between 1 and 300"]){assert(sql.includes(needle),needle);}
});
test('deterministic copy has single-segment guard and never accepts model prose',()=>{
 assert.match(sql,/length\(reply\)>160/);assert(sql.includes("reply ~ '[^A-Za-z0-9 .,!?]'"));
 assert(sql.includes('reply_body:=public.icash_seller_conversation_reply(p_account,p_job)'));
 assert(sql.includes("icash_queue_text(p_account,t.id,j.id,reply_body,'{}')"));
 assert.doesNotMatch(sql,/reply_body\s*:=\s*j\.reply|icash_queue_text\([^;]*j\.reply/);
 assert(sql.includes("source.body=f->>'quote'"));assert(sql.includes("j.analysis->'humanRequested'='true'::jsonb"));
 assert(sql.includes("j.analysis->'optedOut'='true'::jsonb"));assert(sql.includes('jsonb_array_length(m.attachments)>0'));
});
test('route CAS, latest message, idempotency and caps are rechecked at dispatch',()=>{
 for(const needle of ['revision=m.route_revision','x.id is distinct from j.outgoing_id','x.created_at>=m.created_at',"j.state<>'drafted' or j.outgoing_id is not null",">=12 then return null",'icash_sms_message_route_current(p_account,p_message)',"analysis->>'conversationPolicy'='bound-seller-v1'",'m.body is not distinct from expected','icash_seller_conversation_message_current(p_account,p_message)'])assert(sql.includes(needle),needle);
});
test('existing campaign and spend delegates remain intact without historical writes',()=>{
 for(const needle of ['icash_claim_text_ai_before_campaign','icash_claim_text_before_campaign','return public.icash_claim_text_before_seller_conversation(p_account,p_message,p_sender)','result:=public.icash_claim_text_ai_before_seller_conversation(p_account,p_job)','icash_prepare_sms_inbound_reply'])assert(sql.includes(needle),needle);
 assert(sql.includes("(length(d)-length(replace(d,needle,'')))/length(needle)<>1"));
 assert.doesNotMatch(sql,/update\s+public\.icash_text_threads\s+set\s+paused\s*=\s*false|set\s+manual\s*=\s*false/i);
 assert.doesNotMatch(sql,/insert\s+into\s+public\.icash_text_messages/i);
 assert.doesNotMatch(sql,/(?:create(?: or replace)?|alter)\s+function\s+public\.icash_\w*(?:reserve|fund|provision)\w*/i);
 assert.doesNotMatch(sql,/icash_reserve_operation\s*\(|icash_claim_operation\s*\(/);
});
test('callbacks remain unbooked attention, while explicit human control is preserved',()=>{
 assert(sql.includes("k='callback' and public.icash_seller_conversation_context(t.account_id,t.id) is not null"));
 assert(sql.includes("then k:='human'"));assert(sql.includes('then k:=null'));
 assert(sql.includes('insert into public.icash_text_attention'));assert(sql.includes("quote=excluded.quote"));
 assert(sql.includes('no call is booked yet'));assert(sql.includes('make_date(date_parts[3]::integer'));
 assert(sql.includes('exception when datetime_field_overflow or invalid_datetime_format'));
 assert.doesNotMatch(sql,/insert\s+into\s+public\.icash_(live_callbacks|voice_jobs)/);
});

test('persistent callback review gates both voice paths without unholding or replacing spend',()=>{
 for(const needle of ["r.state in ('needs_review','canceled')",'p.seller_intake_id=t.seller_intake_id','icash_claim_reviewed_voice_before_seller_timing(p_job,p_offer_snapshot,p_buyer_snapshot)','icash_claim_limited_seller_before_timing(p_job,p_snapshot)',"state in ('ready','issued')","outcome='seller_callback_time_pending_review'",'icash_seller_availability_reply(t.account_id,t.id,new.body,new.created_at)'])assert(sql.includes(needle)||sql.includes(needle.replace('p.seller_intake_id=t.seller_intake_id','t.seller_intake_id=p.seller_intake_id')),needle);
 assert.doesNotMatch(sql,/set state='(?:ready|issued)'/);
});
