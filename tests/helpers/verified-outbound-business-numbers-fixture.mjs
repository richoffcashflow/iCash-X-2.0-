import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

export async function testVerifiedOutboundBusinessNumbers(f){
 const {db,q,one,sender,sms,manual,thread,customer,account,screen,deal,other,otherScreen,otherDeal,primary,secondary,retired,recipient,admit,manualAdmit}=f;
 const phones=['+14154208230','+16195364770'],ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32),otherAc='AC'+'c'.repeat(32);
 const read=path=>readFileSync(path,'utf8');
 const functionSql=(path,name)=>{const source=read(path),start=source.search(new RegExp('create(?: or replace)? function '+name.replaceAll('.','\\.')+'\\('));assert(start>=0,name);const end=source.indexOf('$$;',start);assert(end>start,name);return source.slice(start,end+3);};
 await f.reset();
 // Upgrade the selector fixture to the actual voice table and caller receipt
 // trigger, keeping the existing rows rather than inventing a second schema.
 const original=read('supabase/migrations/20261008192616_business_voice_numbers.sql');
 await db.exec('alter table public.icash_business_voice_numbers rename to fixture_voice_numbers_before;');
 await db.exec(original.slice(original.indexOf('create table public.icash_business_voice_numbers'),original.indexOf('create function public.icash_save_business_voice_number')).replace("check(phone='+14244377030')","check(phone in ('+14244377030','+17208134296'))"));
 await q('insert into icash_business_voice_numbers(phone,provider_account_sid,caller_id_sid,forwarding_ready,outbound_enabled) select phone,$1,caller_id_sid,forwarding_ready,outbound_enabled from fixture_voice_numbers_before',[ac]);
 await db.exec('drop table fixture_voice_numbers_before;');
 const additional=read('config/additional-business-voice-number.sql');
 await db.exec(additional.slice(additional.indexOf('create function public.icash_save_business_voice_number'),additional.indexOf('create or replace function public.icash_customer_call_sender')));
 await db.exec(original.slice(original.indexOf('alter table public.icash_call_recordings add column'),original.indexOf('create function icash_recording_private.bind_business_caller_id')));
 await db.exec(original.slice(original.indexOf('create trigger bind_business_caller_id'),original.lastIndexOf('commit;')));
 await db.exec(read('config/inbound-business-numbers.sql'));

 // Install the actual callback lookup boundaries so the migration's guarded
 // replacements execute against real functions, not signature-only stubs.
 await db.exec(`create schema icash_callback_private;
 alter table icash_accounts add legal_name text,add assistant_name text;
 alter table icash_screening_jobs add snapshot jsonb default '{"propertyId":"fixture-property","address":"1 Fixture Lane"}';
 alter table icash_deal_files add stage text default 'draft',add terms jsonb default '{}';
 alter table icash_text_threads add manual_only boolean default false;
 alter table icash_customer_phone_calls add child_sid text;
 create table icash_property_controls(account_id uuid,property_id text,manual boolean);
 create table icash_text_messages(id uuid default gen_random_uuid(),account_id uuid,thread_id uuid,direction text,state text,created_at timestamptz,provider_id text);`);
 for(const name of ['icash_callback_private.candidates','public.icash_owner_callback_context'])await db.exec(functionSql('config/seller-callback-routing.sql',name));
 await db.exec(`revoke all on function icash_callback_private.candidates(text,text),public.icash_owner_callback_context(uuid,text,text) from public,anon,authenticated;
 grant execute on function icash_callback_private.candidates(text,text),public.icash_owner_callback_context(uuid,text,text) to service_role;`);
 const save=(phone,forwarding,enabled,id=null,provider=ac)=>q('select icash_save_business_voice_number($1,$2,$3,$4,$5)',[provider,id,forwarding,enabled,phone]);
 for(const phone of phones)await save(phone,true,false);
 const state=async()=>({voice:(await q('select * from icash_business_voice_numbers order by phone')).rows,sms:(await q('select * from icash_text_senders order by phone')).rows});
 const metadata=async()=>(await q(`select oid::regprocedure::text name,provolatile,prosecdef,proconfig,proacl from pg_proc where oid in (
 'public.icash_business_conversation_sender(uuid,uuid,text)'::regprocedure,'public.icash_property_call_sender(uuid,uuid,text)'::regprocedure,
 'public.icash_customer_call_sender(uuid,uuid,text)'::regprocedure,'public.icash_save_business_voice_number(text,text,boolean,boolean,text)'::regprocedure,
 'icash_recording_private.bind_business_caller_id()'::regprocedure,'icash_callback_private.candidates(text,text)'::regprocedure,
 'public.icash_owner_callback_context(uuid,text,text)'::regprocedure) order by name`)).rows;
 const before=await state(),permissions=await metadata();
 const sql=read('config/verified-outbound-business-numbers.sql'),migration=readdirSync('supabase/migrations').find(n=>n.endsWith('_verified_outbound_business_numbers.sql'));
 assert(migration,'CLI migration exists');assert.equal(sql,read('supabase/migrations/'+migration));
 const coreBefore=(await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text)'::regprocedure) definition")).definition;
 const manualBefore=(await one("select pg_get_functiondef('icash_customer_call_sender(uuid,uuid,text)'::regprocedure) definition")).definition;
 await db.exec(manualBefore.replace('public.icash_business_conversation_sender(p_account,p_screening,p_recipient)','public.icash_business_conversation_sender(p_account, p_screening,p_recipient)'));
 await assert.rejects(db.exec(sql),/Business voice boundary changed/);await q('rollback');
 assert.equal((await one("select to_regprocedure('icash_business_conversation_sender(uuid,uuid,text,boolean)') routine")).routine,null,'Boundary drift rolls back even the earlier selector creation');
 assert.equal((await one("select pg_get_functiondef('icash_business_conversation_sender(uuid,uuid,text)'::regprocedure) definition")).definition,coreBefore);
 await db.exec(manualBefore);await db.exec(sql);
 assert.deepEqual(await state(),before,'Migration never activates voice/SMS or changes historical readiness');
 assert.deepEqual(await metadata(),permissions,'Existing stability, security, search path and ACL are preserved');
 const reset=async()=>{await f.reset();await db.exec('truncate icash_text_messages,icash_property_controls;');};
 const record=async(phone,acc=account,screening=screen,provider=ac)=>q("insert into icash_call_recordings(account_id,screening_id,from_phone,to_phone,party,state,provider_account_sid,call_sid,dial_claimed_at) values($1,$2,$3,$4,'seller','needs_review',$5,'CA'||repeat('f',32),now()-interval '1 minute') returning *",[acc,screening,phone,recipient,provider]);
 const only=async phone=>{await reset();await q('update icash_text_senders set enabled=false');await q('update icash_business_voice_numbers set outbound_enabled=(phone=$1)',[phone]);};
 for(const phone of phones){
  await save(phone,true,true,pn);assert.equal((await one('select enabled from icash_text_senders where phone=$1',[phone])).enabled,false);
  await q('delete from icash_text_senders where phone=$1',[phone]);await save(phone,true,true,pn);
  assert.equal((await one('select enabled from icash_text_senders where phone=$1',[phone])).enabled,false,'Connecting a verified lease creates SMS disabled even without a seed');
 }
 await reset();
 const voicePool=(await q("select distinct icash_property_call_sender($1,$2,'+1202555'||lpad(i::text,4,'0')) sender from generate_series(1000,1999) i order by sender",[account,screen])).rows.map(r=>r.sender);
 assert.deepEqual(voicePool,[primary,...phones,secondary].sort());
 const textPool=(await q("select distinct icash_business_conversation_sender($1,$2,'+1202555'||lpad(i::text,4,'0')) sender from generate_series(1000,1999) i order by sender",[account,screen])).rows.map(r=>r.sender);
 assert.deepEqual(textPool,[primary,secondary].sort(),'SMS never selects voice-only numbers');
 for(const phone of phones){
  await only(phone);assert.equal(await sender(),phone);assert.equal(await manual(),phone);assert.equal(await sms(),null);
  const receipt=(await record(phone)).rows[0];assert.equal(receipt.caller_id_sid,pn);assert.equal(await sender(),phone);assert.equal(await sms(),null,'Uncertain voice history cannot rotate into a text sender');
  await assert.rejects(q('update icash_call_recordings set from_phone=$1 where id=$2',[secondary,receipt.id]),/immutable/);
  await assert.rejects(q('update icash_call_recordings set provider_account_sid=$1 where id=$2',[otherAc,receipt.id]),/immutable/);
  await assert.rejects(q('update icash_call_recordings set caller_id_sid=null where id=$1',[receipt.id]),/immutable/);
  await assert.rejects(record(phone,account,screen,otherAc),/verification required/,'Caller ID belongs to the exact provider account');
  for(const [forwarding,enabled,id] of [[true,false,pn],[false,false,pn],[true,false,null]]){
   await save(phone,forwarding,enabled,id);assert.equal(await sender(),null);assert.equal(await manual(),null);assert.equal(await sms(),null);
   await assert.rejects(record(phone),/verification required/);
  }
  await assert.rejects(save(phone,true,true,null),/check constraint/);
  assert.equal((await one('select caller_id_sid from icash_call_recordings where id=$1',[receipt.id])).caller_id_sid,pn,'Disabling readiness preserves saved caller evidence');
  await only(phone);await customer(phone);assert.equal(await sender(),phone);assert.equal(await sms(),null,'Manual/browser history also blocks sender rotation for SMS');
  await only(phone);await record(phone,other,otherScreen);assert.equal(await sender(),null,'Foreign call history excludes the voice-only pair');
  await only(phone);await thread(phone,other,otherDeal);assert.equal(await sender(),null,'Foreign SMS history still owns its number/recipient pair');
  await only(phone);await q('insert into role_conflicts values($1,$2)',[phone,recipient]);assert.equal(await sender(),null);
  await only(phone);await q('insert into icash_sms_routes values($1,$2,$3,true)',[phone,recipient,account]);assert.equal(await sender(),null,'Reviewed SMS route still holds voice');
  for(const table of ['icash_text_suppressions','icash_webinar_phone_suppressions']){await only(phone);await q(`insert into ${table} values($1)`,[recipient]);assert.equal(await sender(),null);assert.equal(await manual(),null);}
  await only(phone);await q("insert into icash_contact_suppressions values(encode(sha256(convert_to($1,'UTF8')),'hex'))",[recipient]);assert.equal(await sender(),null);

  // Actual final AI/manual functions reject a preview whose identity was claimed
  // by SMS first; call-first saves the new identity and prevents SMS rotation.
  await only(phone);assert.equal(await sender(),phone);await q('update icash_text_senders set enabled=true where phone=$1',[primary]);await thread(primary);
  assert.equal(await admit(phone),null,'SMS-first defeats stale AI voice preview');assert((await manualAdmit(phone)).error,'SMS-first defeats stale manual voice preview');
  await only(phone);const admitted=await admit(phone);assert.equal(admitted.from_phone,phone);assert.equal(admitted.caller_id_sid,pn);assert.equal(await sms(),null);
  await save(phone,true,false,pn);assert.equal((await admit(phone)).id,admitted.id,'Existing operation retains immutable idempotent receipt after disable');
  await only(phone);const manualCall=await manualAdmit(phone);assert.equal(manualCall.call.business_phone,phone);assert.equal(await sms(),null);
  await only(phone);await q('update icash_accounts set bot_paused=true where id=$1',[account]);assert.equal(await admit(phone),null);assert((await manualAdmit(phone)).error,'Pause still blocks manual admission');

  await only(phone);await thread(phone);await record(phone);
  const context=(await one('select icash_owner_callback_context($1,$2,$3) result',['592171a0-2bb9-484e-8c9a-dd5d2b43b5f7',recipient,phone])).result;
  assert.equal(context.status,'matched');assert.equal(context.matches[0].businessNumber,phone);assert.equal(context.matches[0].available,true);
  await q('update icash_text_threads set paused=true');assert.equal((await one('select available from icash_callback_private.candidates($1,$2)',[recipient,phone])).available,false,'Existing callback pause remains held');
 }
 await reset();await thread(retired);assert.equal(await sender(),null,'Paused legacy 424 is not revived by new voice policy');
 await reset();await thread(primary);assert.equal(await sender(),primary);assert.equal(await manual(),primary);assert.equal(await sms(),primary,'Established old identity remains shared');
 await assert.rejects(save('+12025550999',true,true,pn),/phone_check/,'Arbitrary voice numbers remain excluded');
 for(const role of ['anon','authenticated'])assert.equal((await one("select has_function_privilege($1,'icash_business_conversation_sender(uuid,uuid,text,boolean)','execute') allowed",[role])).allowed,false);
 const selector=await one("select provolatile,prosecdef,proconfig,pg_get_functiondef(oid) definition from pg_proc where oid='icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure");
 assert.equal(selector.provolatile,'s');assert.equal(selector.prosecdef,false);assert(!/pg_advisory|for update|for share|insert into|update public|delete from/i.test(selector.definition));
 assert.equal((await one("select has_table_privilege('authenticated','icash_business_voice_numbers','select') allowed")).allowed,false);
 assert.equal((await one("select relrowsecurity from pg_class where oid='icash_business_voice_numbers'::regclass")).relrowsecurity,true);
 console.log('PASS verified outbound numbers: exact verified voice pool, SMS isolation and continuity, unchanged migration state/metadata, caller receipt binding, controls, final AI/manual admission and callback lookup.');
 if(process.env.NOVEMBER_NUMBERS_ONLY==='1')await (await import('./november-business-numbers-fixture.mjs')).testNovemberNumbers(f);
}
