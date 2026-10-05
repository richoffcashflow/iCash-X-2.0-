// Isolated SQL simulation: message composition and existing admission/length gates.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),pg=await PGlite.create();
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
try{
 await pg.exec(`create table icash_text_threads(id uuid,account_id uuid,party text,paused boolean,ai_mode text,permission_until timestamptz,deal_id uuid);
 create table icash_deal_files(id uuid,account_id uuid,stage text,terms jsonb);
 create table icash_customer_identities(account_id uuid,principal text,company_name text);
 create table icash_seller_opener_assignments(thread_id uuid,account_id uuid,body text,message_id uuid);
 create table icash_text_messages(id uuid,thread_id uuid,account_id uuid,direction text,state text,created_at timestamptz,body text,provider_id text);
 create table icash_sms_seller_openings(thread_id uuid,account_id uuid,owner_question_id uuid);
 create function icash_sms_inbound_campaign_current(uuid) returns boolean language sql as $$select true$$;
 create function icash_assign_seller_opener(a uuid,t uuid) returns uuid language plpgsql set search_path=public as $$begin insert into icash_seller_opener_assignments values(t,a,null,null);return t;end$$;
 create function icash_queue_text(a uuid,t uuid,r uuid,b text,j jsonb) returns uuid language plpgsql set search_path=public as $$declare m uuid:=gen_random_uuid();begin insert into icash_text_messages values(m,t,a,'outgoing','ready',now(),b,null);return m;end$$;`);
 const original=read('config/sms-seller-opening.sql');await pg.exec(original.slice(original.indexOf('create or replace function'),original.indexOf('end $$;')+7));
 await pg.exec(read('config/homeoffer-buyer-introductions.sql'));
 for(const [principal,company,role] of [['Oak Street','Oak Street','an independent HomeOffer Network cash buyer'],['Jamie Smith',null,'an individual HomeOffer Network investor']]){
  const {rows:[ids]}=await pg.query('select gen_random_uuid() a,gen_random_uuid() t,gen_random_uuid() d');
  await pg.query("insert into icash_customer_identities values($1,$2,$3)",[ids.a,principal,company]);
  await pg.query("insert into icash_deal_files values($1,$2,'active','{\"address\":\"123 Main St\"}')",[ids.d,ids.a]);
  await pg.query("insert into icash_text_threads values($1,$2,'seller',false,'auto',now()+interval '1 day',$3)",[ids.t,ids.a,ids.d]);
  const {rows:[out]}=await pg.query('select icash_queue_seller_opener($1,$2) id',[ids.a,ids.t]);assert(out.id);
  const {rows:[message]}=await pg.query('select body from icash_text_messages where id=$1',[out.id]);
  assert.equal(message.body,`Hi, AI for ${principal}, ${role}. Is this the owner of 123 Main St? Reply STOP to opt out.`);assert(message.body.length<=160);
  assert.equal((await pg.query('select icash_queue_seller_opener($1,$2) id',[ids.a,ids.t])).rows[0].id,null,'no duplicate message');
 }
 console.log('PASS HomeOffer SQL introductions: company/individual role, real principal, property, STOP, one segment and duplicate admission.');
}finally{await pg.close();}
