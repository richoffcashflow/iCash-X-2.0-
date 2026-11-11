import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {novemberBusinessPhones} from '../../lib/business-phone-policy.ts';
export async function testNovemberNumbers(f){
 const {db,q,one,sender,sms,manual,thread,account,screen,recipient,admit,manualAdmit}=f;
 const ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32);
 await db.exec(`alter table icash_screening_jobs add state text default 'complete',add result jsonb default '{}';
  create schema icash_recorded_reception_private;
  create table icash_recorded_reception_private.configs(called_number text,callback_template_id uuid,provider_account_sid text);
  create function icash_callback_private.manual_seller_source(uuid,uuid,text) returns boolean language sql as $$
   select exists(select 1 from public.manual_contacts where account_id=$1 and screening_id=$2 and phone=$3 and not blocked)$$;`);
 // Build predecessors entirely from the repository's existing migrations.
 await db.exec('alter function icash_callback_private.candidates(text,text) rename to thread_candidates;');
 const callbacks=readFileSync('config/receipt-only-seller-callbacks.sql','utf8');
 for(const name of ['call_candidates','candidates']){
  const pattern=new RegExp('create(?: or replace)? function icash_callback_private\\.'+name+'\\(');
  const start=callbacks.search(pattern);assert(start>=0);
  await db.exec(callbacks.slice(start,callbacks.indexOf('$$;',start)+3));
 }
 const signatures=['icash_business_conversation_sender(uuid,uuid,text,boolean)',
  'icash_callback_private.call_candidates(text,text)','icash_callback_private.thread_candidates(text,text)',
  'icash_owner_callback_context(uuid,text,text)','icash_recording_private.bind_business_caller_id()',
  'icash_save_business_voice_number(text,text,boolean,boolean,text)'];
 await f.reset();
 const metadata=()=>q(`select oid::regprocedure::text,provolatile,prosecdef,proconfig,proacl from pg_proc
  where oid=any($1::regprocedure[]) order by oid::regprocedure::text`,[signatures]);
 const before=(await metadata()).rows;
 const migration=readFileSync('config/november-business-numbers.sql','utf8');
 const selector=(await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure) definition")).definition;
 await db.exec(selector.replace("'+16195364770')","'+16195364771')"));
 await assert.rejects(db.exec(migration),/November number boundary changed/);await q('rollback');
 assert.equal((await one("select count(*)::int n from icash_text_senders where phone=$1",[novemberBusinessPhones[0]])).n,0,'Drift rolls back registration');
 await db.exec(selector);await db.exec(migration);
 const additional=readFileSync('config/november-additional-business-numbers.sql','utf8');
 const current=(await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure) definition")).definition;
 await db.exec(current.replace("'+16462494809')","'+16462494808')"));
 await assert.rejects(db.exec(additional),/Additional number boundary changed/);await q('rollback');
 assert.equal((await one("select count(*)::int n from icash_text_senders where phone in ('+15056019451','+15055072937','+15127791343')")).n,0,'New registration rolls back on drift');
 await db.exec(current);await db.exec(additional);
 assert.equal((await one("select count(*)::int n from icash_text_senders where phone in ('+15056019451','+15055072937','+15127791343') and not enabled")).n,3,'All new leases install disabled');
 const november11=readFileSync('config/november-11-business-numbers.sql','utf8');
 const latest=(await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure) definition")).definition;
 await db.exec(latest.replace("'+15127791343')","'+15127791342')"));
 await assert.rejects(db.exec(november11),/November 11 number boundary changed/);await q('rollback');
 assert.equal((await one("select count(*)::int n from icash_text_senders where phone in ('+16027722055','+14357242174')")).n,0,'November 11 registration rolls back on drift');
 await db.exec(latest);await db.exec(november11);
 assert.equal((await one("select count(*)::int n from icash_text_senders where phone in ('+16027722055','+14357242174') and not enabled")).n,2,'Both November 11 leases install disabled');
 assert.deepEqual((await metadata()).rows,before,'Function metadata and prior ACLs are preserved');
 const save=(phone,forwarding,enabled,id=null)=>q('select icash_save_business_voice_number($1,$2,$3,$4,$5)',[ac,id,forwarding,enabled,phone]);
 for(const phone of novemberBusinessPhones){
  await f.reset();await db.exec('truncate icash_text_messages,icash_property_controls;update icash_text_senders set enabled=false;update icash_business_voice_numbers set outbound_enabled=false;');
  await save(phone,true,false);
  assert.equal((await one('select enabled from icash_text_senders where phone=$1',[phone])).enabled,false,'Connect alone never enables SMS');
  await q('update icash_text_senders set enabled=true where phone=$1',[phone]);
  assert.equal(await sms(),phone,'Verified forwarding permits separately enabled texts');
  assert.equal(await sender(),null);assert.equal(await manual(),null,'Unverified caller IDs never permit outbound calls');
  assert.equal(await admit(phone),null);assert((await manualAdmit(phone)).error,'Final outgoing admission still blocks');
  await thread(phone);await q("insert into icash_text_messages(account_id,thread_id,direction,state,provider_id,created_at) select account_id,id,'outgoing','accepted','fixture',now()-interval '1 minute' from icash_text_threads");
  assert.equal((await one('select available from icash_callback_private.thread_candidates($1,$2)',[recipient,phone])).available,true,'Receipt-backed incoming callback does not require outbound caller-ID permission');
  await q('update icash_text_threads set paused=true');
  assert.equal((await one('select available from icash_callback_private.thread_candidates($1,$2)',[recipient,phone])).available,false,'Pause remains binding');
  await q('update icash_text_threads set paused=false');
  await save(phone,false,false);assert.equal(await sms(),null);
  assert.equal((await one('select available from icash_callback_private.thread_candidates($1,$2)',[recipient,phone])).available,false,'Revoked forwarding blocks incoming eligibility');
  await save(phone,true,true,pn);assert.equal(await sender(),phone);assert.equal(await manual(),phone);
  await q('update icash_text_senders set enabled=false where phone=$1',[phone]);
  assert.equal(await sms(),null,'Established disabled text sender never rotates');
  assert.equal(await sender(),phone,'A separately verified calling number may still call');
  await q('insert into icash_text_suppressions values($1)',[recipient]);
  assert.equal(await sender(),null);assert.equal(await sms(),null);
 }
 await assert.rejects(save('+12025550999',true,true,pn),/phone_check/);
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_business_conversation_sender(uuid,uuid,text,boolean)','execute') allowed",[role])).allowed,false);
 console.log('PASS November numbers: exact leases, inactive installation, SMS/incoming distinction, verified-only outbound, callback receipts, Pause, suppression, continuity and atomic drift rejection.');
 // Older hash-bound routing migrations must keep testing their original predecessor.
 if(process.env.OWNER_DEMO_ROUTING_ONLY==='1'||process.env.SENDER_HEALTH_ROUTING==='1')await db.exec(latest);
 if(process.env.OWNER_DEMO_ROUTING_ONLY==='1')await (await import('./owner-demo-call-capable-routing-fixture.mjs')).testOwnerDemoRouting(f);
 if(process.env.SENDER_HEALTH_ROUTING==='1')await (await import('./sender-health-routing-fixture.mjs')).testSenderHealthRouting(f);
}
