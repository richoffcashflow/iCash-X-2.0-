// Actual retained SQL context readers, isolated schema and synthetic receipts.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boundedVoiceSmsContext} from '../lib/voice-sms-context.ts';
import {PGlite} from '@electric-sql/pglite';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const a=id(1),other=id(2),user=id(3),screen=id(10),deal=id(110),thread=id(210),rate=id(90),phone='+12025550123',sender='+12025550124',call='CA'+'1'.repeat(32),nonce='a'.repeat(64),binding='b'.repeat(64),token='c'.repeat(64),notice='Free Msg: Receiver 12025550123 unable to receive message - Message Blocking is active';
const pg=await PGlite.create(),q=(sql,p=[])=>pg.query(sql,p),rows=async(sql,p=[]) =>(await q(sql,p)).rows,scalar=async(sql,p=[])=>Object.values((await rows(sql,p))[0])[0];
try{
 await pg.exec(read('tests/fixtures/carrier-notice-projection-schema.sql'));
 await pg.exec(read('tests/fixtures/carrier-notice-history-schema.sql'));
 await pg.exec(read('tests/fixtures/carrier-notice-history-before.sql'));
 const foundation=read('config/carrier-text-notice-classification.sql');
 await pg.exec(foundation.slice(foundation.indexOf('create function public.icash_is_carrier_text_notice'),foundation.indexOf('create view public.icash_response_seller_gaps')));
 const signatures=['icash_inbound_property_context(text,text,text,text)','icash_reception_property_context(text,text,text)','icash_recorded_reception_context_before_buyer(uuid,text)','icash_reception_context_before_agreement(uuid,text)','icash_sms_route_review_items(uuid,integer,integer)','icash_attention_sources_before_journey(uuid)','icash_attention_sources(uuid)','icash_prioritized_work(uuid,integer)'];
 for(const sig of signatures)await pg.exec(`revoke all on function public.${sig} from public,anon,authenticated;grant execute on function public.${sig} to service_role`);
 const prior=await rows("select oid::regprocedure::text signature,pg_get_functiondef(oid) definition,prosecdef,proacl::text acl from pg_proc where oid=any($1::regprocedure[])",[signatures]);
 await q('insert into icash_accounts(id,owner_user_id) values($1,$2),($3,$3)',[a,user,other]);
 await q(`insert into icash_screening_jobs(id,account_id,state,snapshot) values($1,$2,'complete','{"propertyId":"prop_fixture"}')`,[screen,a]);
 await q(`insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,'{"address":"100 Fixture Street"}')`,[deal,a,screen]);
 await q(`insert into icash_text_threads(id,account_id,deal_id,party,recipient) values($1,$2,$3,'seller',$4)`,[thread,a,deal,phone]);
 const contact=await scalar("select encode(sha256(convert_to($1,'UTF8')),'hex')",[phone]);
 await q(`insert into icash_voice_contact_targets values($1,$2,$3,$4,'seller',$5,null,now()+interval '1 day')`,[id(91),a,screen,phone,contact]);
 await q(`insert into icash_operation_rates values($1,'incoming_call')`,[rate]);
 await q(`insert into icash_voice_configs values($1,'agent_fixture',true,now()+interval '1 day')`,[a]);
 await q(`insert into icash_live_conversations(id,account_id,screening_id,operation_key,party,conversation_id,state,contact_key,tool_token_hash,tool_expires_at,agent_id) values($1,$2,$3,$4,'seller','conv_fixture','waiting',$5,$6,now()+interval '1 hour','agent_fixture')`,[id(92),a,screen,'inbound:'+call,contact,token]);
 await q('insert into icash_inbound_voice_receipts values($1,\'conv_fixture\',$2,$3)',[call,binding,id(92)]);
 for(const op of ['inbound:'+call,'reception:'+call,'recorded:fixture'])await q(`insert into icash_operation_spend(account_id,operation_key,state,rate_id,charge_cap_cents) values($1,$2,'dispatched',$3,100)`,[a,op,rate]);
 await q(`insert into icash_reception_private.config values(1,$1,$2,true,now()-interval '1 hour',now()+interval '1 day','property_intake_v1','44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60','Synthetic context review',false,null,600,'config','agent_fixture',$3,'branch','version','profile',$4,100)`,[a,user,sender,rate]);
 await q(`insert into icash_reception_private.receipts values($1,$2,'reserved',$3,null,$4,now(),600,'config','agent_fixture',$5,'branch','version','profile',$6,100)`,[call,nonce,'reception:'+call,a,sender,rate]);
 await q(`insert into icash_recorded_reception_private.configs values($1,$2,true,now()-interval '1 hour',now()+interval '1 day','property_intake_v1','44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60','Synthetic context review')`,[id(93),user]);
 await q(`insert into icash_recorded_reception_private.sessions(id,config_id,account_id,operation_key,nonce_hash,state,consent_at,recording_sid,from_phone,call_deadline_at,rate_id,charge_cap_cents) values($1,$2,$3,'recorded:fixture',$4,'recording',now(),'REfixture',$5,now()+interval '1 hour',$6,100)`,[id(94),id(93),a,nonce,phone,rate]);
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,$3,'outgoing','delivered','Tell me about the property','outgoing_fixture',now()-interval '3 days'),($4,$2,$3,'incoming','received','This is Jane. I want to discuss the property.','human_fixture',now()-interval '2 days')`,[id(300),a,thread,id(301)]);
 for(let n=0;n<30;n++)await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,created_at) values($1,$2,$3,'incoming','received',$4,'notice_fixture',now()-interval '1 day'+$5*interval '1 second')`,[id(400+n),a,thread,notice,n]);
 await q(`insert into icash_text_messages(id,account_id,thread_id,direction,state,body,attachments,provider_id,created_at) values($1,$2,$3,'incoming','received',$4,'[{"url":"https://example.invalid/photo"}]','human_photo',now()-interval '1 hour')`,[id(440),a,thread,notice]);
 const names=()=>Promise.all([scalar('select icash_inbound_property_context($1,$2,$3,$4)',[call,'conv_fixture',binding,token]),scalar('select icash_reception_property_context($1,$2,$3)',[call,nonce,contact]),scalar('select icash_recorded_reception_context_before_buyer($1,$2)',[id(94),nonce])]);
 assert((await names()).every(x=>x.status==='matched'&&!x.returningName),'Before fix, notices fill every name-history slot');
 // Set the exact reviewed seller-conversation policy for the newer reader.
 await q(`update icash_recorded_reception_private.configs set context_policy='seller_offer_v2',context_policy_hash='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78'`);
 let history=await scalar('select icash_reception_context_before_agreement($1,$2)',[id(94),nonce]);
 assert.equal(history.smsContext.messages.length,12);assert(history.smsContext.messages.every(m=>m.body===notice));
 await q(`insert into icash_sms_routes values($1,$2,$3,7,true)`,[sender,phone,a]);
 for(let n=0;n<11;n++){
  await q(`insert into icash_text_messages(id,account_id,direction,state,body,attachments) values($1,$2,'incoming','received',$3,$4)`,[id(600+n),a,n<8?notice:n===8?'I saw '+notice+' but please call.':notice,n===10?[{url:'https://example.invalid/photo'}]:[]]);
  await q(`insert into icash_sms_route_reviews values($1,$2,$3,$4,$5,'ambiguous',now()+$6*interval '1 second',null)`,[id(600+n),n===9?other:a,sender,phone,[thread],n]);
 }
 await q(`insert into icash_text_attention(id,account_id,message_id,thread_id,screening_id,party,kind,quote,state) values($1,$2,$3,$4,$5,'seller','human',$6,'open')`,[id(700),a,id(400),thread,screen,notice]);
 await q(`insert into icash_handoffs(id,account_id,screening_id,party,summary,text_attention_id,conversation_id,closing_setup_id,portal_journey_id,state) values($1,$2,$3,'seller',$4,$5,null,null,null,'open'),($6,$2,$3,'seller','Earlier genuine request',$5,null,null,null,'open'),($7,$8,$3,'seller',$4,$5,null,null,null,'open')`,[id(701),a,screen,notice,id(700),id(702),id(703),other]);
 await q("update icash_handoffs set state='resolved' where id=$1",[id(702)]);
 await q(`insert into icash_sms_call_requests values($1,$2,$3,$4,$5,$6,now(),'needs_review')`,[id(710),a,id(400),thread,screen,deal]);
 await q(`insert into icash_screening_jobs(id,account_id,state,result,completed_at) values($1,$2,'complete','{}',now()-interval '4 days')`,[id(11),a]);
 await q(`insert into icash_deal_files(id,account_id,screening_id,terms) values($1,$2,$3,'{"address":"200 Fixture Street"}')`,[id(111),a,id(11)]);
 await q(`insert into icash_signing_envelopes(id,account_id,deal_id,kind,state,test_mode,updated_at) values($1,$2,$3,'purchase','customer_signature_needed',false,now())`,[id(720),a,id(111)]);
 assert.equal((await rows('select * from icash_prioritized_work($1,0)',[a]))[0].id,screen,'Notice-only attention incorrectly outranks older real work before patch');
 const beforeSources=await rows('select * from icash_attention_sources($1)',[a]);
 assert.deepEqual(new Set(beforeSources.map(x=>x.source_id)),new Set([id(700),id(701),id(710),id(720)]));
 const raw=await scalar(`select jsonb_build_object('messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m),'routes',(select jsonb_agg(to_jsonb(r)) from icash_sms_routes r),'reviews',(select jsonb_agg(to_jsonb(r) order by message_id) from icash_sms_route_reviews r),'handoffs',(select jsonb_agg(to_jsonb(h) order by id) from icash_handoffs h))`);
 const patch=read('config/carrier-text-notice-history.sql');assert.equal(patch,read('supabase/migrations/20261108235100_carrier_text_notice_history.sql'));await pg.exec(patch);
 await q(`update icash_recorded_reception_private.configs set context_policy='property_intake_v1',context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60'`);
 assert((await names()).every(x=>x.returningName==='Jane'),'All three original receipt-bound readers filter before their 12-row limits');
 assert.equal(await scalar('select icash_inbound_property_context($1,$2,$3,$4)',[call,'conv_fixture',binding,'d'.repeat(64)]),null,'Original receipt token remains required');
 assert.equal(await scalar('select icash_reception_property_context($1,$2,$3)',[call,'d'.repeat(64),contact]),null);
 assert.equal(await scalar('select icash_recorded_reception_context_before_buyer($1,$2)',[id(94),'d'.repeat(64)]),null);
 await q(`update icash_recorded_reception_private.configs set context_policy='seller_offer_v2',context_policy_hash='27968fe7a67beb299600ac7cc31b825d6d3f42cf4a8a7f54b53b8c4467e88b78'`);
 history=await scalar('select icash_reception_context_before_agreement($1,$2)',[id(94),nonce]);
 assert.deepEqual(history.smsContext.messages.map(m=>m.id),[id(300),id(301),id(440)]);assert.equal(boundedVoiceSmsContext(history.smsContext).messages.length,3,'Known attachment caption remains human context after SQL and TS bounds');assert.equal(await scalar('select icash_reception_context_before_agreement($1,$2)',[id(94),'d'.repeat(64)]),null);
 assert.equal((await rows('select * from icash_prioritized_work($1,0)',[a]))[0].id,id(11),'Genuine signature task outranks notice-only history after source filtering');
 const afterSources=await rows('select * from icash_attention_sources($1)',[a]);
 assert.deepEqual(afterSources,beforeSources.filter(x=>x.source_id===id(720)),'Real source version, timestamp and priority remain unchanged');
 const page=await rows('select * from icash_sms_route_review_items($1,0,1)',[a]),next=await rows('select * from icash_sms_route_review_items($1,1,1)',[a]);
 assert.equal(page[0].message_id,id(608));assert.equal(next[0].message_id,id(610));assert.equal(page[0].revision,7);assert.equal(page[0].needs_review,true);
 assert.equal(await scalar('select count(*) from icash_response_sms_route_reviews where account_id=$1',[other]),1,'Mismatched source/account stays unresolved rather than misclassified');
 assert.deepEqual((await rows('select id from icash_response_handoffs order by id')).map(x=>x.id),[id(702),id(703)],'Genuine older summary and cross-account source remain visible');
 assert.deepEqual(await scalar(`select jsonb_build_object('messages',(select jsonb_agg(to_jsonb(m) order by id) from icash_text_messages m),'routes',(select jsonb_agg(to_jsonb(r)) from icash_sms_routes r),'reviews',(select jsonb_agg(to_jsonb(r) order by message_id) from icash_sms_route_reviews r),'handoffs',(select jsonb_agg(to_jsonb(h) order by id) from icash_handoffs h))`),raw,'No source, hold, review resolution/revision or handoff is rewritten');
 for(const before of prior){const after=(await rows('select pg_get_functiondef(oid) definition,prosecdef,proacl::text acl from pg_proc where oid=$1::regprocedure',[before.signature]))[0];assert.equal(after.prosecdef,before.prosecdef);assert.equal(after.acl,before.acl);assert(after.definition.includes('icash_response_'));assert.equal(after.definition.replaceAll('public.icash_response_text_messages','public.icash_text_messages').replaceAll('public.icash_response_sms_route_reviews','public.icash_sms_route_reviews').replaceAll('public.icash_response_text_attention','public.icash_text_attention').replaceAll('public.icash_response_handoffs','public.icash_handoffs').replaceAll('public.icash_response_sms_call_requests','public.icash_sms_call_requests').replace("'attachments',m.attachments,",''),before.definition,'All source-binding/outgoing/nonce/control logic remains byte-for-byte unchanged');}
 for(const view of ['icash_response_sms_route_reviews','icash_response_handoffs']){assert.equal(await scalar('select reloptions from pg_class where oid=$1::regclass',[view]).then(x=>x.includes('security_invoker=true')),true);for(const role of ['anon','authenticated'])assert.equal(await scalar("select has_table_privilege($1,$2,'select')",[role,view]),false);assert.equal(await scalar("select has_table_privilege('service_role',$1,'select')",[view]),true);}
 console.log('PASS carrier history: four exact receipt-bound SQL readers, pre-limit context, attachment captions, nonce/permission/outgoing guards, route pagination, linked handoff attribution, notification source versions/priority, raw holds/evidence and unchanged ACL/security.');
}finally{await pg.close();}
