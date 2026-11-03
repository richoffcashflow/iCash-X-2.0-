import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {inboundBusinessPhones} from '../lib/business-phone-policy.ts';
const db=await PGlite.create(),ac='AC'+'a'.repeat(32),pn='PN'+'b'.repeat(32);
const q=(sql,args=[])=>db.query(sql,args),rows=async(sql,args=[])=>(await q(sql,args)).rows;
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema icash_recording_private;
 create table icash_text_senders(phone text primary key,enabled boolean default true);
 create table icash_webinar_text_senders(phone text primary key,enabled boolean default true,preferred boolean default false);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table icash_text_threads(sender text,sender_pool_assigned boolean,account_id uuid,deal_id uuid,recipient text,retired_at timestamptz,party text);
 create table icash_call_recordings(id int primary key,from_phone text,provider_account_sid text);
 create function icash_manual_contacts(uuid,uuid) returns table(phone text,blocked boolean) language sql as $$select '+12125550101'::text,false$$;`);
 await db.exec(readFileSync('supabase/migrations/20261008192616_business_voice_numbers.sql','utf8'));
 await db.exec(readFileSync('config/additional-business-voice-number.sql','utf8'));
 const save=(phone,forwarding,enabled,id=null)=>q('select icash_save_business_voice_number($1,$2,$3,$4,$5)',[ac,id,forwarding,enabled,phone]);
 await save('+17208134296',true,true,pn);await save('+14244377030',true,false,null);
 await q("update icash_text_senders set enabled=false where phone='+14244377030'");
 const previous=await rows('select * from icash_business_voice_numbers order by phone');
 const functions=await rows("select oid::regprocedure::text name,pg_get_functiondef(oid) definition,proacl from pg_proc where proname in ('icash_save_business_voice_number','bind_business_caller_id','icash_customer_call_sender') order by name");
 const sql=readFileSync('config/inbound-business-numbers.sql','utf8');
 const migration=readdirSync('supabase/migrations').find(n=>n.endsWith('_inbound_business_numbers.sql'));
 assert.equal(sql,readFileSync('supabase/migrations/'+migration,'utf8'));await db.exec(sql);
 assert.deepEqual(await rows('select * from icash_business_voice_numbers order by phone'),previous,'Migration never fabricates provider verification or changes old readiness');
 assert.deepEqual(await rows("select oid::regprocedure::text name,pg_get_functiondef(oid) definition,proacl from pg_proc where proname in ('icash_save_business_voice_number','bind_business_caller_id','icash_customer_call_sender') order by name"),functions,'Existing routing and permissions are unchanged');
 for(const phone of inboundBusinessPhones){
  assert.deepEqual(await rows('select enabled from icash_text_senders where phone=$1',[phone]),[{enabled:false}]);
  await save(phone,false,false);await save(phone,true,false);await save(phone,true,false);
  assert.deepEqual(await rows('select forwarding_ready,outbound_enabled,caller_id_sid from icash_business_voice_numbers where phone=$1',[phone]),[{forwarding_ready:true,outbound_enabled:false,caller_id_sid:null}]);
  assert.deepEqual(await rows('select enabled from icash_text_senders where phone=$1',[phone]),[{enabled:false}],'Repeated Connect never enables SMS');
  await assert.rejects(save(phone,true,true),/check constraint/,'Unverified outbound is rejected by the existing DB constraint');
 }
 await assert.rejects(save('+12125550199',true,false),/phone_check/);
 assert.deepEqual(await rows('select * from icash_business_voice_numbers where phone in ($1,$2) order by phone',['+14244377030','+17208134296']),previous);
 assert.deepEqual(await rows("select phone,enabled from icash_text_senders where phone in ('+14244377030','+17208134296') order by phone"),[{phone:'+14244377030',enabled:false},{phone:'+17208134296',enabled:true}]);
 for(const role of ['anon','authenticated']){
  assert.equal((await rows("select has_function_privilege($1,'icash_save_business_voice_number(text,text,boolean,boolean,text)','execute') allowed",[role]))[0].allowed,false);
  assert.equal((await rows("select has_table_privilege($1,'icash_business_voice_numbers','select') allowed",[role]))[0].allowed,false);
 }
 assert.equal((await rows("select relrowsecurity from pg_class where oid='icash_business_voice_numbers'::regclass"))[0].relrowsecurity,true);
 // Reapplying the configuration leaves any separately authorized future state intact.
 await q('update icash_text_senders set enabled=true where phone=$1',[inboundBusinessPhones[0]]);await db.exec(sql);
 assert.equal((await rows('select enabled from icash_text_senders where phone=$1',[inboundBusinessPhones[0]]))[0].enabled,true);
 console.log('PASS inbound-number migration: exact leases, incoming-only setup, repeated Connect keeps SMS disabled, unverified outbound rejected, old state/functions/ACL/RLS preserved.');
}finally{await db.close();}
