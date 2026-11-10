import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
export async function testOwnerDemoConfirmedSender(f){
 const {db,q,one,owner,actor,demoScreen:screen,demoDeal:deal,lead}=f;
 const recipient='+12142185280',a='+16462959838',b='+18623812530',c='+17866727869',smsOnly='+15127791343',disabled='+16462494809',voiceOnly='+14154208230';
 const ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32);
 await f.reset();
 await db.exec(`alter table icash_seller_intakes add created_at timestamptz default now();
 alter table icash_optin_call_requests add requested_at timestamptz default now();
 alter table icash_text_messages add last_delivery_at timestamptz,add body text default '',add event_id text;
 alter table icash_text_threads add ai_mode text default 'auto';
 alter table icash_operation_spend add dispatched_at timestamptz;
 alter table icash_call_recordings add provider_started_at timestamptz,add call_ended_at timestamptz;
 create schema icash_text_receipt_private;
 create table icash_text_events(id text primary key,type text,payload jsonb,received_at timestamptz default now());
 create table icash_seller_opener_assignments(thread_id uuid,account_id uuid,message_id uuid,created_at timestamptz);
 `);
 const delay=readFileSync('supabase/migrations/20261106170821_sender_delay_opener_recovery.sql','utf8');
 const start=delay.indexOf('create function icash_text_receipt_private.sender_opener_available(');
 await db.exec(delay.slice(start,delay.indexOf('end $fn$;',start)+'end $fn$;'.length));
 await q('update icash_seller_intakes set phone=$1 where id=$2',[recipient,lead]);
 await q('update icash_optin_call_requests set phone=$1,expires_at=requested_at+interval \'5 minutes\'',[recipient]);
 const patch=readFileSync('config/owner-demo-confirmed-sender.sql','utf8');
 const def=async()=>(await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure) d")).d;
 const meta=async()=>(await one("select provolatile,prosecdef,proconfig,proacl from pg_proc where oid='icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure"));
 const old=await def(),before=await meta();
 await db.exec(old.replace('order by encode(sha256','order by  encode(sha256'));
 await assert.rejects(db.exec(patch),/ranking order changed/);await q('rollback');
 assert.equal((await one("select to_regprocedure('icash_owner_demo_sender_rank(text)') fn")).fn,null,'Migration drift rolls back helper');
 assert.equal((await one("select to_regclass('icash_demo_sender_completed_calls') idx")).idx,null,'Migration drift rolls back index');
 await db.exec(old);const state=(await q('select * from icash_text_senders order by phone')).rows;
 await db.exec(patch);await db.exec(patch);assert.deepEqual(await meta(),before);assert.deepEqual((await q('select * from icash_text_senders order by phone')).rows,state);
 const rank=async phone=>(await one('select icash_owner_demo_sender_rank($1) rank',[phone])).rank.map(Number);
 const sms=async(phone=recipient)=>(await one('select icash_property_text_sender($1,$2,$3) sender',[owner,deal,phone])).sender;
 const voice=async(phone=recipient)=>(await one('select icash_property_call_sender($1,$2,$3) sender',[owner,screen,phone])).sender;
 const reset=async()=>{
  await f.reset();await db.exec('truncate icash_text_messages,icash_property_controls,icash_operation_spend,icash_text_events,icash_seller_opener_assignments;update icash_voice_configs set enabled=true;');
  await q('update icash_text_senders set enabled=phone=any($1::text[])',[[a,b,c,smsOnly]]);
  await q('update icash_business_voice_numbers set outbound_enabled=phone=any($1::text[]),forwarding_ready=true,caller_id_sid=$2',[[a,b,c,disabled,voiceOnly],pn]);
  await q("update icash_seller_intakes set phone=$1,state='assigned',ai_consented=true,contact_consent_scope='icash_x_demo',attribution=jsonb_build_object('demoAccountId',$2::text),created_at=now()",[recipient,owner]);
  await q("update icash_optin_call_requests set phone=$1,requested_at=now(),expires_at=now()+interval '5 minutes',source='demo_form',request_reference=request_version,requested_by=$2",[recipient,actor]);
 };
 const evidence=async(phone,smsCount,callCount,age='1 hour')=>{
  const t=randomUUID();await q("insert into icash_text_threads(id,account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,'+12025550998','seller')",[t,f.other,f.otherDeal,phone]);
  for(let i=0;i<smsCount;i++){
   const id=randomUUID();await q("insert into icash_text_messages(id,account_id,thread_id,direction,state,provider_id,created_at,last_delivery_at) values($1,$2,$3,'outgoing','delivered',$4,now()-$5::interval,now()-$5::interval+interval '1 second')",[id,f.other,t,'SMS'+id,age]);
   await q("insert into icash_operation_spend(account_id,operation_key,state,dispatched_at) values($1,$2,'settled',now()-$3::interval-interval '1 second')",[f.other,'text:'+id,age]);
  }
  for(let i=0;i<callCount;i++){
   const id=randomUUID();await q("insert into icash_call_recordings(id,account_id,screening_id,from_phone,to_phone,party,state,operation_key,provider_account_sid,call_sid,provider_started_at,call_ended_at) values($1,$2,$3,$4,'+12025550997','seller','available',$5,$6,$7,now()-$8::interval,now()-$8::interval+interval '1 second')",[id,f.other,f.otherScreen,phone,'voice:'+id,ac,'CA'+id.replaceAll('-',''),age]);
   await q("insert into icash_operation_spend(account_id,operation_key,state,dispatched_at) values($1,$2,'settled',now()-$3::interval-interval '1 second')",[f.other,'voice:'+id,age]);
  }
 };
 const sameThread=phone=>q("insert into icash_text_threads(account_id,deal_id,sender,recipient,party) values($1,$2,$3,$4,'seller')",[owner,deal,phone,recipient]);
 await reset();const fallback=await sms();await evidence(a,3,2);await evidence(b,8,5);await evidence(c,5,3);
 assert.deepEqual(await rank(b),[1,0,5,13]);assert.equal(await sms(),b);assert.equal(await voice(),b,'Fresh voice-first and text-first choose the same jointly ready proven line');
 await evidence(disabled,12,12);assert.equal(await sms(),b,'Disabled sender cannot win on history');
 await evidence(voiceOnly,14,14);assert.equal(await voice(),b,'Voice-only sender cannot bind a fresh dual-channel demo');
 await evidence(smsOnly,20,0);assert.equal(await sms(),b,'Unverified caller cannot win on SMS history');
 const beforeThread=(await q('select * from icash_text_threads order by id')).rows;await sms();await voice();assert.deepEqual((await q('select * from icash_text_threads order by id')).rows,beforeThread,'Read-only ranking does not allocate or mutate');
 await sameThread(a);assert.equal(await sms(),a);assert.equal(await voice(),a,'Same-run established sender wins over ranking');
 await q('update icash_text_senders set enabled=false where phone=$1',[a]);assert.equal(await sms(),null,'Disabled existing route holds, never rotates');
 await reset();await evidence(b,8,5);await q("insert into icash_customer_phone_calls(account_id,screening_id,business_phone,recipient_phone,state) values($1,$2,$3,$4,'needs_review')",[owner,screen,a,recipient]);assert.equal(await sms(),a);assert.equal(await voice(),a,'Unknown current-run manual receipt retains identity');
 await reset();await evidence(b,8,5);await q("insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone,party,state,provider_account_sid) values($1,$2,$3,$4,'seller','needs_review',$5)",[owner,screen,a,recipient,ac]);assert.equal(await sms(),a,'Unknown current-run automatic receipt retains identity');
 await reset();await evidence(b,8,5);await sameThread(a);await sameThread(c);assert.equal(await sms(),null,'Conflicting same-run identities cannot be ranked away');
 await reset();await evidence(b,8,5);await q('insert into icash_sms_routes values($1,$2,$3,true)',[b,recipient,owner]);assert.notEqual(await sms(),b);
 await reset();await evidence(b,8,5);await q('insert into icash_sms_routes values($1,$2,$3,false)',[b,recipient,f.other]);assert.notEqual(await sms(),b);
 await reset();await evidence(b,8,5);await q('insert into role_conflicts values($1,$2)',[b,recipient]);assert.notEqual(await sms(),b);
 for(const table of ['icash_text_suppressions','icash_webinar_phone_suppressions']){await reset();await evidence(b,1,1);await q(`insert into ${table} values($1)`,[recipient]);assert.equal(await sms(),null);assert.equal(await voice(),null);}
 await reset();await evidence(b,1,1);await q("insert into icash_contact_suppressions values(encode(sha256(convert_to($1,'UTF8')),'hex'))",[recipient]);assert.equal(await sms(),null);
 await reset();await evidence(b,8,5,'8 days');assert.deepEqual(await rank(b),[1,0,0,0]);assert.equal(await sms(),fallback,'Stale-only pool retains deterministic fallback');
 for(const change of [
  "update icash_text_messages set state='accepted'", "update icash_text_messages set provider_id=null", "update icash_text_messages set last_delivery_at=now()+interval '1 hour'",
  "update icash_operation_spend set dispatched_at=null where operation_key like 'text:%'", "update icash_operation_spend set account_id='"+owner+"' where operation_key like 'text:%'", "update icash_text_messages set account_id='"+owner+"'",
  "update icash_operation_spend set dispatched_at=now() where operation_key like 'text:%'"
 ]){await reset();await evidence(b,2,0);await db.exec(change);assert.deepEqual(await rank(b),[1,0,0,0],change);}
 for(const change of [
  'update icash_call_recordings set call_sid=null', 'update icash_call_recordings set provider_started_at=null','update icash_call_recordings set call_ended_at=null',
  "update icash_call_recordings set call_ended_at=now()+interval '1 hour'", "update icash_operation_spend set account_id='"+owner+"'",'update icash_operation_spend set dispatched_at=null',
  "update icash_business_voice_numbers set caller_id_sid='PN'||repeat('c',32)","update icash_business_voice_numbers set provider_account_sid='AC'||repeat('c',32)"
 ]){await reset();await q('update icash_business_voice_numbers set provider_account_sid=$1',[ac]);await evidence(b,0,2);await db.exec(change);assert.deepEqual(await rank(b),[1,0,0,0],change);}
 await q('update icash_business_voice_numbers set provider_account_sid=$1',[ac]);
 // Bounded DISTINCT counts have no timing/order preference: once saturated, the
 // number of confirmations is capped, not weighted by which row was scanned.
 await reset();await evidence(b,502,0);assert.deepEqual(await rank(b),[1,0,0,500]);
 await q("update icash_text_messages set last_delivery_at=last_delivery_at+interval '1 minute'");assert.deepEqual(await rank(b),[1,0,0,500]);
 await reset();await evidence(a,2,2);await evidence(b,8,5);
 const delayed=await one('select m.provider_id,m.id from icash_text_messages m join icash_text_threads t on t.id=m.thread_id where t.sender=$1 limit 1',[b]);
 await q('update icash_operation_spend set dispatched_at=now()-interval \'2 minutes\' where operation_key=$1',['text:'+delayed.id]);
 const eventId='fixture-delay';await q("insert into icash_text_events(id,type,payload) values($1,'numbers.delayed',jsonb_build_object('id',$1::text,'type','numbers.delayed','timestamp',extract(epoch from now()-interval '1 minute'),'data',jsonb_build_object('reason','number_temporary_unavailable','original_number',$2::text,'affected_id',$3::text)))",[eventId,b,delayed.provider_id]);
 assert.equal((await rank(b))[0],0);assert.equal(await sms(),a,'Fresh verified carrier delay outranks older high counts');
 await q('update icash_text_messages set last_delivery_at=now() where id=$1',[delayed.id]);assert.equal((await rank(b))[0],0,'Late older-send confirmation does not clear newer failure');
 await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()-interval '6 minutes'))) where id=$1",[eventId]);
 await q("update icash_operation_spend set dispatched_at=now()-interval '7 minutes' where operation_key=$1",['text:'+delayed.id]);
 assert.equal((await one('select icash_text_receipt_private.sender_opener_available($1) ready',[b])).ready,true,'Existing five-minute probe policy unchanged');
 assert.equal((await rank(b))[0],0);assert.equal(await sms(),a,'Unresolved six-minute delay still demotes behind confirmed alternatives');
 await evidence(b,1,0,'20 seconds');assert.equal((await rank(b))[0],1);assert.equal(await sms(),b,'Verified later-dispatch delivery restores readiness');
 await q("delete from icash_text_messages where created_at>now()-interval '1 minute'");
 await q("update icash_text_events set payload=jsonb_set(payload,'{timestamp}',to_jsonb(extract(epoch from now()-interval '61 minutes'))) where id=$1",[eventId]);
 assert.equal((await rank(b))[0],1,'Notice penalty has a bounded one-hour freshness');
 // Changed sender capability is authoritative regardless of history.
 await q('update icash_business_voice_numbers set outbound_enabled=false where phone=$1',[b]);assert.notEqual(await sms(),b);assert.notEqual(await voice(),b);
 await reset();await evidence(f.primary,2,2);assert.deepEqual(await rank(f.primary),[1,0,0,2],'Primary old calls lack current registered provider proof');
 await q('update icash_text_senders set enabled=(phone=$1)',[f.primary]);assert.equal(await sms(),f.primary);assert.equal(await voice(),f.primary,'Primary remains eligible deterministic fallback');
 await reset();await evidence(b,8,5);
 for(const [change,restore] of [
  ["update icash_optin_call_requests set expires_at=now()-interval '1 minute'","update icash_optin_call_requests set expires_at=requested_at+interval '5 minutes'"],
  ["update icash_optin_call_requests set requested_by=null",`update icash_optin_call_requests set requested_by='${actor}'`],
  ["update icash_seller_intakes set ai_consented=false","update icash_seller_intakes set ai_consented=true"],
  ["update icash_seller_intakes set attribution='{}'",`update icash_seller_intakes set attribution=jsonb_build_object('demoAccountId','${owner}')`]
 ]){
  await db.exec(change);
  // Expiry preserves predecessor dual-capability intent; source mismatch uses
  // predecessor ordinary pool. Compare directly against the exact predecessor.
  const current=await def();await db.exec(old);const ordinary=await sms();await db.exec(current);assert.equal(await sms(),ordinary,'No fresh exact intent: '+change);await db.exec(restore);
 }
 await (await import('./owner-demo-inbound-fixture.mjs')).testOwnerDemoInbound({...f,rank,sms,voice,reset,evidence,sameThread,a,b,c,smsOnly,disabled,voiceOnly});
 const current=await def();await db.exec(old);const oldForeign=(await one('select icash_business_conversation_sender($1,$2,$3) sender',[f.account,f.screen,recipient])).sender;const otherPhone='+12025550199';await q('update icash_seller_intakes set phone=$1',[otherPhone]);await q('update icash_optin_call_requests set phone=$1',[otherPhone]);const nonself=await sms(otherPhone);await db.exec(current);assert.equal(await sms(otherPhone),nonself,'Owner nonself phone keeps predecessor behavior');assert.equal((await one('select icash_business_conversation_sender($1,$2,$3) sender',[f.account,f.screen,recipient])).sender,oldForeign,'Other account keeps predecessor hash');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_owner_demo_sender_rank(text)','execute') allowed",[role])).allowed,false);
 assert.equal((await one("select has_function_privilege('service_role','icash_owner_demo_sender_rank(text)','execute') allowed")).allowed,true);
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_owner_demo_sender_recovered(text)','execute') allowed",[role])).allowed,false);
 for(const name of ['icash_owner_demo_sender_rank','icash_owner_demo_sender_recovered','icash_owner_demo_sender_inbound_at']){
  const helper=await one("select provolatile,prosecdef,proconfig,pg_get_functiondef(oid) d from pg_proc where oid=$1::regprocedure",[name+'(text)']);assert.equal(helper.provolatile,'s');assert.equal(helper.prosecdef,false);assert.deepEqual(helper.proconfig,['search_path=\"\"']);
  assert(!/pg_advisory|for update|for share|insert into|update public|delete from/i.test(helper.d));
 }
 assert(!/pg_advisory|for update|for share|insert into|update public|delete from/i.test(await def()));
 console.log('PASS owner demo confirmed sender: exact PR654 predecessor; fresh self-demo transport ranking, bounded source-bound evidence, stale/foreign/incomplete rejection, verified new-delay precedence and post-delay recovery, deterministic fallback, same-run unknown identity, capability/tenant/role/suppression fences and private atomic migration. No providers.');
}
