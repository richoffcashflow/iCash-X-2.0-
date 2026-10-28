import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {validOwnerOutreach} from '../lib/owner-outreach.ts';
import {installInterestEvidence} from './helpers/interest-evidence-fixture.mjs';
const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const sql=read('config/owner-outreach-report.sql'),owner='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
assert.equal(sql,read('supabase/migrations/20261019202647_owner_outreach_report.sql'));
const db=new PGlite();
try{
 await db.exec(`
 create role anon;create role authenticated;create role service_role;
 create schema icash_recording_private;
 create table icash_accounts(id uuid primary key,owner_user_id uuid,legal_name text,assistant_name text,bot_paused boolean default false);
 create table icash_funding_orders(account_id uuid,mode text,state text);
 create table icash_screening_jobs(id uuid primary key,account_id uuid,event_key text,snapshot jsonb,result jsonb,state text,created_at timestamptz,completed_at timestamptz);
 create table icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,channel text,contact_key text);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text,contact_key text);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,operational_contact_id uuid,permission_id uuid,provider_call_sid text,state text,created_at timestamptz);
 create table icash_operation_spend(account_id uuid,operation_key text unique,dispatched_at timestamptz);
 create table icash_call_recordings(id uuid primary key,account_id uuid,screening_id uuid,operation_key text,voice_job_id uuid,call_sid text,dial_claimed_at timestamptz);
 create table icash_live_conversations(id uuid primary key,account_id uuid,screening_id uuid,operation_key text,contact_key text,party text,conversation_id text,state text,result jsonb,created_at timestamptz,completed_at timestamptz);
 create table icash_recorded_gate_terminal_receipts(recording_id uuid primary key,account_id uuid,call_sid text,receipt jsonb);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,body text default '',provider_id text,event_id text,created_at timestamptz,last_delivery_at timestamptz);
 insert into icash_accounts select md5('a'||n)::uuid,case when n=2 then '${owner}'::uuid else md5('u'||n)::uuid end,'Account '||n,null,n=4 from generate_series(1,4) n;
 insert into icash_funding_orders values(md5('a3')::uuid,'test','paid'),(md5('a4')::uuid,'test','paid'),(md5('a4')::uuid,'live','paid');
 insert into icash_screening_jobs select md5('s'||n)::uuid,md5('a1')::uuid,'discovery:'||n,jsonb_build_object('propertyId','p'||n,'propertyType','house'),jsonb_build_object('property',jsonb_build_object('propertyId','p'||n,'address',n||' Test Street'),'financialCheck',jsonb_build_object('status','eligible')),'complete',now()-interval '4 hours',now()-interval '3 hours' from generate_series(1,30) n;
 -- Same prospect in an owner/test/mixed account: per-account isolation.
 insert into icash_screening_jobs select md5('extra'||n)::uuid,md5('a'||n)::uuid,'discovery:extra'||n,'{"propertyId":"extra","propertyType":"house"}','{"property":{"propertyId":"extra","address":"Extra Street"},"financialCheck":{"status":"eligible"}}','complete',now()-interval '4 hours',now()-interval '3 hours' from generate_series(2,4) n;
 insert into icash_screening_jobs select md5('excluded'||n)::uuid,md5('a1')::uuid,case when n=1 then 'seller:form' else 'discovery:excluded'||n end,case when n=2 then '{"sellerRequest":{}}' when n=3 then '{"practice":true}' when n=4 then '{"propertyId":"practice_demo"}' else '{}' end::jsonb,'{}','complete',case when n=5 then now()+interval '1 hour' else now()-interval '1 hour' end,now()-interval '1 hour' from generate_series(1,5) n;
 update icash_screening_jobs set result=jsonb_set(result,'{financialCheck,status}','"held"') where id=md5('s29')::uuid;
 update icash_screening_jobs set snapshot=jsonb_set(snapshot,'{propertyType}','"land"') where id=md5('s30')::uuid;
 update icash_screening_jobs set created_at=now()-interval '40 days',completed_at=now()-interval '40 days' where id in (md5('s3')::uuid,md5('s4')::uuid);
 insert into icash_operational_contacts select md5('o'||n)::uuid,md5('a1')::uuid,md5('s'||n)::uuid,'voice','key'||n from generate_series(1,9) n;
 insert into icash_voice_jobs select md5('v'||n)::uuid,md5('a1')::uuid,md5('o'||n)::uuid,null,case when n in (1,2,6,8,9) then 'CA'||n end,case when n=3 then 'held' when n=4 then 'ready' else 'dispatched' end,case when n in (2,3,4) then now()-interval '40 days' else now()-interval '2 hours' end from generate_series(1,9) n;
 insert into icash_operation_spend select md5('a1')::uuid,'voice:'||md5('v'||n)::uuid,now()-interval '1 hour' from generate_series(1,9) n;
 insert into icash_call_recordings select md5('r'||n)::uuid,md5('a1')::uuid,md5('s'||n)::uuid,'voice:'||md5('v'||n)::uuid,md5('v'||n)::uuid,'CA'||n,now()-interval '1 hour' from unnest(array[1,2,6,8,9]) n;
 insert into icash_recorded_gate_terminal_receipts values(md5('r2')::uuid,md5('a1')::uuid,'CA2','{"sid":"CA2","status":"no-answer"}');
 insert into icash_live_conversations select md5('c'||n)::uuid,md5('a1')::uuid,md5('s'||n)::uuid,'voice:'||md5('v'||n)::uuid,'key'||n,'seller',case when n=5 then null else 'conv'||n end,'complete',case when n=6 then '{"transcript":[{"role":"user","message":"Please leave a message after the beep"}],"interested":true}' when n=9 then '{"transcript":[{"role":"user","message":"Stop calling me"}],"interested":true,"optedOut":false}' else '{"transcript":[{"role":"user","message":"Yes I would consider your cash offer"}],"interested":true,"optedOut":false}' end::jsonb,now()-interval '1 hour',now()-interval '30 minutes' from unnest(array[1,5,6,7,8,9]) n;
 -- Wrong contact/source/account projections cannot become a response.
 update icash_live_conversations set contact_key='wrong-key' where id=md5('c7')::uuid;
 insert into icash_live_conversations select md5('duplicate')::uuid,account_id,screening_id,operation_key,contact_key,party,conversation_id,state,result,created_at,completed_at from icash_live_conversations where id=md5('c1')::uuid;
 insert into icash_deal_files select md5('d'||n)::uuid,md5('a1')::uuid,md5('s'||n)::uuid from generate_series(1,9) n;
 insert into icash_text_threads select md5('t'||n)::uuid,md5('a1')::uuid,md5('d'||n)::uuid,'seller' from generate_series(1,9) n;
 insert into icash_text_messages values
 (md5('m1')::uuid,md5('a1')::uuid,md5('t1')::uuid,'outgoing','delivered','Hello','sms1',null,now()-interval '40 days',now()-interval '20 minutes'),
 (md5('m2')::uuid,md5('a1')::uuid,md5('t1')::uuid,'incoming','received','Yes','reply1',null,now()-interval '15 minutes',null),
 (md5('m3')::uuid,md5('a1')::uuid,md5('t8')::uuid,'incoming','received','Stop text me',null,'event8',now()-interval '15 minutes',null),
 (md5('m4')::uuid,md5('a1')::uuid,md5('t4')::uuid,'outgoing','ready','Draft',null,null,now()-interval '40 days',null),
 (md5('m5')::uuid,md5('a1')::uuid,md5('t3')::uuid,'outgoing','needs_review','Hold',null,null,now()-interval '40 days',null),
 (md5('m6')::uuid,md5('a1')::uuid,md5('t2')::uuid,'incoming','received','Not an authenticated reply',null,null,now()-interval '10 minutes',null),
 (md5('m7')::uuid,md5('a2')::uuid,md5('t2')::uuid,'incoming','received','Wrong account','foreign',null,now()-interval '10 minutes',null),
 (md5('m8')::uuid,md5('a1')::uuid,md5('t2')::uuid,'outgoing','delivered','No receipt',null,null,now()-interval '10 minutes',null),
 (md5('m9')::uuid,md5('a1')::uuid,md5('t2')::uuid,'outgoing','accepted','Sent today','sms9',null,now()-interval '40 days',null),
 (md5('m10')::uuid,md5('a1')::uuid,md5('t2')::uuid,'outgoing','delivered','No delivery clock','sms10',null,now()-interval '10 minutes',null);
 insert into icash_operation_spend values(md5('a1')::uuid,'text:'||md5('m1')::uuid,now()-interval '25 minutes'),(md5('a1')::uuid,'text:'||md5('m9')::uuid,now()-interval '25 minutes');
 `);
 await db.exec(read('config/opportunity-engine.sql').match(/create function public\.icash_call_has_seller_response[\s\S]*?\$\$;/)[0]);
 await db.exec(read('config/seller-response-policy.sql'));await db.exec(read('config/seller-optout-base-verbs.sql'));
 await db.exec(sql);
 const filters={days:7,includeOwner:false,query:'',page:1,status:'all'};
 const report=async(p={})=>{const f={...filters,...p};const r=(await db.query('select public.icash_owner_outreach_report($1,$2,$3,$4,$5,$6) report',[owner,f.days,f.includeOwner,f.query,f.page,f.status])).rows[0].report;assert(validOwnerOutreach(r,f));return r;};
 await db.exec('grant select on all tables in schema public to service_role; grant execute on function public.icash_call_has_seller_response(jsonb) to service_role; begin read only; set local role service_role;');
 let r=await report();
 assert.equal(r.matchedCount,31);assert.equal(r.leads.length,25);
 assert.deepEqual(r.totals,{researched:29,eligible:27,accounts:1,calls:5,conversations:4,callResponses:3,unanswered:1,busy:0,failed:0,textsAccepted:2,textsDelivered:1,textReplies:2,respondedProperties:3,interestedProperties:1,queuedCalls:1,queuedTexts:1,heldCalls:1,heldTexts:1});
 assert.equal(r.leads[0].address,'1 Test Street','Interest ranks ahead of newer nonresponses; multiple projections count once');
 assert.equal(r.leads.find(l=>l.address==='8 Test Street').interested,false,'An SMS opt-out cannot remain an interested seller');
 assert.equal(r.leads.find(l=>l.address==='9 Test Street').optedOut,true,'Direct call stop text overrides a contradictory AI interest flag');
 assert.equal((await report({status:'responded'})).matchedCount,3);
 assert.equal((await report({status:'interested'})).matchedCount,1);
 assert.equal((await report({status:'held'})).matchedCount,1,'Old current holds remain inspectable');
 assert.equal((await report({status:'queued'})).matchedCount,1,'Old current queues remain inspectable');
 assert.equal((await report({page:2})).leads.length,6);assert.equal((await report({page:3})).leads.length,0);
 assert.equal((await report({query:'1 Test Street'})).matchedCount,3);
 assert.equal((await report({query:'%_'})).matchedCount,0,'Search characters are literal, not LIKE wildcards');
 assert.deepEqual((await report({query:'no match'})).totals,r.totals,'List filters do not change totals');
 assert.equal((await report({includeOwner:true})).matchedCount,32,'Only owner is added; test-only accounts stay excluded');
 await db.exec('commit');
 for(const values of [[null,7,false,'',1,'all'],[owner,2,false,'',1,'all'],[owner,7,false,'',0,'all'],[owner,7,false,'',1,'invalid']])await assert.rejects(()=>db.query('select public.icash_owner_outreach_report($1,$2,$3,$4,$5,$6)',values));
 const acl=(await db.query(`select has_function_privilege('anon','public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)','execute') anon,has_function_privilege('authenticated','public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)','execute') authenticated,has_function_privilege('service_role','public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)','execute') service,provolatile,prosecdef from pg_proc where oid='public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'::regprocedure`)).rows[0];
 assert.deepEqual(acl,{anon:false,authenticated:false,service:true,provolatile:'s',prosecdef:false});
 // Apply the full new migration against the exact deployed readers, then
 // exercise source-only call interest and receipt-bound SMS report counting.
 await installInterestEvidence(db);
 await db.exec(`
 update icash_live_conversations set result='{"interested":false,"transcript":[{"role":"agent","message":"Would you be interested in selling?"},{"role":"user","message":"Yes."}]}' where id=md5('c1')::uuid;
 delete from icash_live_conversations where id=md5('duplicate')::uuid;
 insert into icash_sms_seller_openings values(md5('a1')::uuid,md5('t2')::uuid,md5('interest-question')::uuid);
 insert into icash_text_messages(id,account_id,thread_id,direction,state,body,provider_id,event_id,created_at,last_delivery_at) values
 (md5('interest-question')::uuid,md5('a1')::uuid,md5('t2')::uuid,'outgoing','delivered','Are you interested in selling?','interest-question',null,now()-interval '5 minutes',now()-interval '4 minutes'),
 (md5('interest-reply')::uuid,md5('a1')::uuid,md5('t2')::uuid,'incoming','received','Yes',null,'interest-reply',now()-interval '3 minutes',null);
 `);
 r=await report();assert.equal(r.totals.interestedProperties,2);
 assert.equal((await report({status:'interested'})).matchedCount,2);
 await db.exec("update icash_text_messages set account_id=md5('a2')::uuid where id=md5('interest-reply')::uuid");
 assert.equal((await report()).totals.interestedProperties,1,'Foreign-account SMS cannot label interest');
 await db.exec("update icash_text_messages set account_id=md5('a1')::uuid,body='STOP' where id=md5('interest-reply')::uuid");
 assert.equal((await report()).totals.interestedProperties,1,'Opt-out cannot count as SMS interest');
 console.log('PASS owner outreach database: actual receipts, response/interest/opt-out semantics, dispatch versus draft dates, source/tenant bindings, owner/test exclusion, current queues, filtering before pagination, read-only execution and private ACL.');
}finally{await db.close();}
