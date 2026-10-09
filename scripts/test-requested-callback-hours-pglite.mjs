// In-memory only: no credentials, network, provider calls or customer charges.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const ids=Array.from({length:8},()=>randomUUID()),[account,owner,job,permission,message,thread,deal,screen]=ids;
const q=(sql,values=[])=>pg.query(sql,values);
try{
 await pg.exec(`create role anon;create role authenticated;create role service_role;
 create table icash_accounts(id uuid primary key,owner_user_id uuid);
 create table icash_voice_jobs(id uuid primary key,account_id uuid,permission_id uuid,sms_source_message_id uuid,state text,operational_contact_id uuid,callback_id uuid,sms_requested_at timestamptz,sms_requested_by uuid);
 create table icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,party text,seller_intake_id uuid,phone text,local_start_hour integer,local_end_hour integer);
 create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,direction text,state text,created_at timestamptz);
 create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,seller_intake_id uuid,recipient text);
 create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid);
 create table fixture_policy(voice boolean,request boolean);insert into fixture_policy values(true,true);
 create function icash_seller_voice_permission_current(uuid,uuid) returns boolean language sql as $$select voice from public.fixture_policy$$;
 create function icash_seller_sms_call_current(uuid,uuid) returns boolean language sql as $$select request from public.fixture_policy$$;
 create function icash_claim_voice_job(p_job uuid) returns boolean language plpgsql as $$declare j icash_voice_jobs;p icash_contact_permissions;h integer:=0;begin
 select * into j from icash_voice_jobs where id=p_job;select * into p from icash_contact_permissions where id=j.permission_id;
 if h<greatest(9,p.local_start_hour) or h>=least(case when public.icash_seller_voice_permission_current(j.account_id,p.id) then 20 else 18 end,p.local_end_hour) then return false;end if;
 return true;end$$;`);
 await q('insert into icash_accounts values($1,$2)',[account,owner]);
 await q("insert into icash_contact_permissions values($1,$2,$3,'seller',$3,'fixture-phone',9,20)",[permission,account,screen]);
 await q("insert into icash_voice_jobs values($1,$2,$3,$4,'issued',null,null,now(),null)",[job,account,permission,message]);
 await q("insert into icash_text_messages values($1,$2,$3,'incoming','received',now())",[message,account,thread]);
 await q("insert into icash_text_threads values($1,$2,$3,'seller',$4,'fixture-phone')",[thread,account,deal,screen]);
 await q('insert into icash_deal_files values($1,$2,$3)',[deal,account,screen]);
 const claim=async()=>(await q('select icash_claim_voice_job($1) ok',[job])).rows[0].ok;
 assert.equal(await claim(),false,'Existing hour check reproduces the night callback failure');
 await pg.exec(readFileSync(new URL('../config/requested-seller-callback-hours.sql',import.meta.url),'utf8'));
 const current=async(a=account)=>(await q('select icash_requested_seller_call_current($1,$2) ok',[a,job])).rows[0].ok;
 assert.equal(await current(),true);assert.equal(await claim(),true);
 assert.equal(await current(randomUUID()),false,'Wrong customer cannot use another request');
 for(const change of [
  "update fixture_policy set voice=false","update fixture_policy set request=false",
  "update icash_voice_jobs set sms_source_message_id=null","update icash_voice_jobs set sms_requested_at=now()-interval '6 minutes'",
  "update icash_voice_jobs set sms_requested_at=now()+interval '1 minute'","update icash_voice_jobs set state='dispatching'",
  "update icash_voice_jobs set callback_id=gen_random_uuid()","update icash_voice_jobs set operational_contact_id=gen_random_uuid()",
  "update icash_voice_jobs set sms_requested_by=gen_random_uuid()","update icash_contact_permissions set party='buyer'",
  "update icash_contact_permissions set phone='different-phone'","update icash_deal_files set screening_id=gen_random_uuid()",
  "update icash_text_messages set direction='outgoing'","update icash_text_messages set created_at=now()+interval '1 minute'",
  "update icash_text_messages set created_at=now()-interval '6 minutes'",
 ]){
  await q('begin');await q(change);assert.equal(await current(),false,change);assert.equal(await claim(),false,change);await q('rollback');
 }
 await q('begin');await q("update icash_text_messages set created_at=now()-interval '20 minutes'");
 await q('update icash_voice_jobs set sms_requested_by=$1',[owner]);assert.equal(await current(),true,'An audited owner restart keeps the original received message');
 await q("update icash_text_messages set created_at=now()-interval '25 hours'");assert.equal(await current(),false);await q('rollback');
 for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,'icash_requested_seller_call_current(uuid,uuid)','execute') ok",[role])).rows[0].ok,false);
 console.log('PASS explicit fresh callback, final-claim window, account/property/phone binding, expiry, revocation, owner audit and private execution.');
}finally{await pg.close();}
